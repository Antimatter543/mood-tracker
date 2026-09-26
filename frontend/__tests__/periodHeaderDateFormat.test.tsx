/**
 * Wiring tests for THE BUG: the Statistics period header ignored the
 * `date_format` setting.
 *
 * `date_format` shipped in v2.14.0 and every other date display in the app
 * routes through lib/dateFormat.ts — except transforms/periodWindow.ts's
 * `formatDayRangeLabel`, which kept its own hardcoded month array and always
 * wrote month-before-day. A user who set DD/MM/YYYY got day-first everywhere
 * and month-first on the one header that captions the whole Stats screen.
 *
 * customRangeWindow.test.ts proves the TRANSFORM now honours every pref. What
 * it cannot prove, and what this file exists for, is that the preference
 * actually REACHES it:
 *   - `TimeframeProvider` reads the real setting (not a hardcoded default) and
 *     hands it to the transform — a fix wired to a defaulted parameter would
 *     pass every pure test and change nothing on screen,
 *   - the label RE-RENDERS when the setting changes, i.e. the pref is in the
 *     memo's dependency list and not captured once at mount,
 *   - the custom-range path is wired too (both the applied header label and the
 *     picker's own summary line, which promises to spell the range exactly the
 *     way the header will).
 *
 * Harness: the whole SettingsContext module is mocked (the pattern from
 * dateFormatSetting.test.tsx / remindersSection.test.tsx), so the REAL
 * `useDateFormat` hook runs on top of it — the chain under test is
 * settings -> useDateFormat -> TimeframeProvider -> formatDayRangeLabel, with
 * only the SQLite/settings edge stubbed.
 *
 * RNTL 14 is async-by-default: every render/fireEvent below is awaited.
 */
import React from 'react';
import { Pressable, Text } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

import type { Settings } from '@/databases/settings';
import type { DateFormatPref } from '@/lib/dateFormat';

// ── "Today" is pinned so every label below is stable forever. ────────────────
const TODAY = '2026-08-29';
jest.mock('@/components/visualisations/transforms/periodWindow', () => ({
    ...jest.requireActual('@/components/visualisations/transforms/periodWindow'),
    todayLocalDay: () => TODAY,
}));

// ── The setting under test. Read at RENDER time (the mock calls the jest.fn
//    inside useSettings), so a test can change it and re-render. ──────────────
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
const mockSettings = jest.fn<Settings, []>();
jest.mock('@/context/SettingsContext', () => ({
    useSettings: () => ({ settings: mockSettings(), updateSetting: jest.fn() }),
}));

// ── Mock DB: enough history that paging back is legal. ───────────────────────
const mockDb = {
    getFirstAsync: jest.fn(async () => ({ date: '2024-01-01T00:00:00.000Z' })),
    getAllAsync: jest.fn().mockResolvedValue([]),
};
jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => mockDb }));

// ── useFocusEffect models FOCUS GAIN only (mount-once). ──────────────────────
jest.mock('expo-router', () => {
    const ReactActual = require('react') as typeof React;
    return {
        useFocusEffect: (cb: () => void | (() => void)) => {
            // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only; the ref keeps the latest cb without re-running on identity change
            const ref = ReactActual.useRef(cb);
            ref.current = cb;
            ReactActual.useEffect(() => ref.current(), []);
        },
    };
});

jest.mock('@/context/dataRefreshStore', () => ({ useDataVersion: () => 0 }));

// ── The real month grid is outside jest's transform allowlist. This stub keeps
//    the one contract the picker depends on: onDayPress({ dateString }). ──────
jest.mock('react-native-calendars', () => {
    const ReactActual = require('react') as typeof React;
    const RN = require('react-native') as typeof import('react-native');
    // Both BEFORE the pinned today: a future end is clamped to today by
    // normaliseCustomRange, which would quietly change the range under test.
    const DAYS = ['2026-07-20', '2026-08-15'];
    return {
        Calendar: ({ onDayPress }: { onDayPress: (d: { dateString: string }) => void }) =>
            ReactActual.createElement(
                RN.View,
                { testID: 'calendar-stub' },
                ...DAYS.map((day) =>
                    ReactActual.createElement(
                        RN.Pressable,
                        {
                            key: day,
                            testID: `cal-day-${day}`,
                            onPress: () => onDayPress({ dateString: day }),
                        },
                        ReactActual.createElement(RN.Text, null, day),
                    ),
                ),
            ),
    };
});

// jest-expo does not auto-mock safe-area-context, and OverlayModal reads
// useSafeAreaInsets (it consumes the IME/nav-bar inset in JS under edge-to-edge).
jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 24, bottom: 48, left: 0, right: 0 }),
}));
jest.mock('@/hooks/useKeyboardHeight', () => ({ useKeyboardHeight: () => 0 }));

// OverlayModal imports reanimated, whose real module AND its own mock.js
// initialise the native worklets runtime at import time — unavailable under
// jest. Shim exactly the surface OverlayModal uses (same scoped shim as
// customRangeNavigation.test.tsx).
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

jest.mock('@/styles/global', () => ({
    useThemeColors: () => ({
        background: '#000',
        cardBackground: '#111',
        secondaryBackground: '#222',
        text: '#fff',
        textSecondary: '#aaa',
        border: '#333',
        accent: '#4CAF50',
        accentDark: '#388E3C',
        accentLight: 'rgba(76,175,80,0.1)',
        overlays: { tag: '#222', tagBorder: '#333', border: '#333', textSecondary: '#aaa' },
        elevation: { shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, elevation: 8 },
        isDark: true,
    }),
}));

import PeriodNavigator from '@/components/PeriodNavigator';
import { OverlayProvider } from '@/context/OverlayHost';
import { TimeframeProvider, useTimeframe, type Timeframe } from '@/context/TimeframeContext';

/** Lets a test switch the period LENGTH without going through the pill row. */
const Probe: React.FC = () => {
    const { setTimeframe } = useTimeframe();
    return (
        <>
            {(['week', 'month', '3months', 'year', 'alltime'] as Timeframe[]).map((tf) => (
                <Pressable key={tf} testID={`set-${tf}`} onPress={() => setTimeframe(tf)}>
                    <Text>{tf}</Text>
                </Pressable>
            ))}
        </>
    );
};

const Tree: React.FC = () => (
    <OverlayProvider>
        <TimeframeProvider>
            <PeriodNavigator />
            <Probe />
        </TimeframeProvider>
    </OverlayProvider>
);

/** Renders and waits for the earliest-entry query to settle. */
const renderHeader = async () => {
    const view = await render(<Tree />);
    await waitFor(() => expect(mockDb.getFirstAsync).toHaveBeenCalled());
    await act(async () => {});
    return view;
};

/**
 * The header's own Text node. Its own testID on purpose: the button wrapping it
 * also contains the calendar glyph, which Feather renders as a Text node, so a
 * text assertion on the BUTTON would silently include an invisible codepoint.
 */
const headerLabel = (view: Awaited<ReturnType<typeof render>>): string =>
    view.getByTestId('period-nav-label-text').props.children;

const press = (view: Awaited<ReturnType<typeof render>>, testID: string) =>
    fireEvent.press(view.getByTestId(testID));

const withPref = (pref: DateFormatPref) =>
    mockSettings.mockReturnValue({ ...baseSettings, date_format: pref });

beforeEach(() => {
    jest.clearAllMocks();
    mockDb.getFirstAsync.mockResolvedValue({ date: '2024-01-01T00:00:00.000Z' });
    withPref('system');
});

describe('the Stats period header follows the date_format setting', () => {
    // The default preset is 'month' (30 trailing days ending today).
    it.each([
        ['system', 'Jul 31 – Aug 29'],
        ['mdy', 'Jul 31 – Aug 29'],
        ['dmy', '31 Jul – 29 Aug'],
        ['ymd', '07-31 – 08-29'],
    ] as Array<[DateFormatPref, string]>)(
        'writes the default month period as %s -> "%s"',
        async (pref, expected) => {
            withPref(pref);
            const view = await renderHeader();
            expect(headerLabel(view)).toBe(expected);
        },
    );

    // Month-granularity presets (3 months / year) are the branch where only ymd
    // differs — a day-first user still reads month names, an ISO user does not.
    it.each([
        ['mdy', 'Aug 2025 – Aug 2026'],
        ['dmy', 'Aug 2025 – Aug 2026'],
        ['ymd', '2025-08 – 2026-08'],
    ] as Array<[DateFormatPref, string]>)(
        'writes the year preset (month granularity) as %s -> "%s"',
        async (pref, expected) => {
            withPref(pref);
            const view = await renderHeader();
            await press(view, 'set-year');
            expect(headerLabel(view)).toBe(expected);
        },
    );

    // The regression a defaulted parameter would hide: the label has to be
    // recomputed when the preference changes, not captured once at mount.
    it('re-renders the label when the setting changes', async () => {
        const view = await renderHeader();
        expect(headerLabel(view)).toBe('Jul 31 – Aug 29');

        withPref('dmy');
        await view.rerender(<Tree />);
        expect(headerLabel(view)).toBe('31 Jul – 29 Aug');

        withPref('ymd');
        await view.rerender(<Tree />);
        expect(headerLabel(view)).toBe('07-31 – 08-29');
    });

    // Paging out of the current year is where each ordering's own year rule
    // kicks in (appended for month names, carried up front for ISO).
    it.each([
        ['mdy', 'Nov 16 – 22, 2025'],
        ['dmy', '16 – 22 Nov 2025'],
        ['ymd', '2025-11-16 – 2025-11-22'],
    ] as Array<[DateFormatPref, string]>)(
        'applies %s\'s own year rule once you page out of this year',
        async (pref, expected) => {
            withPref(pref);
            const view = await renderHeader();
            await press(view, 'set-week');
            for (let i = 0; i < 40; i++) {
                await press(view, 'period-nav-back');
            }
            expect(headerLabel(view)).toBe(expected);
        },
    );
});

describe('the custom-range path follows the setting too', () => {
    /** Opens the picker and taps the two stubbed days (does NOT apply). */
    const pickRange = async (view: Awaited<ReturnType<typeof render>>) => {
        await press(view, 'period-nav-label');
        await press(view, 'cal-day-2026-07-20');
        await press(view, 'cal-day-2026-08-15');
    };

    it('writes the applied range in the chosen order', async () => {
        withPref('dmy');
        const view = await renderHeader();
        await pickRange(view);
        await press(view, 'date-range-apply');
        expect(headerLabel(view)).toBe('20 Jul – 15 Aug');
    });

    it("spells the picker's summary the way the header will (the promise it makes)", async () => {
        withPref('ymd');
        const view = await renderHeader();
        await pickRange(view);
        // The user must see the label they are about to get, plus the day count.
        expect(view.getByTestId('date-range-summary').props.children).toBe(
            '07-20 – 08-15 · 27 days',
        );

        await press(view, 'date-range-apply');
        expect(headerLabel(view)).toBe('07-20 – 08-15');
    });
});
