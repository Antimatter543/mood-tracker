/**
 * The app lock gate (context/AppLock.tsx) end to end in jest: cold start, the
 * minimise -> reopen cycle, the PIN-activity pause, and the distress path.
 *
 * Real: the gate, lib/appLock, lib/biometricAuth, the LockScreen.
 * Fake: expo-local-authentication (__mocks__/, results queued per test),
 * AppState (a captured listener we fire by hand), the settings store (a tiny
 * stateful stand-in), and the wipe itself (its SQL is proven in
 * distressWipe.integration.test.ts; here we only care WHEN it runs).
 */
import React, { useState } from 'react';
import { AppState, Text } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as LocalAuth from 'expo-local-authentication';

const auth = LocalAuth as unknown as {
    __reset: () => void;
    __queueResult: (r: unknown, ms?: number) => void;
    __setCapabilities: (c: object) => void;
    __calls: () => Array<{ disableDeviceFallback: boolean }>;
    __holdNextPrompt: () => void;
    __releasePrompt: () => void;
};

// ── settings: a stateful stand-in for SettingsContext ──────────────────────
type S = { app_lock_enabled: boolean; distress_wipe_enabled: boolean; distress_wipe_scope: string; theme: string; theme_mode: string };
const mockUpdateSetting = jest.fn();
let mockSettingsState: S;
let mockSetSettings: (s: S) => void;
jest.mock('@/context/SettingsContext', () => ({
    useSettings: () => ({
        settings: mockSettingsState,
        updateSetting: async (key: keyof S, value: never) => {
            mockUpdateSetting(key, value);
            mockSetSettings({ ...mockSettingsState, [key]: value });
        },
    }),
}));

const mockRunDistressWipe = jest.fn(async (_db: unknown, _scope?: unknown) => ({}));
jest.mock('@/databases/distressWipe', () => ({
    runDistressWipe: (db: unknown, scope: unknown) => mockRunDistressWipe(db, scope),
}));

jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => ({ mock: 'db' }) }));

import { AppLockProvider } from '@/context/AppLock';
import { findNodes } from '@/testing/rntl';

// ── AppState: capture the listener, drive transitions by hand ──────────────
let appStateListener: ((s: string) => void) | null = null;
beforeEach(() => {
    auth.__reset();
    mockUpdateSetting.mockClear();
    mockRunDistressWipe.mockClear();
    appStateListener = null;
    Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_t: string, cb: (s: string) => void) => {
        appStateListener = cb;
        return { remove: () => {} };
    }) as never);
});
afterEach(() => jest.restoreAllMocks());

const goBackground = () => act(async () => appStateListener?.('background'));
const goActive = () => act(async () => appStateListener?.('active'));

let mountCount = 0;
function Journal() {
    // Counts mounts: a distress wipe must REMOUNT the app subtree.
    React.useEffect(() => {
        mountCount += 1;
    }, []);
    return <Text testID="journal">my journal</Text>;
}

function Harness({ initial }: { initial: Partial<S> }) {
    const [s, setS] = useState<S>({
        app_lock_enabled: false,
        distress_wipe_enabled: false,
        distress_wipe_scope: '{}',
        theme: 'dark',
        theme_mode: 'dark',
        ...initial,
    });
    mockSettingsState = s;
    mockSetSettings = setS;
    return (
        <AppLockProvider>
            <Journal />
        </AppLockProvider>
    );
}

// RNTL v14: render / fireEvent return promises (tasks/lessons.md 2026-08-29).
const renderGate = (initial: Partial<S>) => render(<Harness initial={initial} />);

describe('app lock gate', () => {
    it('lock OFF (the default): no lock screen, no prompt', async () => {
        const view = await renderGate({});
        expect(view.queryByTestId('app-lock-screen')).toBeNull();
        expect(view.getByTestId('journal')).toBeTruthy();
        await goBackground();
        await goActive();
        expect(view.queryByTestId('app-lock-screen')).toBeNull();
        expect(auth.__calls()).toHaveLength(0);
    });

    it('cold start with the lock ON: locked from the first frame, prompts at once, unlocks', async () => {
        auth.__holdNextPrompt();
        const view = await renderGate({ app_lock_enabled: true });
        expect(view.getByTestId('app-lock-screen')).toBeTruthy();
        await waitFor(() => expect(auth.__calls()).toHaveLength(1));
        await act(async () => auth.__releasePrompt());
        await waitFor(() => expect(view.queryByTestId('app-lock-screen')).toBeNull());
    });

    it('minimise -> reopen locks again and prompts again, every time', async () => {
        const view = await renderGate({ app_lock_enabled: true });
        await waitFor(() => expect(view.queryByTestId('app-lock-screen')).toBeNull());

        for (let i = 1; i <= 3; i++) {
            auth.__holdNextPrompt();
            await goBackground();
            expect(view.getByTestId('app-lock-screen')).toBeTruthy();
            await goActive();
            await waitFor(() => expect(auth.__calls()).toHaveLength(1 + i));
            expect(view.getByTestId('app-lock-screen')).toBeTruthy();
            await act(async () => auth.__releasePrompt());
            await waitFor(() => expect(view.queryByTestId('app-lock-screen')).toBeNull());
        }
    });

    it('the app content stays mounted (no lost state) but hidden from touch and a11y while locked', async () => {
        auth.__queueResult({ success: false, error: 'user_cancel' });
        const view = await renderGate({ app_lock_enabled: true });
        await waitFor(() => expect(view.getByTestId('app-lock-unlock')).toBeEnabled());
        const hidden = findNodes(view.toJSON(), n =>
            n.props?.importantForAccessibility === 'no-hide-descendants' && n.props?.pointerEvents === 'none'
        );
        expect(hidden).toHaveLength(1);
        // the journal is inside the hidden wrapper, the lock screen is not
        expect(findNodes(hidden[0], n => n.props?.testID === 'journal')).toHaveLength(1);
        expect(findNodes(hidden[0], n => n.props?.testID === 'app-lock-screen')).toHaveLength(0);
        expect(view.queryByTestId('journal', { includeHiddenElements: true })).toBeTruthy();
    });

    it('a cancelled prompt stays locked; the Unlock button prompts again', async () => {
        auth.__queueResult({ success: false, error: 'user_cancel' });
        const view = await renderGate({ app_lock_enabled: true });
        await waitFor(() => expect(view.getByTestId('app-lock-unlock')).toBeEnabled());
        expect(view.getByTestId('app-lock-screen')).toBeTruthy();
        await fireEvent.press(view.getByTestId('app-lock-unlock'));
        await waitFor(() => expect(view.queryByTestId('app-lock-screen')).toBeNull());
        expect(auth.__calls()).toHaveLength(2);
    });

    it('the pause caused by our own PIN prompt does not re-lock after it succeeds', async () => {
        auth.__holdNextPrompt();
        const view = await renderGate({ app_lock_enabled: true });
        await waitFor(() => expect(auth.__calls()).toHaveLength(1));
        // Android < 11: the PIN screen is a separate activity, ours pauses.
        await goBackground();
        await act(async () => auth.__releasePrompt());
        await goActive();
        await waitFor(() => expect(view.queryByTestId('app-lock-screen')).toBeNull());
        expect(auth.__calls()).toHaveLength(1);
    });

    it('turning the lock off releases a locked screen', async () => {
        auth.__queueResult({ success: false, error: 'user_cancel' });
        const view = await renderGate({ app_lock_enabled: true });
        await waitFor(() => expect(view.getByTestId('app-lock-unlock')).toBeEnabled());
        await act(async () => mockSetSettings({ ...mockSettingsState, app_lock_enabled: false }));
        expect(view.queryByTestId('app-lock-screen')).toBeNull();
    });

    it('a device with no security at all opens instead of stranding the user', async () => {
        auth.__setCapabilities({ enrolled: false, securityLevel: 0 });
        const view = await renderGate({ app_lock_enabled: true });
        await waitFor(() => expect(view.queryByTestId('app-lock-screen')).toBeNull());
        expect(auth.__calls()).toHaveLength(0);
    });

    describe('distress wipe', () => {
        it('distress ON prompts biometric-only; OFF allows the PIN', async () => {
            await renderGate({ app_lock_enabled: true, distress_wipe_enabled: true });
            await waitFor(() => expect(auth.__calls()).toHaveLength(1));
            expect(auth.__calls()[0].disableDeviceFallback).toBe(true);

            auth.__reset();
            await renderGate({ app_lock_enabled: true, distress_wipe_enabled: false });
            await waitFor(() => expect(auth.__calls()).toHaveLength(1));
            expect(auth.__calls()[0].disableDeviceFallback).toBe(false);
        });

        it('a lockout in our prompt wipes, turns itself off, remounts the app, and looks like a plain lockout', async () => {
            auth.__queueResult({ success: false, error: 'lockout' }, 6000);
            mountCount = 0;
            const view = await renderGate({ app_lock_enabled: true, distress_wipe_enabled: true });
            await waitFor(() => expect(mockRunDistressWipe).toHaveBeenCalledTimes(1));
            await waitFor(() => expect(view.getByTestId('app-lock-unlock')).toBeEnabled());

            expect(mockUpdateSetting).toHaveBeenCalledWith('distress_wipe_enabled', false);
            expect(view.getByTestId('app-lock-screen')).toBeTruthy();
            expect(view.getByTestId('app-lock-message').props.children).toBe(
                'Too many attempts. Try again in a moment.'
            );
            expect(mountCount).toBe(2); // the subtree was remounted

            // The next try allows the PIN, so whoever is watching can get in.
            await fireEvent.press(view.getByTestId('app-lock-unlock'));
            await waitFor(() => expect(view.queryByTestId('app-lock-screen')).toBeNull());
            expect(auth.__calls()[1].disableDeviceFallback).toBe(false);
            expect(mockRunDistressWipe).toHaveBeenCalledTimes(1);
        });

        it('the wiped reminder names reach the in-memory settings too', async () => {
            mockRunDistressWipe.mockResolvedValueOnce({ reminders: '[{"id":"a","label":"","time":"08:00","enabled":true}]' } as never);
            auth.__queueResult({ success: false, error: 'lockout' }, 6000);
            const view = await renderGate({ app_lock_enabled: true, distress_wipe_enabled: true });
            await waitFor(() => expect(view.getByTestId('app-lock-unlock')).toBeEnabled());
            expect(mockUpdateSetting).toHaveBeenCalledWith(
                'reminders', '[{"id":"a","label":"","time":"08:00","enabled":true}]'
            );
        });

        it('no reminder names to blank: the reminders setting is left alone', async () => {
            auth.__queueResult({ success: false, error: 'lockout' }, 6000);
            const view = await renderGate({ app_lock_enabled: true, distress_wipe_enabled: true });
            await waitFor(() => expect(view.getByTestId('app-lock-unlock')).toBeEnabled());
            expect(mockUpdateSetting.mock.calls.map(c => c[0])).not.toContain('reminders');
        });

        it('the wipe gets the stored selection', async () => {
            auth.__queueResult({ success: false, error: 'lockout' }, 6000);
            const view = await renderGate({
                app_lock_enabled: true, distress_wipe_enabled: true, distress_wipe_scope: '{"health":false}',
            });
            await waitFor(() => expect(view.getByTestId('app-lock-unlock')).toBeEnabled());
            const scope = mockRunDistressWipe.mock.calls[0][1] as Record<string, boolean>;
            expect(scope.health).toBe(false);
            expect(scope.notes).toBe(true);
        });

        it('an instant lockout (already locked elsewhere) never wipes', async () => {
            auth.__queueResult({ success: false, error: 'lockout' }, 100);
            const view = await renderGate({ app_lock_enabled: true, distress_wipe_enabled: true });
            await waitFor(() => expect(view.getByTestId('app-lock-message')).toBeTruthy());
            expect(view.getByTestId('app-lock-message').props.children).toBe(
                'Too many attempts. Try again in a moment.'
            );
            expect(mockRunDistressWipe).not.toHaveBeenCalled();
            expect(mockUpdateSetting).not.toHaveBeenCalled();
        });

        it('a lockout with distress OFF never wipes', async () => {
            auth.__queueResult({ success: false, error: 'lockout' }, 6000);
            const view = await renderGate({ app_lock_enabled: true, distress_wipe_enabled: false });
            await waitFor(() => expect(view.getByTestId('app-lock-message')).toBeTruthy());
            expect(mockRunDistressWipe).not.toHaveBeenCalled();
        });

        it('a lockout after the user returns from the background also wipes', async () => {
            const view = await renderGate({ app_lock_enabled: true, distress_wipe_enabled: true });
            await waitFor(() => expect(view.queryByTestId('app-lock-screen')).toBeNull());
            auth.__queueResult({ success: false, error: 'lockout' }, 6000);
            await goBackground();
            await goActive();
            await waitFor(() => expect(mockRunDistressWipe).toHaveBeenCalledTimes(1));
        });

        it('a failing wipe still leaves the app locked and usable', async () => {
            mockRunDistressWipe.mockRejectedValueOnce(new Error('disk full'));
            const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
            auth.__queueResult({ success: false, error: 'lockout' }, 6000);
            const view = await renderGate({ app_lock_enabled: true, distress_wipe_enabled: true });
            await waitFor(() => expect(view.getByTestId('app-lock-unlock')).toBeEnabled());
            expect(view.getByTestId('app-lock-screen')).toBeTruthy();
            warn.mockRestore();
        });
    });
});
