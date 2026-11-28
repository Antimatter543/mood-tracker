/**
 * PinSetupDialog reports WHICH PIN it took (components/PinSetupDialog.tsx).
 * The Settings card writes the slot from this mode, never from its own state,
 * so a distress PIN can never land in the app slot (that would make the
 * "distress" PIN open the app without a wipe and lock out the real app PIN).
 */
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { PinSetupDialog, PinSetupMode } from '@/components/PinSetupDialog';
import { OverlayProvider } from '@/context/OverlayHost';
import { PIN_SETUP_COPY } from '@/lib/appLock';
import { setAppPin } from '@/lib/pinStore';

const store = SecureStore as unknown as { __reset: () => void };
type View = Awaited<ReturnType<typeof render>>;
const typePin = async (view: View, pin: string) => {
    for (const d of pin) await fireEvent.press(view.getByTestId(`pin-key-${d}`));
    await fireEvent.press(view.getByTestId('pin-key-ok'));
};

beforeEach(async () => {
    store.__reset();
    await setAppPin('2468');
});

it.each(Object.keys(PIN_SETUP_COPY) as PinSetupMode[])('mode "%s": done reports that mode with the PIN', async (mode) => {
    const onDone = jest.fn();
    const view = await render(
        <OverlayProvider>
            <PinSetupDialog visible mode={mode} onCancel={() => {}} onDone={onDone} />
        </OverlayProvider>
    );
    await waitFor(() => expect(view.getByTestId('pin-setup-title').props.children).toBe(PIN_SETUP_COPY[mode].title));
    await typePin(view, '9753');
    await waitFor(() => expect(view.getByTestId('pin-setup-title').props.children).toBe(PIN_SETUP_COPY[mode].confirm));
    await typePin(view, '9753');
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('9753', mode));
});
