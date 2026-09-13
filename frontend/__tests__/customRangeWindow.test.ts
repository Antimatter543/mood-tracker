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
} from '@/components/visualisations/transforms/periodWindow';

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

describe('formatDayRangeLabel', () => {
    it('collapses a same-month day range', () => {
        expect(
            formatDayRangeLabel({ startDay: '2026-08-23', endDay: '2026-08-29' }, TODAY),
        ).toBe('Aug 23 – 29');
    });

    it('spells both months when the range crosses one (Anti\'s example)', () => {
        expect(
            formatDayRangeLabel({ startDay: '2026-08-15', endDay: '2026-09-13' }, TODAY),
        ).toBe('Aug 15 – Sep 13');
    });

    it('renders a one-day range as a DATE, not a range', () => {
        expect(
            formatDayRangeLabel({ startDay: '2026-08-15', endDay: '2026-08-15' }, TODAY),
        ).toBe('Aug 15');
    });

    it('adds the year only once the range leaves the current one', () => {
        expect(
            formatDayRangeLabel({ startDay: '2025-03-01', endDay: '2025-03-10' }, TODAY),
        ).toBe('Mar 1 – 10, 2025');
        expect(
            formatDayRangeLabel({ startDay: '2025-03-01', endDay: '2025-03-01' }, TODAY),
        ).toBe('Mar 1, 2025');
    });

    it('spells out both years across a new-year boundary', () => {
        expect(
            formatDayRangeLabel({ startDay: '2025-12-20', endDay: '2026-01-05' }, TODAY),
        ).toBe('Dec 20, 2025 – Jan 5, 2026');
    });

    it('collapses to months at month granularity', () => {
        expect(
            formatDayRangeLabel(
                { startDay: '2026-06-01', endDay: '2026-08-29' },
                TODAY,
                'month',
            ),
        ).toBe('Jun – Aug 2026');
        expect(
            formatDayRangeLabel(
                { startDay: '2026-08-01', endDay: '2026-08-29' },
                TODAY,
                'month',
            ),
        ).toBe('Aug 2026');
    });

    it('still produces every preset label (formatPeriodLabel delegates here)', () => {
        // Guards the extraction: the presets must keep their exact wording.
        expect(formatPeriodLabel('week', 0, TODAY)).toBe('Aug 23 – 29');
        expect(formatPeriodLabel('month', 0, TODAY)).toBe('Jul 31 – Aug 29');
        expect(formatPeriodLabel('3months', 0, TODAY)).toBe('Jun – Aug 2026');
        expect(formatPeriodLabel('year', 0, TODAY)).toBe('Aug 2025 – Aug 2026');
        expect(formatPeriodLabel('alltime', 0, TODAY)).toBe('All time');
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
