import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { AppState, AppStateStatus, BackHandler, StyleSheet, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';

import { useSettings } from '@/context/SettingsContext';
import { bumpDataVersion } from '@/context/dataRefreshStore';
import { LockScreen } from '@/components/LockScreen';
import {
    AuthOutcome,
    classifyAuthAttempt,
    failsOpen,
    lockMessageFor,
    promptOptionsFor,
    shouldLockOnAppStateChange,
} from '@/lib/appLock';
import { getBiometricCapabilities, promptBiometric } from '@/lib/biometricAuth';
import { runDistressWipe } from '@/databases/distressWipe';
import { parseDistressScope } from '@/lib/distressScope';

/**
 * The app lock gate (opt-in, Settings > Privacy & security).
 *
 * Placement: app/(tabs)/_layout.tsx, INSIDE SQLite/Settings (it reads both) and
 * AROUND the OverlayProvider, so the lock screen paints above every overlay
 * (an open entry form included) and the overlays reset with the app subtree.
 *
 * The app content stays MOUNTED under the lock screen (no lost navigation or
 * half-written entry after a quick app switch); it is hidden from touch and
 * from accessibility services while locked.
 *
 * Lock moments: cold start (the provider mounts locked when the setting is on;
 * SettingsProvider renders nothing until settings are loaded, so there is no
 * unlocked first frame) and every move to the background. Unlock: one prompt,
 * shown automatically, then by the Unlock button.
 *
 * Distress wipe: see lib/appLock.ts (when it fires) and databases/distressWipe.ts
 * (what it does). After it runs, the app subtree is REMOUNTED (fresh key), so no
 * screen or open form keeps the wiped notes in memory, and the next prompt
 * allows the device PIN. The lock screen looks exactly like a plain lockout.
 */

type AppLockContextValue = {
    /**
     * Run one biometric prompt OUTSIDE the lock screen (Settings uses it to
     * confirm the user before turning the lock on). Suspends background
     * re-locking while the prompt is open.
     */
    confirmIdentity: () => Promise<boolean>;
};

const AppLockContext = createContext<AppLockContextValue>({
    confirmIdentity: async () => false,
});

export function useAppLock(): AppLockContextValue {
    return useContext(AppLockContext);
}

export function AppLockProvider({ children }: { children: React.ReactNode }) {
    const db = useSQLiteContext();
    const { settings, updateSetting } = useSettings();
    const lockEnabled = settings.app_lock_enabled;

    const [locked, setLocked] = useState<boolean>(lockEnabled);
    const [busy, setBusy] = useState(false);
    const [outcome, setOutcome] = useState<AuthOutcome | null>(null);
    // Bumped after a distress wipe: remounts the app subtree (see header).
    const [generation, setGeneration] = useState(0);

    // Refs: AppState callbacks and the async prompt must see current values.
    const authInFlight = useRef(false);
    const lockEnabledRef = useRef(lockEnabled);
    const distressRef = useRef(settings.distress_wipe_enabled);
    const scopeRef = useRef(settings.distress_wipe_scope);
    // After a lockout / unavailable / wipe, the next prompt allows the PIN.
    const pinAllowedRef = useRef(false);
    // Prompt automatically on the next 'active' (cold start, return from background).
    const autoPromptPending = useRef(lockEnabled);
    const appStateRef = useRef<AppStateStatus>(AppState.currentState);

    lockEnabledRef.current = lockEnabled;
    distressRef.current = settings.distress_wipe_enabled;
    scopeRef.current = settings.distress_wipe_scope;

    // Turning the lock OFF releases it at once. Turning it ON does not lock the
    // current session: the user has just authenticated to switch it on.
    useEffect(() => {
        if (!lockEnabled) {
            setLocked(false);
            setOutcome(null);
            autoPromptPending.current = false;
        }
    }, [lockEnabled]);

    const unlock = useCallback(async () => {
        if (authInFlight.current) return;
        authInFlight.current = true;
        setBusy(true);
        try {
            const caps = await getBiometricCapabilities();
            if (failsOpen(caps.securityLevel)) {
                setLocked(false);
                setOutcome(null);
                return;
            }
            const distress = distressRef.current && !pinAllowedRef.current && caps.enrolled;
            const { attempt, elapsedMs } = await promptBiometric(
                // Same prompt with distress on or off (see promptOptionsFor).
                promptOptionsFor({ pinAllowed: pinAllowedRef.current, biometricsEnrolled: caps.enrolled })
            );
            const result = classifyAuthAttempt(attempt, { distressEnabled: distress, elapsedMs });

            if (result === 'unlock') {
                pinAllowedRef.current = false;
                setOutcome(null);
                setLocked(false);
                return;
            }
            if (result === 'dismissed') {
                setOutcome('dismissed');
                return;
            }
            // locked_out / unavailable / wipe: the next try may use the PIN.
            pinAllowedRef.current = true;
            setOutcome(result);
            if (result === 'wipe') {
                try {
                    const summary = await runDistressWipe(db, parseDistressScope(scopeRef.current));
                    // Keep the in-memory list in step, so Settings and the
                    // notification re-arm stop using the old names at once.
                    if (typeof summary.reminders === 'string') {
                        await updateSetting('reminders', summary.reminders).catch(() => {});
                    }
                } catch (e) {
                    console.warn('[distress] wipe failed:', e);
                }
                // The wipe already wrote 'false' in its transaction; this keeps
                // the in-memory settings in step (idempotent write).
                distressRef.current = false;
                await updateSetting('distress_wipe_enabled', false).catch(() => {});
                setGeneration(g => g + 1);
                bumpDataVersion();
            }
        } finally {
            authInFlight.current = false;
            setBusy(false);
        }
    }, [db, updateSetting]);

    // AppState: lock on background, prompt on return.
    useEffect(() => {
        const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
            appStateRef.current = next;
            if (
                shouldLockOnAppStateChange(next, {
                    lockEnabled: lockEnabledRef.current,
                    authInFlight: authInFlight.current,
                })
            ) {
                setLocked(true);
                setOutcome(null);
                autoPromptPending.current = true;
            } else if (next === 'active' && autoPromptPending.current && !authInFlight.current) {
                autoPromptPending.current = false;
                unlock();
            }
        });
        return () => sub.remove();
    }, [unlock]);

    // Cold start: the app is already active when this mounts locked.
    useEffect(() => {
        // Android can report 'unknown' this early; only a real 'background'
        // waits for the 'active' event (the listener above then prompts).
        if (locked && autoPromptPending.current && appStateRef.current !== 'background') {
            autoPromptPending.current = false;
            unlock();
        }
        // Only on mount: later locks are prompted by the AppState listener.
        // eslint-disable-next-line react-hooks/exhaustive-deps
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

    const confirmIdentity = useCallback(async () => {
        if (authInFlight.current) return false;
        authInFlight.current = true;
        try {
            const caps = await getBiometricCapabilities();
            if (failsOpen(caps.securityLevel)) return false;
            const { attempt } = await promptBiometric({
                // Settings confirmation, not the lock screen: the PIN is fine here.
                ...promptOptionsFor({ pinAllowed: true, biometricsEnrolled: caps.enrolled }),
                promptMessage: 'Confirm it’s you',
            });
            return attempt.success;
        } finally {
            authInFlight.current = false;
        }
    }, []);

    const value = useMemo(() => ({ confirmIdentity }), [confirmIdentity]);

    return (
        <AppLockContext.Provider value={value}>
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
                    busy={busy}
                    message={lockMessageFor(outcome)}
                    onUnlock={unlock}
                />
            ) : null}
        </AppLockContext.Provider>
    );
}

const styles = StyleSheet.create({
    fill: { flex: 1 },
});
