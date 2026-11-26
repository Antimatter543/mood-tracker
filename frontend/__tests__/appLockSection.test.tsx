/**
 * Settings > Privacy & security (components/AppLockSection.tsx): both options
 * default OFF, the lock only turns on after a successful prompt, the distress
 * wipe only after a destructive warning that asks for a backup, and turning the
 * lock off takes the distress wipe with it.
 *
 * RNTL v14: render / fireEvent are awaited (tasks/lessons.md 2026-08-29).
 */
import React, { useState } from 'react';
import { Alert, Linking } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import * as LocalAuth from 'expo-local-authentication';
import { ANDROID_BIOMETRIC_RULE_URL, APP_LOCK_COPY } from '@/lib/appLock';
import { DISTRESS_CATEGORIES, DISTRESS_CATEGORY_COPY } from '@/lib/distressScope';

const auth = LocalAuth as unknown as {
    __reset: () => void;
    __setCapabilities: (c: object) => void;
};

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

const mockConfirmIdentity = jest.fn(async () => true);
jest.mock('@/context/AppLock', () => ({
    useAppLock: () => ({ confirmIdentity: () => mockConfirmIdentity() }),
}));

import { AppLockSection } from '@/components/AppLockSection';

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
    return <AppLockSection />;
}

type AlertButton = { text: string; onPress?: () => void };
let alertSpy: jest.SpyInstance;
/**
 * The button the NEXT Alert "presses" as soon as it opens. (The toggle handler
 * awaits the confirm, and RNTL v14's fireEvent awaits the handler, so the
 * answer has to be decided before the press.)
 */
let alertAnswer: string | null = null;

beforeEach(() => {
    auth.__reset();
    mockUpdateSetting.mockClear();
    mockConfirmIdentity.mockReset().mockResolvedValue(true);
    alertAnswer = null;
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(((_t: string, _m: string, buttons?: AlertButton[]) => {
        if (alertAnswer) buttons?.find(b => b.text === alertAnswer)?.onPress?.();
    }) as never);
});
afterEach(() => jest.restoreAllMocks());

describe('AppLockSection', () => {
    it('defaults: lock off, and the distress option is not even offered', async () => {
        const view = await render(<Harness initial={{}} />);
        expect(view.getByTestId('app-lock-switch').props.value).toBe(false);
        expect(view.queryByTestId('distress-wipe-switch')).toBeNull();
    });

    it('turning the lock on asks for biometrics first, then saves', async () => {
        const view = await render(<Harness initial={{}} />);
        await fireEvent(view.getByTestId('app-lock-switch'), 'valueChange', true);
        await waitFor(() => expect(mockUpdateSetting).toHaveBeenCalledWith('app_lock_enabled', true));
        expect(mockConfirmIdentity).toHaveBeenCalledTimes(1);
        expect(view.getByTestId('distress-wipe-switch').props.value).toBe(false);
    });

    it('a failed / cancelled prompt leaves the lock off', async () => {
        mockConfirmIdentity.mockResolvedValue(false);
        const view = await render(<Harness initial={{}} />);
        await fireEvent(view.getByTestId('app-lock-switch'), 'valueChange', true);
        await waitFor(() => expect(mockConfirmIdentity).toHaveBeenCalled());
        expect(mockUpdateSetting).not.toHaveBeenCalled();
        expect(view.getByTestId('app-lock-switch').props.value).toBe(false);
    });

    it('a phone with no screen lock explains what to set up instead', async () => {
        auth.__setCapabilities({ enrolled: false, securityLevel: 0 });
        const view = await render(<Harness initial={{}} />);
        await fireEvent(view.getByTestId('app-lock-switch'), 'valueChange', true);
        await waitFor(() => expect(alertSpy).toHaveBeenCalledWith(
            APP_LOCK_COPY.noScreenLockTitle, APP_LOCK_COPY.noScreenLock
        ));
        expect(mockConfirmIdentity).not.toHaveBeenCalled();
        expect(mockUpdateSetting).not.toHaveBeenCalled();
    });

    it('distress wipe shows the destructive warning, and Cancel keeps it off', async () => {
        alertAnswer = 'Cancel';
        const view = await render(<Harness initial={{ app_lock_enabled: true }} />);
        await fireEvent(view.getByTestId('distress-wipe-switch'), 'valueChange', true);
        await waitFor(() => expect(alertSpy).toHaveBeenCalled());
        const [title, message] = alertSpy.mock.calls.at(-1)!;
        expect(title).toBe(APP_LOCK_COPY.distressWarningTitle);
        expect(message).toMatch(/backup/i);
        await waitFor(() => expect(view.getByTestId('distress-wipe-switch')).toBeEnabled());
        expect(mockUpdateSetting).not.toHaveBeenCalled();
    });

    it('confirming the warning turns it on and keeps a backup reminder on screen', async () => {
        alertAnswer = 'Turn on';
        const view = await render(<Harness initial={{ app_lock_enabled: true }} />);
        await fireEvent(view.getByTestId('distress-wipe-switch'), 'valueChange', true);
        await waitFor(() => expect(mockUpdateSetting).toHaveBeenCalledWith('distress_wipe_enabled', true));
        expect(await view.findByTestId('distress-wipe-hint')).toBeTruthy();
    });

    it('distress wipe needs enrolled biometrics', async () => {
        auth.__setCapabilities({ enrolled: false, securityLevel: 1 });
        const view = await render(<Harness initial={{ app_lock_enabled: true }} />);
        await fireEvent(view.getByTestId('distress-wipe-switch'), 'valueChange', true);
        await waitFor(() => expect(alertSpy).toHaveBeenCalledWith(
            APP_LOCK_COPY.noBiometricsTitle, APP_LOCK_COPY.noBiometrics
        ));
        expect(mockUpdateSetting).not.toHaveBeenCalled();
    });

    it('turning the lock off also turns the distress wipe off', async () => {
        const view = await render(<Harness initial={{ app_lock_enabled: true, distress_wipe_enabled: true }} />);
        await fireEvent(view.getByTestId('app-lock-switch'), 'valueChange', false);
        await waitFor(() => expect(mockUpdateSetting).toHaveBeenCalledWith('app_lock_enabled', false));
        expect(mockUpdateSetting).toHaveBeenCalledWith('distress_wipe_enabled', false);
        expect(view.queryByTestId('distress-wipe-switch')).toBeNull();
        expect(view.queryByTestId('distress-wipe-hint')).toBeNull();
    });

    it('with distress on: one switch per category, all on by default, and what is always kept', async () => {
        const view = await render(<Harness initial={{ app_lock_enabled: true, distress_wipe_enabled: true }} />);
        for (const c of DISTRESS_CATEGORIES) {
            expect(view.getByTestId(`distress-scope-${c}`).props.value).toBe(true);
        }
        expect(view.getByText(APP_LOCK_COPY.distressAlwaysKept)).toBeTruthy();
    });

    it('the selection is hidden while distress is off', async () => {
        const view = await render(<Harness initial={{ app_lock_enabled: true }} />);
        expect(view.queryByTestId('distress-scope')).toBeNull();
    });

    it('switching a category off stores it', async () => {
        const view = await render(<Harness initial={{ app_lock_enabled: true, distress_wipe_enabled: true }} />);
        await fireEvent(view.getByTestId('distress-scope-health'), 'valueChange', false);
        await waitFor(() => expect(mockUpdateSetting).toHaveBeenCalledWith(
            'distress_wipe_scope', expect.any(String)
        ));
        const stored = JSON.parse(mockUpdateSetting.mock.calls.at(-1)![1]);
        expect(stored.health).toBe(false);
        expect(stored.notes).toBe(true);
        expect(view.getByTestId('distress-scope-health').props.value).toBe(false);
    });

    it('the warning lists only what the current selection erases', async () => {
        alertAnswer = 'Cancel';
        const view = await render(
            <Harness initial={{ app_lock_enabled: true, distress_wipe_scope: '{"health":false}' }} />
        );
        await fireEvent(view.getByTestId('distress-wipe-switch'), 'valueChange', true);
        await waitFor(() => expect(alertSpy).toHaveBeenCalled());
        const message = alertSpy.mock.calls.at(-1)![1] as string;
        expect(message).toContain(DISTRESS_CATEGORY_COPY.notes.label);
        expect(message).not.toContain(DISTRESS_CATEGORY_COPY.health.label);
    });

    it('technical details open on tap and link the Android rule', async () => {
        const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
        const view = await render(<Harness initial={{ app_lock_enabled: true, distress_wipe_enabled: true }} />);
        expect(view.queryByTestId('distress-details')).toBeNull();
        await fireEvent.press(view.getByTestId('distress-details-toggle'));
        expect(view.getByTestId('distress-details')).toBeTruthy();
        await fireEvent.press(view.getByText(/Compatibility Definition, 7\.3\.10/));
        expect(openURL).toHaveBeenCalledWith(ANDROID_BIOMETRIC_RULE_URL);
    });
});
