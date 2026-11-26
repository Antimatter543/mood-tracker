import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus, BackHandler, StyleSheet, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';

import { useSettings } from '@/context/SettingsContext';
import { bumpDataVersion } from '@/context/dataRefreshStore';
import { LockScreen } from '@/components/LockScreen';
import { MIN_UNLOCK_MS, remainingWaitMs, shouldLockOnAppStateChange, waitMessage } from '@/lib/pinLock';
import {
    checkPin,
    clearDistressPin,
    hasAppPin,
    readFailures,
    writeFailures,
} from '@/lib/pinStore';
import { runDistressWipe } from '@/databases/distressWipe';
import { parseDistressScope } from '@/lib/distressScope';
import { now } from '@/lib/clock';

/**
 * The app lock gate: PIN on every cold start and every return from the
 * background (opt-in, Settings > Privacy & security).
 *
 * Placement: app/(tabs)/_layout.tsx, INSIDE SQLite/Settings (it reads both) and
 * AROUND the OverlayProvider, so the lock screen paints above every overlay
 * (an entry form left open included) and the overlays reset with the subtree.
 * The app content stays MOUNTED under the lock screen, hidden from touch and
 * from accessibility services while locked.
 *
 * The distress PIN (the whole design rule): it must be impossible to tell from
 * the lock screen whether one is set or was just used. So both PINs go through
 * ONE path: the same "Unlocking…" for at least MIN_UNLOCK_MS, the same opening.
 * The distress PIN only runs the wipe inside that window (the slow file scrub
 * runs after the app is open), deletes itself and turns the option off. Wrong
 * PINs are counted and delayed the same way whatever is set.
 *
 * There is no "forgot PIN" way in: any recovery path would also be a way past
 * the distress PIN. A forgotten PIN means clearing the app data and restoring
 * a backup, and the PIN setup says so.
 */

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export function AppLockProvider({ children }: { children: React.ReactNode }) {
    const db = useSQLiteContext();
    const { settings, updateSetting } = useSettings();
    const lockEnabled = settings.app_lock_enabled;

    const [locked, setLocked] = useState<boolean>(lockEnabled);
    const [pin, setPin] = useState('');
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [waitUntil, setWaitUntil] = useState(0);
    // Bumped after a wipe: remounts the app subtree so no screen or open form
    // keeps wiped notes in memory.
    const [generation, setGeneration] = useState(0);

    const lockEnabledRef = useRef(lockEnabled);
    const settingsRef = useRef(settings);
    lockEnabledRef.current = lockEnabled;
    settingsRef.current = settings;

    // Turning the lock OFF releases it at once. Turning it ON does not lock the
    // current session (the user is setting it up right now).
    useEffect(() => {
        if (!lockEnabled) {
            setLocked(false);
            setPin('');
            setMessage(null);
        }
    }, [lockEnabled]);

    // A lock without a stored PIN (should not happen: a restore never brings
    // the setting along) would be unpassable: fail open and turn it off.
    useEffect(() => {
        if (!lockEnabled) return;
        hasAppPin().then(has => {
            if (!has) {
                setLocked(false);
                updateSetting('app_lock_enabled', false).catch(() => {});
                updateSetting('distress_wipe_enabled', false).catch(() => {});
            }
        });
    }, [lockEnabled, updateSetting]);

    // Restore a running wait after a restart (wrong PINs are persisted).
    useEffect(() => {
        readFailures().then(state => {
            const left = remainingWaitMs(state, now().getTime());
            if (left > 0) {
                setWaitUntil(now().getTime() + left);
                setMessage(waitMessage(left));
            }
        });
    }, []);

    // Count the wait down on screen.
    useEffect(() => {
        if (!waitUntil) return;
        const t = setInterval(() => {
            // Only a changed message re-renders (React skips an identical state).
            const n = now().getTime();
            if (n >= waitUntil) {
                setWaitUntil(0);
                setMessage(null);
            } else {
                setMessage(waitMessage(waitUntil - n));
            }
        }, 1000);
        return () => clearInterval(t);
    }, [waitUntil]);

    /** The distress wipe, run by the distress PIN before the app opens. */
    const wipe = useCallback(async () => {
        try {
            const summary = await runDistressWipe(
                db,
                parseDistressScope(settingsRef.current.distress_wipe_scope),
                { deferScrub: true }
            );
            if (typeof summary.reminders === 'string') {
                await updateSetting('reminders', summary.reminders).catch(() => {});
            }
        } catch (e) {
            console.warn('[distress] wipe failed:', e);
        }
        await clearDistressPin().catch(() => {});
        await updateSetting('distress_wipe_enabled', false).catch(() => {});
        setGeneration(g => g + 1);
        bumpDataVersion();
    }, [db, updateSetting]);

    const submit = useCallback(async () => {
        if (busy || pin.length === 0) return;
        if (waitUntil && now().getTime() < waitUntil) return;
        const typed = pin;
        setBusy(true);
        setMessage(null);
        const started = now().getTime();
        try {
            const result = await checkPin(typed);
            if (result === 'wrong') {
                const prev = await readFailures();
                const next = { failures: prev.failures + 1, lastFailureAt: now().getTime() };
                await writeFailures(next);
                const left = remainingWaitMs(next, now().getTime());
                if (left > 0) {
                    setWaitUntil(now().getTime() + left);
                    setMessage(waitMessage(left));
                } else {
                    setMessage('Wrong PIN. Try again.');
                }
                setPin('');
                return;
            }
            await writeFailures({ failures: 0, lastFailureAt: 0 });
            if (result === 'distress') await wipe();
            // The same minimum "Unlocking…" for both PINs.
            const elapsed = now().getTime() - started;
            if (elapsed < MIN_UNLOCK_MS) await sleep(MIN_UNLOCK_MS - elapsed);
            setPin('');
            setLocked(false);
        } finally {
            setBusy(false);
        }
    }, [busy, pin, waitUntil, wipe]);

    // AppState: lock on background.
    useEffect(() => {
        const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
            if (
                shouldLockOnAppStateChange(next, { lockEnabled: lockEnabledRef.current })
            ) {
                setLocked(true);
                setPin('');
            }
        });
        return () => sub.remove();
    }, []);

    // Hardware back on the lock screen leaves the app instead of navigating the
    // hidden screens underneath it.
    useEffect(() => {
        if (!locked) return;
        const sub = BackHandler.addEventListener('hardwareBackPress', () => {
            BackHandler.exitApp();
            return true;
        });
        return () => sub.remove();
    }, [locked]);

    const waiting = waitUntil > 0;

    return (
        <>
            <View
                key={generation}
                style={styles.fill}
                pointerEvents={locked ? 'none' : 'auto'}
                importantForAccessibility={locked ? 'no-hide-descendants' : 'auto'}
                accessibilityElementsHidden={locked}
            >
                {children}
            </View>
            {locked ? (
                <LockScreen
                    pin={pin}
                    onPinChange={setPin}
                    onSubmit={submit}
                    busy={busy}
                    waiting={waiting}
                    message={message}
                />
            ) : null}
        </>
    );
}

const styles = StyleSheet.create({
    fill: { flex: 1 },
});
