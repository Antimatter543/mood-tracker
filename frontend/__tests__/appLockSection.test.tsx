/**
 * Settings > Privacy & security (components/AppLockSection.tsx): the app lock
 * is a PIN (typed twice), the distress PIN is a second PIN behind a short
 * confirmation, and the advanced selection lives behind Technical details.
 *
 * Real: the card, PinSetupDialog, PinPad, lib/pinStore (in-memory SecureStore). Fake: the settings store.
 * RNTL v14: render / fireEvent are awaited (tasks/lessons.md 2026-08-29).
 */
import React, { useState } from 'react';
import { Alert, StyleSheet } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { APP_LOCK_COPY } from '@/lib/appLock';
import { DEFAULT_DISTRESS_SCOPE, DISTRESS_CATEGORIES, DISTRESS_CATEGORY_COPY, keptSummary } from '@/lib/distressScope';
import { checkPin, setAppPin } from '@/lib/pinStore';
import { findNodes } from '@/testing/rntl';

const store = SecureStore as unknown as { __reset: () => void };

type S = { app_lock_enabled: boolean; distress_wipe_enabled: boolean; distress_wipe_scope: string; theme: string; theme_mode: string };
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

import { AppLockSection } from '@/components/AppLockSection';
import { OverlayProvider } from '@/context/OverlayHost';

type View = Awaited<ReturnType<typeof render>>;

/** Type a PIN on the pad and press the arrow. */
const typePin = async (view: View, pin: string) => {
    for (const d of pin) await fireEvent.press(view.getByTestId(`pin-key-${d}`));
    await fireEvent.press(view.getByTestId('pin-key-ok'));
};
/** Choose a PIN in the setup dialog (typed twice). */
const choosePin = async (view: View, pin: string) => {
    await waitFor(() => expect(view.getByTestId('pin-setup')).toBeTruthy());
    await typePin(view, pin);
    await waitFor(() => expect(view.getByTestId('pin-setup-title').props.children).toMatch(/again/));
    await typePin(view, pin);
    await waitFor(() => expect(view.queryByTestId('pin-setup')).toBeNull());
};
const openDetails = async (view: View) => {
    await fireEvent.press(view.getByTestId('distress-details-toggle'));
    await waitFor(() => expect(view.getByTestId('distress-details')).toBeTruthy());
};

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
        <OverlayProvider>
            <AppLockSection />
        </OverlayProvider>
    );
}

type AlertButton = { text: string; onPress?: () => void };
let alertSpy: jest.SpyInstance;
/** The button the NEXT Alert presses as soon as it opens. */
let alertAnswer: string | null = null;

beforeEach(() => {
    store.__reset();
    mockUpdateSetting.mockClear();
    alertAnswer = null;
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(((_t: string, _m: string, buttons?: AlertButton[]) => {
        if (alertAnswer) buttons?.find(b => b.text === alertAnswer)?.onPress?.();
    }) as never);
});
afterEach(() => jest.restoreAllMocks());

describe('AppLockSection', () => {
    it('defaults: lock off, no distress option', async () => {
        const view = await render(<Harness initial={{}} />);
        expect(view.getByTestId('app-lock-switch').props.value).toBe(false);
        expect(view.queryByTestId('distress-wipe-switch')).toBeNull();
    });

    it('turning the lock on asks for a PIN twice, stores it, and only then turns on', async () => {
        const view = await render(<Harness initial={{}} />);
        await fireEvent(view.getByTestId('app-lock-switch'), 'valueChange', true);
        expect(mockUpdateSetting).not.toHaveBeenCalled();
        await choosePin(view, '2468');
        await waitFor(() => expect(mockUpdateSetting).toHaveBeenCalledWith('app_lock_enabled', true));
        expect(await checkPin('2468')).toBe('app');
    });

    it('a mismatched confirmation starts over and turns nothing on', async () => {
        const view = await render(<Harness initial={{}} />);
        await fireEvent(view.getByTestId('app-lock-switch'), 'valueChange', true);
        await waitFor(() => expect(view.getByTestId('pin-setup')).toBeTruthy());
        await typePin(view, '2468');
        await typePin(view, '1357');
        await waitFor(() => expect(view.getByTestId('pin-setup-error').props.children).toMatch(/don't match/));
        expect(mockUpdateSetting).not.toHaveBeenCalled();
    });

    it('cancelling the PIN setup leaves the lock off', async () => {
        const view = await render(<Harness initial={{}} />);
        await fireEvent(view.getByTestId('app-lock-switch'), 'valueChange', true);
        await waitFor(() => expect(view.getByTestId('pin-setup')).toBeTruthy());
        await fireEvent.press(view.getByTestId('pin-setup-close'));
        await waitFor(() => expect(view.queryByTestId('pin-setup')).toBeNull());
        expect(view.getByTestId('app-lock-switch').props.value).toBe(false);
    });

    it('setting the app PIN says a forgotten PIN cannot be reset', async () => {
        const view = await render(<Harness initial={{}} />);
        await fireEvent(view.getByTestId('app-lock-switch'), 'valueChange', true);
        await waitFor(() => expect(view.getByTestId('pin-setup')).toBeTruthy());
        expect(view.getByTestId('pin-setup-note').props.children).toMatch(/no way to reset a forgotten PIN/);
    });

    it('distress PIN: short confirmation, then a second PIN that must differ from the app PIN', async () => {
        await setAppPin('2468');
        alertAnswer = 'Choose PIN';
        const view = await render(<Harness initial={{ app_lock_enabled: true }} />);
        await fireEvent(view.getByTestId('distress-wipe-switch'), 'valueChange', true);
        await waitFor(() => expect(alertSpy).toHaveBeenCalled());
        const [title, message] = alertSpy.mock.calls.at(-1)!;
        expect(title).toBe(APP_LOCK_COPY.distressWarningTitle);
        expect(message).toMatch(/notes, photos and other private details/);

        await waitFor(() => expect(view.getByTestId('pin-setup')).toBeTruthy());
        await typePin(view, '2468'); // the app PIN: refused
        await waitFor(() => expect(view.getByTestId('pin-setup-error').props.children).toMatch(/different/));
        await choosePin(view, '9999');
        await waitFor(() => expect(mockUpdateSetting).toHaveBeenCalledWith('distress_wipe_enabled', true));
        expect(await checkPin('9999')).toBe('distress');
        expect(await checkPin('2468')).toBe('app');
        expect(view.getByTestId('distress-wipe-hint')).toBeTruthy();
    });

    it('Cancel on the confirmation sets no distress PIN', async () => {
        await setAppPin('2468');
        alertAnswer = 'Cancel';
        const view = await render(<Harness initial={{ app_lock_enabled: true }} />);
        await fireEvent(view.getByTestId('distress-wipe-switch'), 'valueChange', true);
        await waitFor(() => expect(alertSpy).toHaveBeenCalled());
        expect(view.queryByTestId('pin-setup')).toBeNull();
        expect(mockUpdateSetting).not.toHaveBeenCalled();
    });

    it('switching the distress PIN off forgets it', async () => {
        await setAppPin('2468');
        const { setDistressPin } = jest.requireActual('@/lib/pinStore');
        await setDistressPin('9999');
        const view = await render(<Harness initial={{ app_lock_enabled: true, distress_wipe_enabled: true }} />);
        await fireEvent(view.getByTestId('distress-wipe-switch'), 'valueChange', false);
        await waitFor(() => expect(mockUpdateSetting).toHaveBeenCalledWith('distress_wipe_enabled', false));
        expect(await checkPin('9999')).toBe('wrong');
    });

    it('turning the lock off forgets both PINs and turns distress off', async () => {
        await setAppPin('2468');
        const view = await render(<Harness initial={{ app_lock_enabled: true, distress_wipe_enabled: true }} />);
        await fireEvent(view.getByTestId('app-lock-switch'), 'valueChange', false);
        await waitFor(() => expect(mockUpdateSetting).toHaveBeenCalledWith('app_lock_enabled', false));
        expect(mockUpdateSetting).toHaveBeenCalledWith('distress_wipe_enabled', false);
        expect(await checkPin('2468')).toBe('wrong');
    });

    it('Change PIN replaces the app PIN', async () => {
        await setAppPin('2468');
        const view = await render(<Harness initial={{ app_lock_enabled: true }} />);
        await fireEvent.press(view.getByTestId('app-lock-change-pin'));
        await choosePin(view, '1357');
        await waitFor(async () => expect(await checkPin('1357')).toBe('app'));
        expect(await checkPin('2468')).toBe('wrong');
    });

    it('each PIN has its own change link, under its own row', async () => {
        await setAppPin('2468');
        const { setDistressPin } = jest.requireActual('@/lib/pinStore');
        await setDistressPin('9999');
        const view = await render(<Harness initial={{ app_lock_enabled: true, distress_wipe_enabled: true }} />);
        expect(view.getByTestId('app-lock-change-pin')).toBeTruthy();
        expect(view.getByText(APP_LOCK_COPY.changePin)).toBeTruthy();
        expect(view.getByText(APP_LOCK_COPY.changeDistressPin)).toBeTruthy();
        // render order: app lock switch < Change app PIN < distress switch < Change distress PIN
        const ids = findNodes(view.toJSON(), n => typeof n.props?.testID === 'string').map(n => n.props!.testID as string);
        const at = (id: string) => ids.indexOf(id);
        expect(at('app-lock-switch')).toBeLessThan(at('app-lock-change-pin'));
        expect(at('app-lock-change-pin')).toBeLessThan(at('distress-wipe-switch'));
        expect(at('distress-wipe-switch')).toBeLessThan(at('distress-change-pin'));
    });

    it('without a distress PIN there is nothing to change but the app PIN', async () => {
        await setAppPin('2468');
        const view = await render(<Harness initial={{ app_lock_enabled: true }} />);
        expect(view.getByTestId('app-lock-change-pin')).toBeTruthy();
        expect(view.queryByTestId('distress-change-pin')).toBeNull();
    });

    it('Change distress PIN replaces only the distress PIN and must differ from the app PIN', async () => {
        await setAppPin('2468');
        const { setDistressPin } = jest.requireActual('@/lib/pinStore');
        await setDistressPin('9999');
        const view = await render(<Harness initial={{ app_lock_enabled: true, distress_wipe_enabled: true }} />);
        await fireEvent.press(view.getByTestId('distress-change-pin'));
        await waitFor(() => expect(view.getByTestId('pin-setup')).toBeTruthy());
        await typePin(view, '2468'); // the app PIN: refused
        await waitFor(() => expect(view.getByTestId('pin-setup-error').props.children).toMatch(/different from your app PIN/));
        await choosePin(view, '7777');
        await waitFor(async () => expect(await checkPin('7777')).toBe('distress'));
        expect(await checkPin('9999')).toBe('wrong');
        expect(await checkPin('2468')).toBe('app');
        // no confirmation, no setting change: the distress PIN just moved
        expect(alertSpy).not.toHaveBeenCalled();
        expect(mockUpdateSetting).not.toHaveBeenCalled();
    });

    it('Change app PIN refuses the distress PIN', async () => {
        await setAppPin('2468');
        const { setDistressPin } = jest.requireActual('@/lib/pinStore');
        await setDistressPin('9999');
        const view = await render(<Harness initial={{ app_lock_enabled: true, distress_wipe_enabled: true }} />);
        await fireEvent.press(view.getByTestId('app-lock-change-pin'));
        await waitFor(() => expect(view.getByTestId('pin-setup')).toBeTruthy());
        await typePin(view, '9999');
        await waitFor(() => expect(view.getByTestId('pin-setup-error').props.children).toMatch(/different from your distress PIN/));
        expect(await checkPin('2468')).toBe('app');
        expect(await checkPin('9999')).toBe('distress');
    });

    it('normal users see no category switches: they live behind Technical details', async () => {
        const view = await render(<Harness initial={{ app_lock_enabled: true, distress_wipe_enabled: true }} />);
        expect(view.queryByTestId('distress-scope')).toBeNull();
        await openDetails(view);
        for (const c of DISTRESS_CATEGORIES) {
            expect(view.getByTestId(`distress-scope-${c}`).props.value).toBe(DEFAULT_DISTRESS_SCOPE[c]);
        }
        expect(view.getByTestId('distress-kept').props.children).toBe(keptSummary(DEFAULT_DISTRESS_SCOPE));
        expect(view.getByTestId('distress-why-default').props.children).toBe(APP_LOCK_COPY.distressWhyDefault);
    });

    it('Technical details scrolls under a real finger: its body takes the touch (#43 pattern)', async () => {
        const view = await render(<Harness initial={{ app_lock_enabled: true, distress_wipe_enabled: true }} />);
        await openDetails(view);
        const body = view.getByTestId('distress-details-body');
        // Without this, a drag starting on text went to the overlay card's Pressable, not the list.
        expect(body.props.onStartShouldSetResponder?.()).toBe(true);
        const scroll = view.getByTestId('distress-details-scroll');
        expect(scroll.props.persistentScrollbar).toBe(true);
        // The card shrinks to the window, the list inside it. A percentage maxHeight
        // resolved against the overlay wrapper that hugs the card and cut off its end (#56).
        const card = StyleSheet.flatten(view.getByTestId('distress-details').props.style);
        expect(card.maxHeight).toBeUndefined();
        expect(card.flexShrink).toBe(1);
        expect(StyleSheet.flatten(scroll.props.style)).toMatchObject({ flexGrow: 0, flexShrink: 1 });
        // the switches stay at the bottom, after the explanations
        const ids = findNodes(view.toJSON(), n => typeof n.props?.testID === 'string').map(n => n.props!.testID as string);
        expect(ids.indexOf('distress-why-default')).toBeLessThan(ids.indexOf('distress-scope-notes'));
    });

    it('switching a category off stores it, flags a custom selection, and can be reset', async () => {
        const view = await render(<Harness initial={{ app_lock_enabled: true, distress_wipe_enabled: true }} />);
        await openDetails(view);
        await fireEvent(view.getByTestId('distress-scope-health'), 'valueChange', false);
        await waitFor(() => expect(view.getByTestId('distress-scope-health').props.value).toBe(false));
        expect(JSON.parse(mockUpdateSetting.mock.calls.at(-1)![1]).health).toBe(false);
        expect(view.getByTestId('distress-custom-scope')).toBeTruthy();
        await fireEvent.press(view.getByTestId('distress-scope-reset'));
        await waitFor(() => expect(view.queryByTestId('distress-custom-scope')).toBeNull());
    });

    it('a custom selection is listed in full in the confirmation', async () => {
        await setAppPin('2468');
        alertAnswer = 'Cancel';
        const view = await render(<Harness initial={{ app_lock_enabled: true, distress_wipe_scope: '{"health":false}' }} />);
        await fireEvent(view.getByTestId('distress-wipe-switch'), 'valueChange', true);
        await waitFor(() => expect(alertSpy).toHaveBeenCalled());
        const message = alertSpy.mock.calls.at(-1)![1] as string;
        expect(message).toContain(DISTRESS_CATEGORY_COPY.notes.label);
        expect(message).not.toContain(DISTRESS_CATEGORY_COPY.health.label);
    });

    it('erasing all entries needs its own confirmation; Cancel keeps it off', async () => {
        alertAnswer = 'Cancel';
        const view = await render(<Harness initial={{ app_lock_enabled: true, distress_wipe_enabled: true }} />);
        await openDetails(view);
        await fireEvent(view.getByTestId('distress-scope-entries'), 'valueChange', true);
        await waitFor(() => expect(alertSpy).toHaveBeenCalledWith(
            APP_LOCK_COPY.eraseEntriesTitle, APP_LOCK_COPY.eraseEntriesWarning, expect.anything(), expect.anything()
        ));
        expect(view.getByTestId('distress-scope-entries').props.value).toBe(false);
    });
});
