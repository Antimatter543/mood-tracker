/**
 * Render/interaction tests for the "Date format" row in the Settings card
 * (components/SettingRow.tsx `SettingsSection`), the surface a 5-star Play
 * reviewer asked for ("is there a way I can change the MM/DD format to DD/MM?").
 *
 * What this locks:
 *  - The row EXISTS and is reachable (it is rendered generically from
 *    SETTINGS_REGISTRY, so a registry typo would silently drop it).
 *  - Each option is labelled with today's date as a live example, which is the
 *    whole reason the labels are built at render instead of being static.
 *  - Picking one persists the preference through `updateSetting`.
 *
 * Harness mirrors __tests__/remindersSection.test.tsx: the whole
 * SettingsContext module is mocked (which also drives the REAL useThemeColors),
 * and the option list renders through the app's REAL in-tree OverlayProvider,
 * never a native <Modal> (see the project CLAUDE.md gotcha).
 *
 * @testing-library/react-native v14 is async-by-default: every render() and
 * fireEvent.*() below is awaited, or the interaction silently no-ops.
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

import { OverlayProvider } from '@/context/OverlayHost';
import type { Settings } from '@/databases/settings';
import { formatDate } from '@/lib/dateFormat';

const mockSettings = jest.fn<Settings, []>();
const mockUpdateSetting = jest.fn(async (_key: string, _value: string) => {});
jest.mock('@/context/SettingsContext', () => ({
    useSettings: () => ({ settings: mockSettings(), updateSetting: mockUpdateSetting }),
}));

jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/hooks/useKeyboardHeight', () => ({
    useKeyboardHeight: () => 0,
}));
jest.mock('react-native-reanimated', () => {
    const ReactLocal = require('react');
    const { View } = require('react-native');
    const entering = { duration: () => entering };
    return {
        __esModule: true,
        default: {
            View: (props: Record<string, unknown>) => ReactLocal.createElement(View, props),
        },
        FadeIn: entering,
    };
});

import { SettingsSection } from '@/components/SettingRow';

const baseSettings: Settings = {
    fab_position: 'right',
    theme_mode: 'dark',
    theme: 'dark',
    mood_precision: 'low',
    show_mood_benchmarks: true,
    activity_carryover: false,
    date_format: 'system',
    reminders: '[]',
};

const renderSettings = () =>
    render(
        <OverlayProvider>
            <SettingsSection />
        </OverlayProvider>,
    );

describe('the Date format setting row', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockSettings.mockReturnValue({ ...baseSettings });
    });

    it('renders the row with the current choice on its button', async () => {
        const view = await renderSettings();
        expect(view.getByText('Date format')).toBeTruthy();
        // The button shows the SELECTED option's label, examples and all, so the
        // user can read their current format without opening the picker.
        expect(view.getByText(/^System default \(/)).toBeTruthy();
    });

    it('shows the explicit format the user has chosen', async () => {
        mockSettings.mockReturnValue({ ...baseSettings, date_format: 'dmy' });
        const view = await renderSettings();
        expect(view.getByText(/^DD\/MM\/YYYY \(/)).toBeTruthy();
    });

    it('offers all four formats, each with today’s date as an example', async () => {
        const view = await renderSettings();
        await fireEvent.press(view.getByText(/^System default \(/));

        const today = new Date();
        for (const [label, pref] of [
            ['MM/DD/YYYY', 'mdy'],
            ['DD/MM/YYYY', 'dmy'],
            ['YYYY-MM-DD', 'ymd'],
        ] as const) {
            // The example must be TODAY rendered that way, not a static string.
            const expected = `${label} (${formatDate(today, pref, 'numeric')})`;
            await waitFor(() => expect(view.getByText(expected)).toBeTruthy());
        }
    });

    it('persists the picked format', async () => {
        const view = await renderSettings();
        await fireEvent.press(view.getByText(/^System default \(/));

        const dmy = await waitFor(() => view.getByText(/^DD\/MM\/YYYY \(/));
        await fireEvent.press(dmy);

        expect(mockUpdateSetting).toHaveBeenCalledWith('date_format', 'dmy');
    });

    it('does not disturb the other settings when picked', async () => {
        const view = await renderSettings();
        await fireEvent.press(view.getByText(/^System default \(/));
        await fireEvent.press(await waitFor(() => view.getByText(/^YYYY-MM-DD \(/)));

        // Selecting a THEME also writes theme_mode (see SettingsSection); the
        // date format must write exactly one key and nothing else.
        expect(mockUpdateSetting).toHaveBeenCalledTimes(1);
        expect(mockUpdateSetting).toHaveBeenCalledWith('date_format', 'ymd');
    });
});
