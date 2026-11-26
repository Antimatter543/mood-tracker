/**
 * The app lock gate (context/AppLock.tsx): PIN on cold start and on every
 * return from the background, wrong-PIN waits, the distress PIN.
 *
 * The design rule under test: NOTHING on the lock screen may differ with or
 * without a distress PIN, before or after it is typed.
 *
 * Real: the gate, LockScreen, PinPad, lib/pinStore (in-memory SecureStore), lib/pinLock. Fake: AppState (a captured listener),
 * settings (a stateful stand-in), the wipe itself (its SQL is proven in
 * distressWipe*.integration.test.ts; here only WHEN and with WHAT it runs).
 */
import React, { useState } from 'react';
import { AppState, Text } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';

const store = SecureStore as unknown as { __reset: () => void };

type S = {
    app_lock_enabled: boolean;
    distress_wipe_enabled: boolean;
    distress_wipe_scope: string;
    theme: string;
    theme_mode: string;
};
const mockUpdateSetting = jest.fn();
let mockSettingsState: S;
let mockSetSettings: (s: S) => void;
jest.mock('@/context/SettingsContext', () => ({
    useSettings: () => ({
        settings: mockSettingsState,
        updateSetting: async (key: keyof S, value: never) => {
            mockUpdateSetting(key, value);
            mockSettingsState = { ...mockSettingsState, [key]: value };
            mockSetSettings(mockSettingsState);
        },
    }),
}));

const mockRunDistressWipe = jest.fn(async (_db: unknown, _scope?: unknown, _opts?: unknown) => ({} as never));
jest.mock('@/databases/distressWipe', () => ({
    runDistressWipe: (db: unknown, scope: unknown, opts: unknown) => mockRunDistressWipe(db, scope, opts),
}));

jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => ({ mock: 'db' }) }));

import { AppLockProvider } from '@/context/AppLock';
import { findNodes } from '@/testing/rntl';
import { FREE_ATTEMPTS, MIN_UNLOCK_MS } from '@/lib/pinLock';
import {
    checkPin,
    readFailures,
    setAppPin,
    setDistressPin,
} from '@/lib/pinStore';

// Each unlock waits out the real minimum "Unlocking…" time (MIN_UNLOCK_MS).
jest.setTimeout(20_000);

let appStateListener: ((s: string) => void) | null = null;

beforeEach(async () => {
    store.__reset();
    mockUpdateSetting.mockClear();
    mockRunDistressWipe.mockClear();
    appStateListener = null;
    Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_t: string, cb: (s: string) => void) => {
        appStateListener = cb;
        return { remove: () => {} };
    }) as never);
    await setAppPin('2468');
});
afterEach(() => jest.restoreAllMocks());

const goBackground = () => act(async () => appStateListener?.('background'));
const goActive = () => act(async () => appStateListener?.('active'));

let mountCount = 0;
function Journal() {
    React.useEffect(() => {
        mountCount += 1;
    }, []);
    return <Text testID="journal">my journal</Text>;
}

function Harness({ initial }: { initial: Partial<S> }) {
    const [s, setS] = useState<S>({
        app_lock_enabled: true,
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

type View = Awaited<ReturnType<typeof render>>;
/** Render, then let the gate's mount checks (stored PIN, running wait) settle. */
const renderGate = async (initial: Partial<S> = {}) => {
    const view = await render(<Harness initial={initial} />);
    await act(async () => {});
    return view;
};

const typePin = async (view: View, pin: string) => {
    for (const d of pin) await fireEvent.press(view.getByTestId(`pin-key-${d}`));
    await fireEvent.press(view.getByTestId('pin-key-ok'));
};
/** Wait out the minimum "Unlocking…" time inside act, then expect the app open. */
const unlocked = async (view: View) => {
    await act(async () => {
        await new Promise(resolve => setTimeout(resolve, MIN_UNLOCK_MS + 150));
    });
    await waitFor(() => expect(view.queryByTestId('app-lock-screen')).toBeNull());
};

describe('app lock gate (PIN)', () => {
    it('lock OFF: no lock screen, ever', async () => {
        const view = await renderGate({ app_lock_enabled: false });
        expect(view.queryByTestId('app-lock-screen')).toBeNull();
        await goBackground();
        await goActive();
        expect(view.queryByTestId('app-lock-screen')).toBeNull();
    });

    it('cold start: locked from the first frame; the app PIN unlocks', async () => {
        const view = await renderGate();
        expect(view.getByTestId('app-lock-screen')).toBeTruthy();
        await typePin(view, '2468');
        await unlocked(view);
        expect(mockRunDistressWipe).not.toHaveBeenCalled();
    });

    it('a wrong PIN stays locked and says so', async () => {
        const view = await renderGate();
        await typePin(view, '1111');
        await waitFor(() => expect(view.getByTestId('app-lock-message').props.children).toBe('Wrong PIN. Try again.'));
        expect(view.getByTestId('app-lock-screen')).toBeTruthy();
        expect((await readFailures()).failures).toBe(1);
    });

    it(`after ${FREE_ATTEMPTS} wrong PINs it makes you wait, and the right PIN is not accepted meanwhile`, async () => {
        const view = await renderGate();
        for (let i = 0; i < FREE_ATTEMPTS; i++) await typePin(view, '1111');
        await waitFor(() => expect(view.getByTestId('app-lock-message').props.children).toMatch(/Try again in \d+ s/));
        await typePin(view, '2468');
        expect(view.getByTestId('app-lock-screen')).toBeTruthy();
    });

    it('minimise -> reopen locks again, every time', async () => {
        const view = await renderGate();
        await typePin(view, '2468');
        await unlocked(view);
        for (let i = 0; i < 3; i++) {
            await goBackground();
            expect(view.getByTestId('app-lock-screen')).toBeTruthy();
            await goActive();
            expect(view.getByTestId('app-lock-screen')).toBeTruthy();
            await typePin(view, '2468');
            await unlocked(view);
        }
    });

    it('the app content stays mounted but hidden from touch and a11y while locked', async () => {
        const view = await renderGate();
        const hidden = findNodes(view.toJSON(), n =>
            n.props?.importantForAccessibility === 'no-hide-descendants' && n.props?.pointerEvents === 'none'
        );
        expect(hidden).toHaveLength(1);
        expect(findNodes(hidden[0], n => n.props?.testID === 'journal')).toHaveLength(1);
        expect(findNodes(hidden[0], n => n.props?.testID === 'app-lock-screen')).toHaveLength(0);
    });

    it('a lock without a stored PIN fails open and turns itself off', async () => {
        store.__reset();
        const view = await renderGate();
        await unlocked(view);
        expect(mockUpdateSetting).toHaveBeenCalledWith('app_lock_enabled', false);
    });

    describe('distress PIN', () => {
        beforeEach(async () => {
            await setDistressPin('9999');
        });

        it('the lock screen is IDENTICAL with and without a distress PIN', async () => {
            const withDistress = (await renderGate({ distress_wipe_enabled: true })).toJSON();
            store.__reset();
            await setAppPin('2468');
            const without = (await renderGate({ distress_wipe_enabled: false })).toJSON();
            expect(JSON.stringify(withDistress)).toBe(JSON.stringify(without));
        });

        it('unlocks like the app PIN, wipes first with the stored selection, then forgets itself', async () => {
            mountCount = 0;
            const view = await renderGate({ distress_wipe_enabled: true, distress_wipe_scope: '{"health":false}' });
            await typePin(view, '9999');
            await unlocked(view);
            expect(mockRunDistressWipe).toHaveBeenCalledTimes(1);
            const [, scope, opts] = mockRunDistressWipe.mock.calls[0] as [unknown, Record<string, boolean>, { deferScrub: boolean }];
            expect(scope.health).toBe(false);
            expect(scope.notes).toBe(true);
            expect(opts.deferScrub).toBe(true);
            expect(mockUpdateSetting).toHaveBeenCalledWith('distress_wipe_enabled', false);
            expect(await checkPin('9999')).toBe('wrong'); // deleted
            expect(await checkPin('2468')).toBe('app'); // the app PIN still works
            expect(mountCount).toBe(2); // the subtree was remounted
        });

        it('the app PIN with a distress PIN set wipes nothing', async () => {
            const view = await renderGate({ distress_wipe_enabled: true });
            await typePin(view, '2468');
            await unlocked(view);
            expect(mockRunDistressWipe).not.toHaveBeenCalled();
        });

        it('both PINs show "Unlocking…" for at least the same minimum time', async () => {
            for (const pin of ['2468', '9999']) {
                const view = await renderGate({ distress_wipe_enabled: true });
                const t0 = Date.now();
                await typePin(view, pin);
                await waitFor(() => expect(view.getByText('Unlocking…')).toBeTruthy());
                await unlocked(view);
                expect(Date.now() - t0).toBeGreaterThanOrEqual(MIN_UNLOCK_MS - 50);
                view.unmount();
                await setDistressPin('9999');
            }
        });

        it('wrong PINs never wipe', async () => {
            const view = await renderGate({ distress_wipe_enabled: true });
            for (let i = 0; i < FREE_ATTEMPTS; i++) await typePin(view, '1111');
            expect(mockRunDistressWipe).not.toHaveBeenCalled();
        });
    });
});

describe('no way past the PIN', () => {
    it('the lock screen offers nothing but the number pad (no "forgot PIN" bypass)', async () => {
        const view = await renderGate();
        const pressables = findNodes(view.toJSON(), n => typeof n.props?.testID === 'string' && n.props?.accessibilityRole === 'button')
            .map(n => n.props!.testID as string);
        expect(pressables.every(id => id.startsWith('pin-key-'))).toBe(true);
    });
});
