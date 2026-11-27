/**
 * The lock screen's submit called twice before a render (a double tap on OK on
 * a real phone, faster than the render that shows "Unlocking…"). The gate
 * (context/AppLock.tsx) must check ONCE: no wrong PIN counted twice, and above
 * all no distress wipe run twice.
 *
 * LockScreen is replaced by a probe that hands out its onSubmit, so both calls
 * land in the same tick (RNTL cannot overlap two presses).
 */
import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';

const store = SecureStore as unknown as { __reset: () => void };

let mockSettingsState: Record<string, unknown>;
jest.mock('@/context/SettingsContext', () => ({
    useSettings: () => ({ settings: mockSettingsState, updateSetting: async () => {} }),
}));
const mockRunDistressWipe = jest.fn(async () => ({} as never));
jest.mock('@/databases/distressWipe', () => ({
    runDistressWipe: () => mockRunDistressWipe(),
    runDistressCleanup: async () => {},
}));
jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => ({ mock: 'db' }) }));
jest.mock('expo-router', () => ({ usePathname: () => '/', useRouter: () => ({ navigate: () => {} }) }));

let mockSubmit: ((pin: string) => Promise<void>) | null = null;
jest.mock('@/components/LockScreen', () => ({
    LockScreen: (props: { onSubmit: (pin: string) => Promise<void> }) => {
        mockSubmit = props.onSubmit;
        return null;
    },
}));

import { Text } from 'react-native';
import { AppLockProvider } from '@/context/AppLock';
import { MIN_UNLOCK_MS } from '@/lib/pinLock';
import { readFailures, setAppPin, setDistressPin } from '@/lib/pinStore';

jest.setTimeout(20_000);

beforeEach(async () => {
    store.__reset();
    mockRunDistressWipe.mockClear();
    mockSubmit = null;
    await setAppPin('2468');
    await setDistressPin('9999');
    mockSettingsState = {
        app_lock_enabled: true, distress_wipe_enabled: true, distress_wipe_scope: '{}', theme: 'dark', theme_mode: 'dark',
    };
});

const renderGate = async () => {
    const view = await render(<AppLockProvider><Text testID="journal">journal</Text></AppLockProvider>);
    await act(async () => {});
    return view;
};
const twiceInOneTick = (pin: string) => act(async () => {
    await Promise.all([mockSubmit!(pin), mockSubmit!(pin)]);
    await new Promise(r => setTimeout(r, MIN_UNLOCK_MS + 100));
});

it('the distress PIN submitted twice in one tick wipes once', async () => {
    await renderGate();
    await twiceInOneTick('9999');
    expect(mockRunDistressWipe).toHaveBeenCalledTimes(1);
});

it('a wrong PIN submitted twice in one tick counts once', async () => {
    await renderGate();
    await twiceInOneTick('1111');
    await waitFor(async () => expect((await readFailures()).failures).toBe(1));
});
