/**
 * Unit tests for the CUSTOM DATE RANGE half of transforms/periodWindow.ts.
 *
 * periodWindow.test.ts covers the preset periods. This covers the part a user
 * can now steer directly by tapping two days on a calendar — which means the
 * window bounds, the day count and the label are all derived from arbitrary
 * input rather than from a fixed table. The failures that would ship silently:
 *   - a half-open boundary day, so the first or last day's entries vanish from
 *     every chart on the screen under a label that claims to include them,
 *   - a reversed pair producing an inverted (empty) window,
 *   - a day count that's off by one, which is the consistency KPI's denominator,
 *   - a length-to-granularity mapping that stops agreeing with the presets, so
 *     the same 30 days get labelled/averaged differently depending on HOW they
 *     were selected.
 *
 * TIMEZONE: the suite runs pinned to Australia/Brisbane (UTC+10, no DST) via
 * jest.tz.js. The ISO assertions are only correct under that offset — that's the
 * point; a UTC-anchored implementation fails here.
 */
import {
    PERIOD_LENGTH_DAYS,
    computeCustomWindow,
    computePeriodWindow,
    dayCountInclusive,
    formatDayRangeLabel,
    formatPeriodLabel,
    granularityForDays,
    isValidDay,
    normaliseCustomRange,
    type BoundedTimeframe,
    type DayRange,
} from '@/components/visualisations/transforms/periodWindow';
import {
    DATE_FORMAT_PREFS,
    formatDate,
    type DateFormatPref,
} from '@/lib/dateFormat';

/** Same pinned "today" as periodWindow.test.ts, so the two suites read together. */
const TODAY = '2026-08-29';

const BOUNDED: BoundedTimeframe[] = ['week', 'month', '3months', 'year'];

describe('isValidDay', () => {
    it('accepts real calendar days', () => {
        expect(isValidDay('2026-08-29')).toBe(true);
        expect(isValidDay('2024-02-29')).toBe(true); // leap year
        expect(isValidDay('1970-01-01')).toBe(true);
    });

    it('rejects malformed strings and non-strings', () => {
        expect(isValidDay('2026-8-29')).toBe(false);
        expect(isValidDay('2026-08-29T00:00:00Z')).toBe(false);
        expect(isValidDay('')).toBe(false);
        expect(isValidDay(null)).toBe(false);
        expect(isValidDay(undefined)).toBe(false);
        expect(isValidDay(20260829)).toBe(false);
    });

    it('rejects days that look well-formed but do not exist', () => {
        // `new Date(2026, 1, 30)` silently rolls over to March 2 — the round-trip
        // check is what catches it.
        expect(isValidDay('2026-02-30')).toBe(false);
        expect(isValidDay('2025-02-29')).toBe(false); // not a leap year
        expect(isValidDay('2026-13-01')).toBe(false);
        expect(isValidDay('2026-00-10')).toBe(false);
        expect(isValidDay('2026-04-31')).toBe(false);
    });
});

describe('dayCountInclusive', () => {
    it('counts BOTH boundary days', () => {
        expect(dayCountInclusive({ startDay: '2026-08-29', endDay: '2026-08-29' })).toBe(1);
        expect(dayCountInclusive({ startDay: '2026-08-28', endDay: '2026-08-29' })).toBe(2);
        // Anti's example range: Aug 15 through Sep 13.
        expect(dayCountInclusive({ startDay: '2026-08-15', endDay: '2026-09-13' })).toBe(30);
    });

    it('crosses month, year and leap-day boundaries', () => {
        expect(dayCountInclusive({ startDay: '2025-12-31', endDay: '2026-01-01' })).toBe(2);
        expect(dayCountInclusive({ startDay: '2024-02-28', endDay: '2024-03-01' })).toBe(3);
        expect(dayCountInclusive({ startDay: '2025-02-28', endDay: '2025-03-01' })).toBe(2);
        expect(dayCountInclusive({ startDay: '2025-08-29', endDay: '2026-08-29' })).toBe(366);
    });

    it('agrees with every preset period length (the KPI denominator)', () => {
        for (const tf of BOUNDED) {
            const w = computePeriodWindow(tf, 0, TODAY);
            expect(dayCountInclusive(w)).toBe(PERIOD_LENGTH_DAYS[tf]);
        }
    });
});

describe('normaliseCustomRange', () => {
    it('keeps an in-order pair as given', () => {
        expect(normaliseCustomRange('2026-08-15', '2026-08-29', TODAY)).toEqual({
            startDay: '2026-08-15',
            endDay: '2026-08-29',
        });
    });

    it('swaps a reversed pair instead of rejecting it', () => {
        // Tapping the later day first is a normal way to use a calendar.
        expect(normaliseCustomRange('2026-08-29', '2026-08-15', TODAY)).toEqual({
            startDay: '2026-08-15',
            endDay: '2026-08-29',
        });
    });

    it('accepts a single day as a one-day range', () => {
        expect(normaliseCustomRange('2026-08-15', '2026-08-15', TODAY)).toEqual({
            startDay: '2026-08-15',
            endDay: '2026-08-15',
        });
    });

    it('clamps a future end to today rather than discarding the selection', () => {
        expect(normaliseCustomRange('2026-08-15', '2026-12-25', TODAY)).toEqual({
            startDay: '2026-08-15',
            endDay: TODAY,
        });
        // Reversed AND future.
        expect(normaliseCustomRange('2026-12-25', '2026-08-15', TODAY)).toEqual({
            startDay: '2026-08-15',
            endDay: TODAY,
        });
    });

    it('allows a start before the first entry (empty leading days are honest)', () => {
        expect(normaliseCustomRange('2019-01-01', '2026-08-15', TODAY)).toEqual({
            startDay: '2019-01-01',
            endDay: '2026-08-15',
        });
    });

    it('returns null when the whole range is in the future', () => {
        expect(normaliseCustomRange('2026-09-01', '2026-09-30', TODAY)).toBeNull();
    });

    it('returns null for an invalid day rather than producing Invalid Date', () => {
        expect(normaliseCustomRange('2026-02-30', '2026-08-15', TODAY)).toBeNull();
        expect(normaliseCustomRange('2026-08-15', 'tomorrow', TODAY)).toBeNull();
        expect(normaliseCustomRange('2026-08-15', '2026-08-29', 'not-a-day')).toBeNull();
    });
});

describe('computeCustomWindow — SQL bounds', () => {
    it('covers the WHOLE of both boundary days in local time', () => {
        const w = computeCustomWindow({ startDay: '2026-08-15', endDay: '2026-09-13' });
        expect(w.startDay).toBe('2026-08-15');
        expect(w.endDay).toBe('2026-09-13');
        // Brisbane (UTC+10): local Aug 15 00:00 -> Aug 14 14:00Z;
        //                    local Sep 13 23:59:59.999 -> Sep 13 13:59:59.999Z.
        expect(w.start).toBe('2026-08-14T14:00:00.000Z');
        expect(w.end).toBe('2026-09-13T13:59:59.999Z');
    });

    it('gives a one-day range a full 24h window', () => {
        const w = computeCustomWindow({ startDay: '2026-08-15', endDay: '2026-08-15' });
        expect(w.start).toBe('2026-08-14T14:00:00.000Z');
        expect(w.end).toBe('2026-08-15T13:59:59.999Z');
    });

    it('produces the same shape a preset window does, for the same days', () => {
        // The week ending TODAY, expressed as a custom range, must be byte-identical
        // to the preset — otherwise the same days would query differently depending
        // on how the user got there.
        const preset = computePeriodWindow('week', 0, TODAY);
        const custom = computeCustomWindow({
            startDay: preset.startDay,
            endDay: preset.endDay,
        });
        expect(custom).toEqual(preset);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE LABEL.
//
// Every assertion in this first describe passes pref 'system', which makes it
// the BYTE-IDENTITY PIN for the default: the strings below are exactly what the
// Stats header rendered before `date_format` existed, so an existing user who
// never opens Settings sees no change. (For THIS function the pre-setting
// behaviour was hardcoded English month-first — it never went through
// toLocaleDateString — so reproducing the old bytes means month-first, which is
// why 'system' and 'mdy' agree here and only here.)
//
// The other three prefs get their own describe below.
// ─────────────────────────────────────────────────────────────────────────────
describe('formatDayRangeLabel — system (the pre-setting bytes)', () => {
    it('collapses a same-month day range', () => {
        expect(
            formatDayRangeLabel(
                { startDay: '2026-08-23', endDay: '2026-08-29' },
                TODAY,
                'system',
            ),
        ).toBe('Aug 23 – 29');
    });

    it('spells both months when the range crosses one (Anti\'s example)', () => {
        expect(
            formatDayRangeLabel(
                { startDay: '2026-08-15', endDay: '2026-09-13' },
                TODAY,
                'system',
            ),
        ).toBe('Aug 15 – Sep 13');
    });

    it('renders a one-day range as a DATE, not a range', () => {
        expect(
            formatDayRangeLabel(
                { startDay: '2026-08-15', endDay: '2026-08-15' },
                TODAY,
                'system',
            ),
        ).toBe('Aug 15');
    });

    it('adds the year only once the range leaves the current one', () => {
        expect(
            formatDayRangeLabel(
                { startDay: '2025-03-01', endDay: '2025-03-10' },
                TODAY,
                'system',
            ),
        ).toBe('Mar 1 – 10, 2025');
        expect(
            formatDayRangeLabel(
                { startDay: '2025-03-01', endDay: '2025-03-01' },
                TODAY,
                'system',
            ),
        ).toBe('Mar 1, 2025');
    });

    it('spells out both years across a new-year boundary', () => {
        expect(
            formatDayRangeLabel(
                { startDay: '2025-12-20', endDay: '2026-01-05' },
                TODAY,
                'system',
            ),
        ).toBe('Dec 20, 2025 – Jan 5, 2026');
    });

    it('collapses to months at month granularity', () => {
        expect(
            formatDayRangeLabel(
                { startDay: '2026-06-01', endDay: '2026-08-29' },
                TODAY,
                'system',
                'month',
            ),
        ).toBe('Jun – Aug 2026');
        expect(
            formatDayRangeLabel(
                { startDay: '2026-08-01', endDay: '2026-08-29' },
                TODAY,
                'system',
                'month',
            ),
        ).toBe('Aug 2026');
    });

    it('still produces every preset label (formatPeriodLabel delegates here)', () => {
        // Guards the extraction: the presets must keep their exact wording.
        expect(formatPeriodLabel('week', 0, TODAY, 'system')).toBe('Aug 23 – 29');
        expect(formatPeriodLabel('month', 0, TODAY, 'system')).toBe('Jul 31 – Aug 29');
        expect(formatPeriodLabel('3months', 0, TODAY, 'system')).toBe('Jun – Aug 2026');
        expect(formatPeriodLabel('year', 0, TODAY, 'system')).toBe('Aug 2025 – Aug 2026');
        expect(formatPeriodLabel('alltime', 0, TODAY, 'system')).toBe('All time');
    });
});

/**
 * Every case in the shape table on formatDayRangeLabel, one row per case, all
 * four prefs side by side. Laid out as a table rather than four describes so a
 * reviewer can see the whole contract at a glance and a drifting branch is one
 * mismatched column, not a test buried three screens away.
 *
 * TODAY is 2026-08-29, so 2026 is "the current year" for the year-suffix rule.
 */
const LABEL_TABLE: ReadonlyArray<{
    name: string;
    range: DayRange;
    granularity?: 'day' | 'month';
    system: string;
    mdy: string;
    dmy: string;
    ymd: string;
}> = [
    {
        name: 'same month, current year',
        range: { startDay: '2026-08-23', endDay: '2026-08-29' },
        system: 'Aug 23 – 29',
        mdy: 'Aug 23 – 29',
        dmy: '23 – 29 Aug',
        ymd: '08-23 – 08-29',
    },
    {
        name: 'two months, current year',
        range: { startDay: '2026-08-15', endDay: '2026-09-13' },
        system: 'Aug 15 – Sep 13',
        mdy: 'Aug 15 – Sep 13',
        dmy: '15 Aug – 13 Sep',
        ymd: '08-15 – 09-13',
    },
    {
        name: 'one day, current year',
        range: { startDay: '2026-08-15', endDay: '2026-08-15' },
        system: 'Aug 15',
        mdy: 'Aug 15',
        dmy: '15 Aug',
        ymd: '08-15',
    },
    {
        name: 'same month, past year',
        range: { startDay: '2025-03-01', endDay: '2025-03-10' },
        system: 'Mar 1 – 10, 2025',
        mdy: 'Mar 1 – 10, 2025',
        dmy: '1 – 10 Mar 2025',
        ymd: '2025-03-01 – 2025-03-10',
    },
    {
        name: 'two months, past year',
        range: { startDay: '2025-01-05', endDay: '2025-02-03' },
        system: 'Jan 5 – Feb 3, 2025',
        mdy: 'Jan 5 – Feb 3, 2025',
        dmy: '5 Jan – 3 Feb 2025',
        ymd: '2025-01-05 – 2025-02-03',
    },
    {
        name: 'one day, past year',
        range: { startDay: '2025-03-01', endDay: '2025-03-01' },
        system: 'Mar 1, 2025',
        mdy: 'Mar 1, 2025',
        dmy: '1 Mar 2025',
        ymd: '2025-03-01',
    },
    {
        name: 'across a new year',
        range: { startDay: '2025-12-20', endDay: '2026-01-05' },
        system: 'Dec 20, 2025 – Jan 5, 2026',
        mdy: 'Dec 20, 2025 – Jan 5, 2026',
        dmy: '20 Dec 2025 – 5 Jan 2026',
        ymd: '2025-12-20 – 2026-01-05',
    },
    {
        name: 'month granularity, two months in one year',
        range: { startDay: '2026-06-01', endDay: '2026-08-29' },
        granularity: 'month',
        system: 'Jun – Aug 2026',
        mdy: 'Jun – Aug 2026',
        // A month name carries no day, so day-first has nothing to reorder.
        dmy: 'Jun – Aug 2026',
        ymd: '2026-06 – 2026-08',
    },
    {
        name: 'month granularity, one month',
        range: { startDay: '2026-08-01', endDay: '2026-08-29' },
        granularity: 'month',
        system: 'Aug 2026',
        mdy: 'Aug 2026',
        dmy: 'Aug 2026',
        ymd: '2026-08',
    },
    {
        name: 'month granularity, across a new year',
        range: { startDay: '2025-08-30', endDay: '2026-08-29' },
        granularity: 'month',
        system: 'Aug 2025 – Aug 2026',
        mdy: 'Aug 2025 – Aug 2026',
        dmy: 'Aug 2025 – Aug 2026',
        ymd: '2025-08 – 2026-08',
    },
];

describe('formatDayRangeLabel — every date_format pref', () => {
    it.each(LABEL_TABLE)('$name', ({ range, granularity, ...expected }) => {
        for (const pref of DATE_FORMAT_PREFS) {
            expect(formatDayRangeLabel(range, TODAY, pref, granularity)).toBe(
                expected[pref],
            );
        }
    });

    // THE invariant that ties this module to lib/dateFormat.ts. A one-day range
    // is a single DATE, so it must be spelled exactly the way every other date
    // in the app is spelled — otherwise a `dmy` user gets day-first everywhere
    // except the one header this bug was filed about.
    //
    // Run over all twelve months it also pins the local MONTH_NAMES array in
    // periodWindow.ts against dateFormat.ts's MONTHS_SHORT, without either
    // module importing the other's array. ('system' is excluded on purpose:
    // formatDate's 'system' follows the DEVICE locale and this label never did,
    // so it is pinned to the legacy bytes above instead.)
    const EXPLICIT: Array<Exclude<DateFormatPref, 'system'>> = ['mdy', 'dmy', 'ymd'];
    it.each(EXPLICIT)(
        'a one-day range is spelled exactly like formatDate (%s, all 12 months)',
        (pref) => {
            for (let month = 1; month <= 12; month++) {
                const mm = String(month).padStart(2, '0');

                const thisYear = `2026-${mm}-18`;
                expect(
                    formatDayRangeLabel(
                        { startDay: thisYear, endDay: thisYear },
                        TODAY,
                        pref,
                    ),
                ).toBe(formatDate(thisYear, pref, 'mediumNoYear'));

                const pastYear = `2025-${mm}-18`;
                expect(
                    formatDayRangeLabel(
                        { startDay: pastYear, endDay: pastYear },
                        TODAY,
                        pref,
                    ),
                ).toBe(formatDate(pastYear, pref, 'medium'));
            }
        },
    );

    // A label is the Stats header's entire caption: an empty or placeholder-ish
    // one is a blank header, and it must be impossible under EVERY setting.
    it.each(DATE_FORMAT_PREFS)('%s never produces an empty label', (pref) => {
        for (const { range, granularity } of LABEL_TABLE) {
            expect(
                formatDayRangeLabel(range, TODAY, pref, granularity).length,
            ).toBeGreaterThan(0);
        }
    });

    // The presets delegate to the same function, so the pref has to reach them
    // too — this is the actual reported bug (the header ignored the setting).
    it('threads the pref through formatPeriodLabel to the presets', () => {
        expect(formatPeriodLabel('week', 0, TODAY, 'dmy')).toBe('23 – 29 Aug');
        expect(formatPeriodLabel('month', 0, TODAY, 'dmy')).toBe('31 Jul – 29 Aug');
        expect(formatPeriodLabel('3months', 0, TODAY, 'dmy')).toBe('Jun – Aug 2026');
        expect(formatPeriodLabel('year', 0, TODAY, 'dmy')).toBe('Aug 2025 – Aug 2026');

        expect(formatPeriodLabel('week', 0, TODAY, 'ymd')).toBe('08-23 – 08-29');
        expect(formatPeriodLabel('month', 0, TODAY, 'ymd')).toBe('07-31 – 08-29');
        expect(formatPeriodLabel('3months', 0, TODAY, 'ymd')).toBe('2026-06 – 2026-08');
        expect(formatPeriodLabel('year', 0, TODAY, 'ymd')).toBe('2025-08 – 2026-08');

        // 'All time' has no dates in it, so it is the same under every pref.
        for (const pref of DATE_FORMAT_PREFS) {
            expect(formatPeriodLabel('alltime', 0, TODAY, pref)).toBe('All time');
        }
    });

    // Paging back out of the current year has to keep working per-pref: the
    // year is APPENDED for the name-based orders and CARRIED (year-first) for
    // ISO, which is the one rule that isn't shared between the branches.
    it('applies each order\'s own year rule when paging out of this year', () => {
        expect(formatPeriodLabel('week', -40, TODAY, 'mdy')).toBe('Nov 16 – 22, 2025');
        expect(formatPeriodLabel('week', -40, TODAY, 'dmy')).toBe('16 – 22 Nov 2025');
        expect(formatPeriodLabel('week', -40, TODAY, 'ymd')).toBe(
            '2025-11-16 – 2025-11-22',
        );
    });
});

describe('granularityForDays', () => {
    // THE invariant: a custom range the same length as a preset must be read at
    // that preset's granularity. Without it, "the last 30 days" picked by hand
    // would get different axis labels and a different moving-average width than
    // the Month pill, for the same 30 days.
    it.each(BOUNDED)("maps %s's own length back to itself", (tf) => {
        expect(granularityForDays(PERIOD_LENGTH_DAYS[tf])).toBe(tf);
    });

    it('reads a handful of days like a week (weekday labels, no moving average)', () => {
        expect(granularityForDays(1)).toBe('week');
        expect(granularityForDays(3)).toBe('week');
        expect(granularityForDays(7)).toBe('week');
    });

    it('steps up through month / quarter / year resolution', () => {
        expect(granularityForDays(8)).toBe('month');
        expect(granularityForDays(45)).toBe('month');
        expect(granularityForDays(46)).toBe('3months');
        expect(granularityForDays(150)).toBe('3months');
        expect(granularityForDays(151)).toBe('year');
        expect(granularityForDays(400)).toBe('year');
        expect(granularityForDays(5000)).toBe('year');
    });

    it('never returns alltime (a policy, not a length)', () => {
        for (const days of [0, 1, 7, 30, 90, 365, 4000, 100000]) {
            expect(granularityForDays(days)).not.toBe('alltime');
        }
    });

    it('degrades to the shortest granularity on nonsense input', () => {
        expect(granularityForDays(0)).toBe('week');
        expect(granularityForDays(-5)).toBe('week');
        expect(granularityForDays(NaN)).toBe('week');
        expect(granularityForDays(Infinity)).toBe('week');
    });
});
