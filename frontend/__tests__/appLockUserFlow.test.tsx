/**
 * The whole user flow in ONE tree, without a restart in between: the real
 * Settings card (AppLockSection + PinSetupDialog), the real gate
 * (AppLockProvider + LockScreen), the real pin store. A real-phone report:
 * "set the PIN, set the distress PIN, minimise, reopen: only the distress PIN
 * opens". The parts were each tested on their own; this pins them together.
 */
import React, { useState } from 'react';
import { Alert, AppState } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';

const store = SecureStore as unknown as { __reset: () => void };

type S = { app_lock_enabled: boolean; distress_wipe_enabled: boolean; distress_wipe_scope: string; theme: string; theme_mode: string };
let mockSettingsState: S;
let mockSetSettings: (s: S) => void;
jest.mock('@/context/SettingsContext', () => ({
    useSettings: () => ({
        settings: mockSettingsState,
        updateSetting: async (key: keyof S, value: never) => {
            mockSettingsState = { ...mockSettingsState, [key]: value };
            mockSetSettings(mockSettingsState);
        },
    }),
}));
const mockRunDistressWipe = jest.fn(async () => ({} as never));
jest.mock('@/databases/distressWipe', () => ({
    runDistressWipe: () => mockRunDistressWipe(),
    runDistressCleanup: async () => {},
}));
jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => ({ mock: 'db' }) }));
jest.mock('expo-router', () => ({ usePathname: () => '/settings', useRouter: () => ({ navigate: () => {} }) }));

import { AppLockProvider } from '@/context/AppLock';
import { OverlayProvider } from '@/context/OverlayHost';
import { AppLockSection } from '@/components/AppLockSection';
import { MIN_UNLOCK_MS } from '@/lib/pinLock';
import { checkPin } from '@/lib/pinStore';

jest.setTimeout(30_000);

let appStateListener: ((s: string) => void) | null = null;
beforeEach(() => {
    store.__reset();
    mockRunDistressWipe.mockClear();
    Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_t: string, cb: (s: string) => void) => {
        appStateListener = cb;
        return { remove: () => {} };
    }) as never);
    // The distress confirmation: press "Choose PIN".
    jest.spyOn(Alert, 'alert').mockImplementation(((_t: string, _m: string, buttons?: { text: string; onPress?: () => void }[]) => {
        buttons?.find(b => b.text === 'Choose PIN')?.onPress?.();
    }) as never);
});
afterEach(() => jest.restoreAllMocks());

function App() {
    const [s, setS] = useState<S>({
        app_lock_enabled: false, distress_wipe_enabled: false, distress_wipe_scope: '{}', theme: 'dark', theme_mode: 'dark',
    });
    mockSettingsState = s;
    mockSetSettings = setS;
    return (
        <AppLockProvider>
            <OverlayProvider>
                <AppLockSection />
            </OverlayProvider>
        </AppLockProvider>
    );
}

type View = Awaited<ReturnType<typeof render>>;
const typePin = async (view: View, pin: string) => {
    for (const d of pin) await fireEvent.press(view.getByTestId(`pin-key-${d}`));
    await fireEvent.press(view.getByTestId('pin-key-ok'));
};
const choosePin = async (view: View, pin: string) => {
    await waitFor(() => expect(view.getByTestId('pin-setup')).toBeTruthy());
    await typePin(view, pin);
    await waitFor(() => expect(view.getByTestId('pin-setup-title').props.children).toMatch(/again/));
    await typePin(view, pin);
    await waitFor(() => expect(view.queryByTestId('pin-setup')).toBeNull());
};
const minimiseAndReopen = async () => {
    await act(async () => appStateListener?.('background'));
    await act(async () => appStateListener?.('active'));
};
const waitUnlock = () => act(async () => {
    await new Promise(r => setTimeout(r, MIN_UNLOCK_MS + 150));
});

const setUp = async (appPin: string, distressPin: string) => {
    const view = await render(<App />);
    await act(async () => {});
    await fireEvent(view.getByTestId('app-lock-switch'), 'valueChange', true);
    await choosePin(view, appPin);
    await waitFor(() => expect(view.getByTestId('distress-wipe-switch')).toBeTruthy());
    await fireEvent(view.getByTestId('distress-wipe-switch'), 'valueChange', true);
    await choosePin(view, distressPin);
    await waitFor(() => expect(view.getByTestId('distress-wipe-hint')).toBeTruthy());
    return view;
};

describe.each([
    ['same length', '2468', '9999'],
    ['distress longer', '2468', '135790'],
    ['app longer', '24681357', '9999'],
])('PIN, then distress PIN, minimise, reopen (%s)', (_name, appPin, distressPin) => {
    it('both PINs are stored in their own slot', async () => {
        await setUp(appPin, distressPin);
        expect(await checkPin(appPin)).toBe('app');
        expect(await checkPin(distressPin)).toBe('distress');
    });

    it('the app PIN opens, and wipes nothing', async () => {
        const view = await setUp(appPin, distressPin);
        await minimiseAndReopen();
        expect(view.getByTestId('app-lock-screen')).toBeTruthy();
        await typePin(view, appPin);
        await waitUnlock();
        await waitFor(() => expect(view.queryByTestId('app-lock-screen')).toBeNull());
        expect(mockRunDistressWipe).not.toHaveBeenCalled();
    });

    it('the distress PIN opens too, and wipes', async () => {
        const view = await setUp(appPin, distressPin);
        await minimiseAndReopen();
        await typePin(view, distressPin);
        await waitUnlock();
        await waitFor(() => expect(view.queryByTestId('app-lock-screen')).toBeNull());
        expect(mockRunDistressWipe).toHaveBeenCalledTimes(1);
    });
});
