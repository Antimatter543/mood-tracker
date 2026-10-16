/**
 * Wiring + device-locale tests for the four SIBLING sites that kept their own
 * date text after `date_format` shipped (v2.14.0), the same bug class PR #14
 * fixed in `periodWindow.ts`:
 *
 *   1. MonthOverMonthCard      "June (this month)"        hardcoded month table
 *   2. transforms/heatmap      month columns "Jan 26"     hardcoded 'en-US'
 *   3. transforms/weeklyMood   "Jan '25" / "Sun" axes     device locale, never `pref`
 *   4. MoodMetricOverlayCard   "1 Jul" under the chart    hardcoded day-first
 *
 * The per-transform test files prove each transform spells every preference. What
 * they cannot prove, and what the first half of this file is for:
 *   - the preference actually REACHES the transform from the real setting. A fix
 *     wired to a defaulted parameter passes every pure test and changes nothing on
 *     screen (frontend/tasks/lessons.md, 2026-09-26),
 *   - the text RE-RENDERS when the setting changes (the memo / state holds the
 *     DATE, not the spelled string, so no refetch is needed).
 *
 * The second half is about `system`, the default. "An existing user sees no
 * change" is easy to break quietly: a site whose old output was a hardcoded
 * ENGLISH string, routed through the plain device-locale `system`, would start
 * speaking French on a French phone the day the app updates. Every English-
 * pinned site is therefore also checked on a simulated French device, which the
 * real runtime locale (en-US in CI) can never reveal on its own.
 *
 * Harness: SettingsContext is mocked (the pattern from
 * periodHeaderDateFormat.test.tsx), so the REAL `useDateFormat` hook runs on top
 * of it. RNTL 14 is async-by-default: every render/rerender below is awaited.
 */
import React from 'react';
import { render, act, fireEvent } from '@testing-library/react-native';

import type { Settings } from '@/databases/settings';
import { formatMonth, type DateFormatPref } from '@/lib/dateFormat';
import { buildHeatmapGrid } from '@/components/visualisations/transforms/heatmap';
import { formatLabel } from '@/components/visualisations/transforms/weeklyMood';
import { monthOverMonthLabels } from '@/components/visualisations/transforms/monthOverMonth';
import { overlayDayLabel } from '@/components/visualisations/transforms/moodMetricOverlay';
import type { HealthMetricDay } from '@/components/visualisations/transforms/healthMoodCorrelation';

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

// ── Mock DB. MonthOverMonthCard reads two summaries; CustomHeatMap reads the
//    raw entries. Day keys are LOCAL noon so no timezone can move them. ───────
const mockDb = {
    getFirstAsync: jest.fn(async () => ({ avg_mood: 7, entry_count: 10 })),
    getAllAsync: jest.fn(async () => [
        { date: new Date(2025, 11, 15, 12).toISOString(), mood: 5 },
        { date: new Date(2026, 0, 15, 12).toISOString(), mood: 6 },
        { date: new Date(2026, 1, 15, 12).toISOString(), mood: 7 },
    ]),
};
jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => mockDb }));

// useFocusEffect models FOCUS GAIN only (mount-once), as in the PR #14 harness.
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
    // The cards pull shared pieces (Card, InfoBubble) that read other exports too.
    ...jest.requireActual('@/styles/global'),
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

import MonthOverMonthCard from '@/components/visualisations/MonthOverMonthCard';
import CustomHeatMap from '@/components/visualisations/CustomHeatMap';
import MoodMetricOverlayCard from '@/components/visualisations/MoodMetricOverlayCard';

type View = Awaited<ReturnType<typeof render>>;

const withPref = (pref: DateFormatPref) =>
    mockSettings.mockReturnValue({ ...baseSettings, date_format: pref });

/** Fakes ONLY `Date`, so "today" is fixed while RNTL's real timers still tick. */
const ALL_TIMERS_BUT_DATE = [
    'hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame',
    'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'setImmediate',
    'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout',
] as const;
const pinToday = (today: Date) =>
    jest.useFakeTimers({ now: today, doNotFake: [...ALL_TIMERS_BUT_DATE] });

// A simulated device locale. `system` formats call `toLocaleDateString(undefined,
// ...)`, so substituting a locale for `undefined` is exactly "the phone is set to
// French", and an explicit locale ('en-US') is left alone like the real thing.
const realToLocaleDateString = Date.prototype.toLocaleDateString;
let deviceLocaleSpy: jest.SpyInstance | undefined;
const setDeviceLocale = (locale: string) => {
    deviceLocaleSpy = jest
        .spyOn(Date.prototype, 'toLocaleDateString')
        .mockImplementation(function (
            this: Date,
            locales?: Intl.LocalesArgument,
            options?: Intl.DateTimeFormatOptions,
        ) {
            return realToLocaleDateString.call(this, locales ?? locale, options);
        });
};

beforeEach(() => {
    jest.clearAllMocks();
    withPref('system');
    pinToday(new Date(2026, 5, 15, 12)); // Mon 2026-06-15
});

afterEach(() => {
    deviceLocaleSpy?.mockRestore();
    deviceLocaleSpy = undefined;
    jest.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Month over Month
// ─────────────────────────────────────────────────────────────────────────────
describe('MonthOverMonthCard captions follow the date_format setting', () => {
    const renderCard = async () => {
        const view = await render(<MonthOverMonthCard />);
        // Resolves once the two summary queries have settled and the card has data.
        await view.findByText(/\(this month\)/);
        return view;
    };

    it.each([
        ['system', 'June (this month)', 'May (last month)'],
        ['mdy', 'June (this month)', 'May (last month)'],
        ['dmy', 'June (this month)', 'May (last month)'],
        ['ymd', '2026-06 (this month)', '2026-05 (last month)'],
    ] as Array<[DateFormatPref, string, string]>)(
        'captions the two columns under %s -> "%s" / "%s"',
        async (pref, current, previous) => {
            withPref(pref);
            const view = await renderCard();
            expect(view.getByText(current)).toBeTruthy();
            expect(view.getByText(previous)).toBeTruthy();
        },
    );

    it('carries the year back across New Year under ISO (January is next to a December of last year)', async () => {
        pinToday(new Date(2026, 0, 15, 12));
        withPref('ymd');
        const view = await renderCard();
        expect(view.getByText('2026-01 (this month)')).toBeTruthy();
        expect(view.getByText('2025-12 (last month)')).toBeTruthy();
    });

    it('still reads "January" / "December" under a month-name preference', async () => {
        pinToday(new Date(2026, 0, 15, 12));
        withPref('dmy');
        const view = await renderCard();
        expect(view.getByText('January (this month)')).toBeTruthy();
        expect(view.getByText('December (last month)')).toBeTruthy();
    });

    // The regression a stored string would hide: when the headings were React
    // state set at fetch time, a settings change could not re-spell them until
    // the next refetch. They are derived from the stored DATES at render.
    it('re-labels the moment the setting changes, WITHOUT refetching', async () => {
        const view = await renderCard();
        expect(view.getByText('June (this month)')).toBeTruthy();
        const fetchesBefore = mockDb.getFirstAsync.mock.calls.length;
        expect(fetchesBefore).toBe(2); // this month + last month

        withPref('ymd');
        await view.rerender(<MonthOverMonthCard />);
        expect(view.getByText('2026-06 (this month)')).toBeTruthy();
        expect(view.getByText('2026-05 (last month)')).toBeTruthy();
        expect(view.queryByText('June (this month)')).toBeNull();

        withPref('mdy');
        await view.rerender(<MonthOverMonthCard />);
        expect(view.getByText('June (this month)')).toBeTruthy();

        expect(mockDb.getFirstAsync.mock.calls.length).toBe(fetchesBefore);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Heatmap month columns
// ─────────────────────────────────────────────────────────────────────────────
describe('CustomHeatMap month columns follow the date_format setting', () => {
    /**
     * Every string the SVG renders (react-native-svg draws each as an RNSVGText
     * holding one RNSVGTSpan), in document order.
     */
    const svgStrings = (view: View): string[] => {
        const out: string[] = [];
        const walk = (node: unknown): void => {
            if (Array.isArray(node)) return node.forEach(walk);
            if (!node || typeof node !== 'object') return;
            const n = node as { type?: string; props?: { content?: unknown }; children?: unknown[] };
            if (n.type === 'RNSVGTSpan' && typeof n.props?.content === 'string') {
                out.push(n.props.content);
            }
            n.children?.forEach(walk);
        };
        walk(view.toJSON());
        return out;
    };
    // The month labels are what is left once the fixed weekday labels and the
    // numeric day-of-month cells are taken out: no layout constant involved.
    const WEEKDAYS = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    const monthColumns = (view: View): string[] =>
        svgStrings(view).filter((t) => !WEEKDAYS.has(t) && !/^\d+$/.test(t));

    const renderHeatmap = async () => {
        const view = await render(<CustomHeatMap />);
        await view.findByText('Mood Heatmap');
        // The grid appears once the entries query has resolved.
        await act(async () => {});
        return view;
    };

    // Entries on 2025-12-15, 2026-01-15, 2026-02-15, plus the component's own
    // one-month lead-in (2025-11-15): columns for Nov, Dec, Jan, Feb.
    it.each([
        ['system', ['Nov 25', 'Dec', 'Jan 26', 'Feb']],
        ['mdy', ['Nov 25', 'Dec', 'Jan 26', 'Feb']],
        ['dmy', ['Nov 25', 'Dec', 'Jan 26', 'Feb']],
        ['ymd', ['2025-11', '2025-12', '2026-01', '2026-02']],
    ] as Array<[DateFormatPref, string[]]>)(
        'labels the month columns under %s -> %j',
        async (pref, expected) => {
            withPref(pref);
            const view = await renderHeatmap();
            expect(monthColumns(view)).toEqual(expected);
        },
    );

    // The grid is memoised on (entries, pref). Without the pref in that list a
    // re-render would hand back the cached, old-spelling grid.
    it('re-labels the moment the setting changes, WITHOUT refetching', async () => {
        const view = await renderHeatmap();
        expect(monthColumns(view)).toEqual(['Nov 25', 'Dec', 'Jan 26', 'Feb']);
        const fetchesBefore = mockDb.getAllAsync.mock.calls.length;
        expect(fetchesBefore).toBe(1);

        withPref('ymd');
        await view.rerender(<CustomHeatMap />);
        expect(monthColumns(view)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);

        withPref('dmy');
        await view.rerender(<CustomHeatMap />);
        expect(monthColumns(view)).toEqual(['Nov 25', 'Dec', 'Jan 26', 'Feb']);

        expect(mockDb.getAllAsync.mock.calls.length).toBe(fetchesBefore);
    });

    it('does not touch the cells: the day numbers are identical under every preference', async () => {
        const dayNumbers = async (pref: DateFormatPref) => {
            withPref(pref);
            const view = await renderHeatmap();
            const nums = svgStrings(view).filter((t) => /^\d+$/.test(t));
            await view.unmount(); // async in RNTL 14: an un-awaited unmount breaks the NEXT render
            return nums;
        };
        const system = await dayNumbers('system');
        expect(system.length).toBeGreaterThan(50);
        expect(await dayNumbers('ymd')).toEqual(system);
        expect(await dayNumbers('dmy')).toEqual(system);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Mood x metric overlay day labels
// ─────────────────────────────────────────────────────────────────────────────
describe('MoodMetricOverlayCard day labels follow the date_format setting', () => {
    const days = (n: number): string[] =>
        Array.from({ length: n }, (_, i) => `2026-06-${String(i + 1).padStart(2, '0')}`);
    const HEALTH: HealthMetricDay[] = days(8).map((date, i) => ({
        date,
        sleepTotalMinutes: 360 + i * 20,
        avgHeartRate: 68 + i,
        minHeartRate: 52 + i,
        restingHeartRate: null,
        avgHrvMillis: null,
    }));
    const MOODS = days(8).map((day, i) => ({ day, avg: 4 + (i % 4) }));

    const ui = () => <MoodMetricOverlayCard healthRows={HEALTH} dailyMoods={MOODS} />;

    /** The card draws its date labels only after it has measured its width. */
    const renderMeasured = async () => {
        const view = await render(ui());
        await act(async () => {
            fireEvent(view.getByTestId('mood-metric-overlay-chart'), 'layout', {
                nativeEvent: { layout: { width: 320, height: 160, x: 0, y: 0 } },
            });
        });
        return view;
    };

    // 8 days: the first, the middle (index 3) and the last day get a label.
    it.each([
        ['system', ['1 Jun', '4 Jun', '8 Jun']],
        ['mdy', ['Jun 1', 'Jun 4', 'Jun 8']],
        ['dmy', ['1 Jun', '4 Jun', '8 Jun']],
        ['ymd', ['06-01', '06-04', '06-08']],
    ] as Array<[DateFormatPref, string[]]>)(
        'labels the first / middle / last day under %s -> %j',
        async (pref, expected) => {
            withPref(pref);
            const view = await renderMeasured();
            for (const label of expected) expect(view.getByText(label)).toBeTruthy();
        },
    );

    it('a month-first user no longer gets the old hardcoded day-first labels', async () => {
        withPref('mdy');
        const view = await renderMeasured();
        expect(view.queryByText('1 Jun')).toBeNull();
        expect(view.queryByText('8 Jun')).toBeNull();
    });

    it('re-labels the moment the setting changes', async () => {
        const view = await renderMeasured();
        expect(view.getByText('1 Jun')).toBeTruthy();

        withPref('mdy');
        await view.rerender(ui());
        expect(view.getByText('Jun 1')).toBeTruthy();
        expect(view.queryByText('1 Jun')).toBeNull();

        withPref('ymd');
        await view.rerender(ui());
        expect(view.getByText('06-01')).toBeTruthy();
        expect(view.queryByText('Jun 1')).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. `system` on a device that is NOT English
// ─────────────────────────────────────────────────────────────────────────────
describe('on a French device', () => {
    const SUNDAY = new Date(2025, 5, 15); // 2025-06-15
    const frenchWeekday = realToLocaleDateString.call(SUNDAY, 'fr-FR', { weekday: 'short' });
    const frenchMonth = realToLocaleDateString.call(SUNDAY, 'fr-FR', { month: 'short' });

    beforeEach(() => setDeviceLocale('fr-FR'));

    it('precondition: this runtime has French date data (else the tests below prove nothing)', () => {
        expect(frenchWeekday).not.toBe('Sun');
        expect(frenchMonth).not.toBe('Jun');
        // ...and the simulated device locale is what an unlocalised call now sees.
        expect(SUNDAY.toLocaleDateString(undefined, { weekday: 'short' })).toBe(frenchWeekday);
        expect(SUNDAY.toLocaleDateString('en-US', { weekday: 'short' })).toBe('Sun');
    });

    describe('weeklyMood axes: `system` follows the device, an explicit preference does not', () => {
        it('week axis', () => {
            expect(formatLabel('2025-06-15', 0, 7, 'week', 'system')).toBe(frenchWeekday);
            for (const pref of ['mdy', 'dmy', 'ymd'] as DateFormatPref[]) {
                expect(formatLabel('2025-06-15', 0, 7, 'week', pref)).toBe('Sun');
            }
        });

        it('year and all-time axes', () => {
            const french = `${frenchMonth} '25`;
            expect(formatLabel('2025-06-15', 0, 365, 'year', 'system')).toBe(french);
            expect(formatLabel('2025-06-15', 0, 500, 'alltime', 'system')).toBe(french);
            expect(formatLabel('2025-06-15', 0, 365, 'year', 'mdy')).toBe("Jun '25");
            expect(formatLabel('2025-06-15', 0, 365, 'year', 'dmy')).toBe("Jun '25");
            expect(formatLabel('2025-06-15', 0, 365, 'year', 'ymd')).toBe('2025-06');
        });
    });

    // The three sites below were ENGLISH before the setting existed (a hardcoded
    // table, 'en-US', and a hand-written day-first string), not device-locale. So
    // their `system` is pinned to English, and a French phone must read exactly
    // what it read yesterday.
    describe('the hardcoded-English sites keep English under `system`', () => {
        it('Month over Month headings', () => {
            const JUNE = new Date(2026, 5, 1);
            const MAY = new Date(2026, 4, 1);
            expect(monthOverMonthLabels(JUNE, MAY, 'system')).toEqual({
                current: 'June',
                previous: 'May',
            });
            // The contrast that makes the pin necessary: unpinned `system` is French.
            expect(formatMonth(JUNE, 'system', 'long')).not.toBe('June');
        });

        it('heatmap month columns', () => {
            const rows = [
                { date: '2025-12-15', mood: 5 },
                { date: '2026-01-15', mood: 6 },
                { date: '2026-02-15', mood: 7 },
            ];
            const grid = buildHeatmapGrid(rows, 'system');
            expect(grid.monthLabels.map((m) => m.month)).toEqual(['Dec 25', 'Jan 26', 'Feb']);
        });

        it('overlay day labels', () => {
            expect(overlayDayLabel('2026-07-01', 'system')).toBe('1 Jul');
            expect(overlayDayLabel('2026-12-31', 'system')).toBe('31 Dec');
        });
    });
});
