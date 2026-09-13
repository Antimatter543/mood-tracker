/**
 * Wiring tests for the CUSTOM DATE RANGE: TimeframeProvider + PeriodNavigator +
 * DateRangePicker, end to end from a tap on the header label to the window the
 * charts query.
 *
 * customRangeWindow.test.ts / dateRangeSelection.test.ts already prove the math
 * and the two-tap protocol. What can still break is the WIRING, and every one of
 * these is a bug a user would hit on the Stats screen:
 *   - the picked days never reach `periodWindow`, so the charts keep showing the
 *     old period under the new label (or vice versa),
 *   - period paging stays live on a custom range, so a chevron or a swipe
 *     silently teleports the user back into a preset,
 *   - a pill tap doesn't clear the range (custom mode becomes a trap), or clears
 *     it but leaves a stale offset behind,
 *   - `windowDayCount` keeps reporting the preset length, which is the
 *     consistency KPI's denominator,
 *   - `isCurrentPeriod` stays true for a range that ended months ago, which is
 *     what makes the card show a LIVE streak next to historical data.
 *
 * A probe component renders the context values as text, so the assertions are on
 * the exact values the charts receive, not on a re-derivation of them.
 */
import React from 'react';
import { Text, Pressable, View } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

// ── "Today" is pinned so every window/label below is stable forever. ──────────
const TODAY = '2026-08-29';
jest.mock('@/components/visualisations/transforms/periodWindow', () => ({
    ...jest.requireActual('@/components/visualisations/transforms/periodWindow'),
    todayLocalDay: () => TODAY,
}));

// ── The real react-native-calendars is outside jest's transform allowlist (and
//    a month grid isn't what's under test). This stub keeps the CONTRACT the
//    picker depends on: `onDayPress({ dateString })`, plus `maxDate` and
//    `markedDates` exposed so the bound and the painted range stay assertable.
jest.mock('react-native-calendars', () => {
    const ReactActual = require('react') as typeof React;
    const RN = require('react-native') as typeof import('react-native');
    /** Days the stub offers as tappable cells — enough to span two months. */
    const DAYS = [
        '2026-03-05',
        '2026-07-20',
        '2026-08-10',
        '2026-08-15',
        '2026-08-27',
        '2026-08-29',
        '2026-09-13',
    ];
    return {
        Calendar: ({
            onDayPress,
            maxDate,
            markedDates,
        }: {
            onDayPress: (d: { dateString: string }) => void;
            maxDate?: string;
            markedDates?: Record<string, unknown>;
        }) =>
            ReactActual.createElement(
                RN.View,
                { testID: 'calendar-stub' },
                ReactActual.createElement(RN.Text, { testID: 'calendar-max-date' }, maxDate),
                ReactActual.createElement(
                    RN.Text,
                    { testID: 'calendar-marked' },
                    Object.keys(markedDates ?? {}).sort().join(','),
                ),
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

// ── Mock DB. `earliestEntryIso` is mutable so each test can set the history. ──
let earliestEntryIso: string | null = '2024-01-01T00:00:00.000Z';
const mockDb = {
    getFirstAsync: jest.fn(async () => ({ date: earliestEntryIso })),
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

/** Surfaces every context value a chart reads, plus a way to switch pills. */
const Probe: React.FC = () => {
    const {
        timeframe,
        offset,
        periodWindow,
        periodLabel,
        isCustom,
        windowDayCount,
        isCurrentPeriod,
        canGoBack,
        canGoForward,
        setTimeframe,
    } = useTimeframe();
    return (
        <View>
            <Text testID="probe-timeframe">{timeframe}</Text>
            <Text testID="probe-offset">{String(offset)}</Text>
            <Text testID="probe-window">{`${periodWindow.startDay}..${periodWindow.endDay}`}</Text>
            <Text testID="probe-sql">{`${periodWindow.start}|${periodWindow.end}`}</Text>
            <Text testID="probe-label">{periodLabel}</Text>
            <Text testID="probe-custom">{String(isCustom)}</Text>
            <Text testID="probe-days">{String(windowDayCount)}</Text>
            <Text testID="probe-current">{String(isCurrentPeriod)}</Text>
            <Text testID="probe-can-step">{`${canGoBack}/${canGoForward}`}</Text>
            {(['week', 'month', 'year', 'alltime'] as Timeframe[]).map((tf) => (
                <Pressable key={tf} testID={`set-${tf}`} onPress={() => setTimeframe(tf)}>
                    <Text>{tf}</Text>
                </Pressable>
            ))}
        </View>
    );
};

/** Renders the tree and waits for the earliest-entry query to settle. */
const renderStats = async () => {
    const view = await render(
        <OverlayProvider>
            <TimeframeProvider>
                <PeriodNavigator />
                <Probe />
            </TimeframeProvider>
        </OverlayProvider>,
    );
    await waitFor(() => expect(mockDb.getFirstAsync).toHaveBeenCalled());
    await act(async () => {});
    return view;
};

/** RNTL 14 is async-by-default: every fireEvent must be awaited. */
const press = (view: Awaited<ReturnType<typeof render>>, testID: string) =>
    fireEvent.press(view.getByTestId(testID));

/** Open the picker, tap two days, Apply. */
const pickRange = async (
    view: Awaited<ReturnType<typeof render>>,
    startDay: string,
    endDay: string,
) => {
    await press(view, 'period-nav-label');
    await press(view, `cal-day-${startDay}`);
    await press(view, `cal-day-${endDay}`);
    await press(view, 'date-range-apply');
};

beforeEach(() => {
    jest.clearAllMocks();
    earliestEntryIso = '2024-01-01T00:00:00.000Z';
});

describe('opening the picker', () => {
    it('is reachable by tapping the period label, and starts empty on a preset', async () => {
        const view = await renderStats();
        expect(view.queryByTestId('date-range-picker')).toBeNull();

        await press(view, 'period-nav-label');
        expect(view.getByTestId('date-range-picker')).toBeTruthy();
        // NOT pre-filled from the Month preset: the user didn't pick those days.
        expect(view.getByTestId('date-range-summary')).toHaveTextContent('Tap a start date');
        expect(view.getByTestId('calendar-marked').props.children).toBe('');
    });

    it('bounds the calendar at today, so the future is untappable', async () => {
        const view = await renderStats();
        await press(view, 'period-nav-label');
        expect(view.getByTestId('calendar-max-date')).toHaveTextContent(TODAY);
    });

    it('cannot be applied until BOTH ends are picked', async () => {
        const view = await renderStats();
        await press(view, 'period-nav-label');

        const applyDisabled = () =>
            view.getByTestId('date-range-apply').props.accessibilityState?.disabled;
        expect(applyDisabled()).toBe(true);

        await press(view, 'cal-day-2026-08-15');
        expect(view.getByTestId('date-range-summary')).toHaveTextContent('Now tap an end date');
        expect(applyDisabled()).toBe(true);

        await press(view, 'cal-day-2026-08-29');
        expect(view.getByTestId('date-range-summary')).toHaveTextContent(
            'Aug 15 – 29 · 15 days',
        );
        expect(applyDisabled()).toBe(false);
    });

    it('Cancel leaves the window exactly as it was', async () => {
        const view = await renderStats();
        const before = view.getByTestId('probe-window').props.children;

        await press(view, 'period-nav-label');
        await press(view, 'cal-day-2026-07-20');
        await press(view, 'cal-day-2026-08-15');
        await press(view, 'date-range-cancel');

        expect(view.queryByTestId('date-range-picker')).toBeNull();
        expect(view.getByTestId('probe-window').props.children).toBe(before);
        expect(view.getByTestId('probe-custom')).toHaveTextContent('false');
    });
});

describe('applying a custom range', () => {
    it('hands the charts the exact inclusive window, as whole local days', async () => {
        const view = await renderStats();
        await pickRange(view, '2026-08-15', '2026-09-13');

        expect(view.getByTestId('probe-custom')).toHaveTextContent('true');
        expect(view.getByTestId('probe-window')).toHaveTextContent('2026-08-15..2026-09-13');
        // Brisbane (UTC+10): whole local Aug 15 .. whole local Sep 13.
        expect(view.getByTestId('probe-sql')).toHaveTextContent(
            '2026-08-14T14:00:00.000Z|2026-09-13T13:59:59.999Z',
        );
        expect(view.getByTestId('probe-label')).toHaveTextContent('Aug 15 – Sep 13');
        expect(view.getByTestId('probe-days')).toHaveTextContent('30');
        expect(view.queryByTestId('date-range-picker')).toBeNull();
    });

    it('accepts the two days in either order', async () => {
        const view = await renderStats();
        await pickRange(view, '2026-09-13', '2026-08-15');
        expect(view.getByTestId('probe-window')).toHaveTextContent('2026-08-15..2026-09-13');
        expect(view.getByTestId('probe-label')).toHaveTextContent('Aug 15 – Sep 13');
    });

    it('handles a 3-day range: real day count, week-level granularity', async () => {
        const view = await renderStats();
        await pickRange(view, '2026-08-27', '2026-08-29');
        expect(view.getByTestId('probe-window')).toHaveTextContent('2026-08-27..2026-08-29');
        expect(view.getByTestId('probe-days')).toHaveTextContent('3');
        // The charts must bucket/label it like a week, not like the Month pill
        // that happened to be selected before.
        expect(view.getByTestId('probe-timeframe')).toHaveTextContent('week');
    });

    it('handles a multi-year range: year-level granularity', async () => {
        const view = await renderStats();
        await pickRange(view, '2026-03-05', '2026-08-29');
        expect(view.getByTestId('probe-days')).toHaveTextContent('178');
        expect(view.getByTestId('probe-timeframe')).toHaveTextContent('year');
    });

    it('reports a past-ending range as NOT the current period', async () => {
        const view = await renderStats();
        expect(view.getByTestId('probe-current')).toHaveTextContent('true');

        await pickRange(view, '2026-03-05', '2026-07-20');
        // This is what stops the summary card showing a live streak next to
        // months-old data.
        expect(view.getByTestId('probe-current')).toHaveTextContent('false');
    });

    it('still counts as the current period when the range ends today', async () => {
        const view = await renderStats();
        await pickRange(view, '2026-08-15', TODAY);
        expect(view.getByTestId('probe-custom')).toHaveTextContent('true');
        expect(view.getByTestId('probe-current')).toHaveTextContent('true');
    });

    it('allows a start earlier than the first entry', async () => {
        earliestEntryIso = '2026-08-01T00:00:00.000Z';
        const view = await renderStats();
        await pickRange(view, '2026-03-05', '2026-08-29');
        expect(view.getByTestId('probe-window')).toHaveTextContent('2026-03-05..2026-08-29');
    });
});

describe('paging is disabled on a custom range', () => {
    it('drops the chevrons entirely, like All Time', async () => {
        const view = await renderStats();
        expect(view.getByTestId('period-nav-back')).toBeTruthy();

        await pickRange(view, '2026-08-15', '2026-09-13');
        expect(view.queryByTestId('period-nav-back')).toBeNull();
        expect(view.queryByTestId('period-nav-forward')).toBeNull();
        // Also the signal PeriodSwipe reads — no swipe can smuggle the user back
        // into a preset period.
        expect(view.getByTestId('probe-can-step')).toHaveTextContent('false/false');
    });

    it('does not inherit an offset from the preset it replaced', async () => {
        const view = await renderStats();
        await press(view, 'set-week');
        for (let i = 0; i < 3; i++) await press(view, 'period-nav-back');
        expect(view.getByTestId('probe-offset')).toHaveTextContent('-3');

        await pickRange(view, '2026-08-15', '2026-09-13');
        expect(view.getByTestId('probe-offset')).toHaveTextContent('0');
        expect(view.getByTestId('probe-window')).toHaveTextContent('2026-08-15..2026-09-13');
    });
});

describe('leaving custom mode', () => {
    it('a pill tap clears the range and returns to that preset at offset 0', async () => {
        const view = await renderStats();
        await pickRange(view, '2026-03-05', '2026-07-20');
        expect(view.getByTestId('probe-custom')).toHaveTextContent('true');

        await press(view, 'set-week');
        expect(view.getByTestId('probe-custom')).toHaveTextContent('false');
        expect(view.getByTestId('probe-offset')).toHaveTextContent('0');
        expect(view.getByTestId('probe-window')).toHaveTextContent('2026-08-23..2026-08-29');
        expect(view.getByTestId('probe-label')).toHaveTextContent('Aug 23 – 29');
        expect(view.getByTestId('probe-days')).toHaveTextContent('7');
        expect(view.getByTestId('probe-can-step')).toHaveTextContent('true/false');
    });

    it('the ✕ control returns to the preset that was selected before', async () => {
        const view = await renderStats();
        await press(view, 'set-week');
        await pickRange(view, '2026-03-05', '2026-07-20');

        await press(view, 'period-nav-reset');
        expect(view.getByTestId('probe-custom')).toHaveTextContent('false');
        expect(view.getByTestId('probe-timeframe')).toHaveTextContent('week');
        expect(view.getByTestId('probe-window')).toHaveTextContent('2026-08-23..2026-08-29');
    });

    it('shows the ✕ only when the window is not the present one', async () => {
        const view = await renderStats();
        expect(view.queryByTestId('period-nav-reset')).toBeNull();

        await press(view, 'period-nav-back');
        expect(view.getByTestId('period-nav-reset')).toBeTruthy();

        await press(view, 'period-nav-reset');
        expect(view.queryByTestId('period-nav-reset')).toBeNull();

        // A custom range gets one even when it ends today: it is still a filter
        // the user needs a way out of.
        await pickRange(view, '2026-08-15', TODAY);
        expect(view.getByTestId('period-nav-reset')).toBeTruthy();
    });

    it('reopening the picker pre-selects the range the user picked', async () => {
        const view = await renderStats();
        await pickRange(view, '2026-08-15', '2026-08-29');

        await press(view, 'period-nav-label');
        expect(view.getByTestId('date-range-summary')).toHaveTextContent(
            'Aug 15 – 29 · 15 days',
        );
        // And a fresh tap starts over rather than extending it.
        await press(view, 'cal-day-2026-07-20');
        expect(view.getByTestId('date-range-summary')).toHaveTextContent('Now tap an end date');
    });

    it('does not carry a half-finished selection into the next session', async () => {
        const view = await renderStats();
        await press(view, 'period-nav-label');
        await press(view, 'cal-day-2026-07-20');
        await press(view, 'date-range-cancel');

        await press(view, 'period-nav-label');
        expect(view.getByTestId('date-range-summary')).toHaveTextContent('Tap a start date');
    });
});

describe('presets keep their exact previous behaviour', () => {
    it('paging, labels and day counts are untouched by the feature', async () => {
        const view = await renderStats();
        expect(view.getByTestId('probe-label')).toHaveTextContent('Jul 31 – Aug 29');
        expect(view.getByTestId('probe-days')).toHaveTextContent('30');

        await press(view, 'set-week');
        expect(view.getByTestId('probe-window')).toHaveTextContent('2026-08-23..2026-08-29');
        await press(view, 'period-nav-back');
        expect(view.getByTestId('probe-window')).toHaveTextContent('2026-08-16..2026-08-22');
        expect(view.getByTestId('probe-label')).toHaveTextContent('Aug 16 – 22');
        expect(view.getByTestId('probe-days')).toHaveTextContent('7');
        expect(view.getByTestId('probe-current')).toHaveTextContent('false');
        expect(view.getByTestId('probe-custom')).toHaveTextContent('false');
    });

    it("measures All Time's day count from the first entry, not from the epoch", async () => {
        // The old `daysInTimeframe` fudged this to a flat 365; the epoch-anchored
        // window would divide the consistency KPI by ~20,000 days and read 0%.
        earliestEntryIso = '2026-08-20T00:00:00.000Z';
        const view = await renderStats();
        await press(view, 'set-alltime');
        expect(view.getByTestId('probe-days')).toHaveTextContent('10');
        expect(view.getByTestId('probe-current')).toHaveTextContent('true');
    });

    it('falls back to a year for All Time while the first entry is unknown', async () => {
        mockDb.getFirstAsync.mockRejectedValueOnce(new Error('db gone'));
        const view = await renderStats();
        await press(view, 'set-alltime');
        expect(view.getByTestId('probe-days')).toHaveTextContent('365');
    });
});
