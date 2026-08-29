/**
 * Unit tests for the period-navigation window math (transforms/periodWindow.ts).
 *
 * This module is the single authority behind the Stats header's back/forward
 * arrows: it decides which slice of time every chart on the screen queries, what
 * the header says that slice is, and how far back the user is allowed to page.
 * A bug here is invisible in tsc and silently shows the WRONG DAYS' data under a
 * confidently-worded label, so the coverage below is deliberately exhaustive on
 * the boundaries: period tiling, month-length edges, year crossings, and the
 * earliest-entry clamp.
 *
 * TIMEZONE: the suite runs pinned to Australia/Brisbane (UTC+10, no DST) via
 * jest.tz.js. The ISO assertions below are only correct under that offset —
 * that's the point. A UTC-anchored implementation would produce different
 * strings and fail here, which is exactly the class of bug this app has shipped
 * before (see databases/dateHelpers.ts).
 */
import {
    ALLTIME_START,
    PERIOD_LENGTH_DAYS,
    canStepBack,
    canStepForward,
    clampOffset,
    computePeriodWindow,
    daysBetweenDays,
    formatPeriodLabel,
    minOffsetFor,
    periodDayRange,
    todayLocalDay,
    type Timeframe,
} from '@/components/visualisations/transforms/periodWindow';

/** A Saturday, mid-year, mid-month — no boundary coincidences to hide bugs. */
const TODAY = '2026-08-29';

const BOUNDED: Timeframe[] = ['week', 'month', '3months', 'year'];
const ALL: Timeframe[] = [...BOUNDED, 'alltime'];

describe('daysBetweenDays', () => {
    it('counts whole local calendar days, signed', () => {
        expect(daysBetweenDays('2026-08-23', '2026-08-29')).toBe(6);
        expect(daysBetweenDays('2026-08-29', '2026-08-23')).toBe(-6);
        expect(daysBetweenDays('2026-08-29', '2026-08-29')).toBe(0);
    });

    it('crosses month and year boundaries', () => {
        expect(daysBetweenDays('2026-01-31', '2026-02-01')).toBe(1);
        expect(daysBetweenDays('2025-12-31', '2026-01-01')).toBe(1);
        // 2024 is a leap year: Feb 29 exists, so the span is 366.
        expect(daysBetweenDays('2024-01-01', '2024-12-31')).toBe(365);
        expect(daysBetweenDays('2025-01-01', '2025-12-31')).toBe(364);
    });
});

describe('periodDayRange — the current period (offset 0)', () => {
    it.each(BOUNDED)('%s ends on today', (tf) => {
        expect(periodDayRange(tf, 0, TODAY).endDay).toBe(TODAY);
    });

    it('gives the exact week/month/quarter/year blocks', () => {
        expect(periodDayRange('week', 0, TODAY)).toEqual({
            startDay: '2026-08-23',
            endDay: '2026-08-29',
        });
        expect(periodDayRange('month', 0, TODAY)).toEqual({
            startDay: '2026-07-31',
            endDay: '2026-08-29',
        });
        expect(periodDayRange('3months', 0, TODAY)).toEqual({
            startDay: '2026-06-01',
            endDay: '2026-08-29',
        });
        expect(periodDayRange('year', 0, TODAY)).toEqual({
            startDay: '2025-08-30',
            endDay: '2026-08-29',
        });
    });
});

describe('periodDayRange — stepping back', () => {
    it('steps a week at a time', () => {
        expect(periodDayRange('week', -1, TODAY)).toEqual({
            startDay: '2026-08-16',
            endDay: '2026-08-22',
        });
        expect(periodDayRange('week', -5, TODAY)).toEqual({
            startDay: '2026-07-19',
            endDay: '2026-07-25',
        });
    });

    it('steps a month-length block at a time', () => {
        expect(periodDayRange('month', -1, TODAY)).toEqual({
            startDay: '2026-07-01',
            endDay: '2026-07-30',
        });
        expect(periodDayRange('month', -5, TODAY)).toEqual({
            startDay: '2026-03-03',
            endDay: '2026-04-01',
        });
    });

    it('steps a quarter and a year at a time', () => {
        expect(periodDayRange('3months', -1, TODAY)).toEqual({
            startDay: '2026-03-03',
            endDay: '2026-05-31',
        });
        expect(periodDayRange('year', -1, TODAY)).toEqual({
            startDay: '2024-08-30',
            endDay: '2025-08-29',
        });
    });

    // The whole promise of trailing periods over calendar ones: every step is
    // the SAME number of days, so an average or a consistency % means the same
    // thing at every offset. Calendar months (28-31 days) could not do this.
    it.each(BOUNDED)('%s periods are always exactly PERIOD_LENGTH_DAYS long', (tf) => {
        const length = PERIOD_LENGTH_DAYS[tf as keyof typeof PERIOD_LENGTH_DAYS];
        for (const offset of [0, -1, -2, -5, -13, -40]) {
            const { startDay, endDay } = periodDayRange(tf, offset, TODAY);
            expect(daysBetweenDays(startDay, endDay) + 1).toBe(length);
        }
    });

    // No gaps (a day nobody can ever see) and no overlap (a day double-counted
    // across two adjacent periods).
    it.each(BOUNDED)('%s periods tile the past exactly — no gaps, no overlap', (tf) => {
        for (let offset = 0; offset > -8; offset--) {
            const current = periodDayRange(tf, offset, TODAY);
            const previous = periodDayRange(tf, offset - 1, TODAY);
            expect(daysBetweenDays(previous.endDay, current.startDay)).toBe(1);
        }
    });
});

describe('periodDayRange — calendar edges', () => {
    // A 30-day "month" stepped back from the 31st walks into the previous month
    // by a shifting amount. The contract is only that the blocks stay 30 days
    // and stay contiguous — pinned here so a "helpful" calendar-alignment
    // refactor can't silently change what the screen shows.
    it('handles stepping back from the last day of a 31-day month', () => {
        expect(periodDayRange('month', 0, '2026-01-31')).toEqual({
            startDay: '2026-01-02',
            endDay: '2026-01-31',
        });
        expect(periodDayRange('month', -1, '2026-01-31')).toEqual({
            startDay: '2025-12-03',
            endDay: '2026-01-01',
        });
        expect(periodDayRange('month', -2, '2026-01-31')).toEqual({
            startDay: '2025-11-03',
            endDay: '2025-12-02',
        });
    });

    it('crosses February in a non-leap year without drifting', () => {
        // 2026-03-31 back one 30-day block lands inside a 28-day February.
        const { startDay, endDay } = periodDayRange('month', -1, '2026-03-31');
        expect(endDay).toBe('2026-03-01');
        expect(startDay).toBe('2026-01-31');
        expect(daysBetweenDays(startDay, endDay) + 1).toBe(30);
    });

    it('crosses February in a leap year without drifting', () => {
        const { startDay, endDay } = periodDayRange('month', -1, '2024-03-31');
        expect(daysBetweenDays(startDay, endDay) + 1).toBe(30);
        expect(endDay).toBe('2024-03-01');
    });

    it('crosses the new year going backwards', () => {
        expect(periodDayRange('week', 0, '2026-01-05')).toEqual({
            startDay: '2025-12-30',
            endDay: '2026-01-05',
        });
        expect(periodDayRange('week', -1, '2026-01-05')).toEqual({
            startDay: '2025-12-23',
            endDay: '2025-12-29',
        });
    });
});

describe('periodDayRange — offset normalisation', () => {
    it('never returns a future period, whatever the caller passes', () => {
        for (const bogus of [1, 5, 0.4, Number.POSITIVE_INFINITY]) {
            expect(periodDayRange('week', bogus, TODAY).endDay).toBe(TODAY);
        }
    });

    it('truncates fractional offsets toward the present', () => {
        expect(periodDayRange('week', -1.7, TODAY)).toEqual(
            periodDayRange('week', -1, TODAY),
        );
    });

    it('treats NaN as the current period rather than producing Invalid Date', () => {
        expect(periodDayRange('week', Number.NaN, TODAY).endDay).toBe(TODAY);
    });
});

describe('computePeriodWindow — SQL bounds', () => {
    it('converts local day bounds to full-day UTC ISO instants', () => {
        // Brisbane is UTC+10: local 2026-08-23 00:00 is 2026-08-22T14:00Z, and
        // local 2026-08-29 23:59:59.999 is 2026-08-29T13:59:59.999Z.
        expect(computePeriodWindow('week', 0, TODAY)).toEqual({
            startDay: '2026-08-23',
            endDay: '2026-08-29',
            start: '2026-08-22T14:00:00.000Z',
            end: '2026-08-29T13:59:59.999Z',
        });
    });

    it('covers WHOLE boundary days, so no day is ever half-counted', () => {
        const { start, end } = computePeriodWindow('month', -3, TODAY);
        expect(start.endsWith('14:00:00.000Z')).toBe(true);
        expect(end.endsWith('13:59:59.999Z')).toBe(true);
    });

    it('anchors alltime at the epoch and ignores the offset', () => {
        const current = computePeriodWindow('alltime', 0, TODAY);
        expect(current.start).toBe(ALLTIME_START);
        expect(current.endDay).toBe(TODAY);
        expect(computePeriodWindow('alltime', -7, TODAY)).toEqual(current);
    });
});

describe('formatPeriodLabel', () => {
    it('reads week/month periods as concrete days', () => {
        expect(formatPeriodLabel('week', 0, TODAY)).toBe('Aug 23 – 29');
        expect(formatPeriodLabel('week', -1, TODAY)).toBe('Aug 16 – 22');
        expect(formatPeriodLabel('month', 0, TODAY)).toBe('Jul 31 – Aug 29');
        expect(formatPeriodLabel('month', -1, TODAY)).toBe('Jul 1 – 30');
    });

    it('reads 3-month/year periods as months', () => {
        expect(formatPeriodLabel('3months', 0, TODAY)).toBe('Jun – Aug 2026');
        expect(formatPeriodLabel('3months', -1, TODAY)).toBe('Mar – May 2026');
        expect(formatPeriodLabel('year', 0, TODAY)).toBe('Aug 2025 – Aug 2026');
        expect(formatPeriodLabel('year', -1, TODAY)).toBe('Aug 2024 – Aug 2025');
    });

    // The year is noise while you're in the current one and essential once
    // you've paged out of it.
    it('omits the year inside the current year and adds it once you leave', () => {
        expect(formatPeriodLabel('week', 0, TODAY)).not.toMatch(/2026/);
        expect(formatPeriodLabel('week', -40, TODAY)).toBe('Nov 16 – 22, 2025');
    });

    it('spells out both years when a period straddles new year', () => {
        expect(formatPeriodLabel('week', 0, '2026-01-05')).toBe(
            'Dec 30, 2025 – Jan 5, 2026',
        );
        expect(formatPeriodLabel('month', -1, '2026-01-31')).toBe(
            'Dec 3, 2025 – Jan 1, 2026',
        );
        expect(formatPeriodLabel('year', 0, '2026-01-05')).toBe('Jan 2025 – Jan 2026');
    });

    it('labels alltime plainly and ignores the offset', () => {
        expect(formatPeriodLabel('alltime', 0, TODAY)).toBe('All time');
        expect(formatPeriodLabel('alltime', -4, TODAY)).toBe('All time');
    });

    it.each(ALL)('%s always produces a non-empty label', (tf) => {
        for (const offset of [0, -1, -12, -100]) {
            expect(formatPeriodLabel(tf, offset, TODAY).length).toBeGreaterThan(0);
        }
    });
});

describe('minOffsetFor / clampOffset — the earliest-entry back-bound', () => {
    it('stops at the last period that still ends on or after the first entry', () => {
        // 2026-08-08 is 21 days back: weeks -1, -2, -3 all still reach it.
        expect(minOffsetFor('week', '2026-08-08', TODAY)).toBe(-3);
        expect(periodDayRange('week', -3, TODAY).endDay).toBe('2026-08-08');
        // One step further would end 2026-08-01 — before any entry exists.
        expect(periodDayRange('week', -4, TODAY).endDay).toBe('2026-08-01');
    });

    it('includes a period whose window ends exactly on the first entry', () => {
        expect(canStepBack('week', -2, '2026-08-08', TODAY)).toBe(true);
        expect(canStepBack('week', -3, '2026-08-08', TODAY)).toBe(false);
    });

    it('leaves navigation open while the earliest entry is still unknown', () => {
        expect(minOffsetFor('week', null, TODAY)).toBe(Number.NEGATIVE_INFINITY);
        expect(canStepBack('week', -99, null, TODAY)).toBe(true);
        expect(clampOffset('week', -99, null, TODAY)).toBe(-99);
    });

    it('pins a brand-new user (first entry today) to the current period', () => {
        expect(minOffsetFor('week', TODAY, TODAY)).toBe(0);
        expect(canStepBack('week', 0, TODAY, TODAY)).toBe(false);
    });

    // Only reachable via a future-dated entry, but the bound must never open up
    // FORWARD navigation as a side effect.
    it('never yields a positive bound for a future-dated first entry', () => {
        expect(minOffsetFor('week', '2027-01-01', TODAY)).toBe(0);
        expect(clampOffset('week', 0, '2027-01-01', TODAY)).toBe(0);
    });

    it('snaps an out-of-range offset back into the navigable range', () => {
        expect(clampOffset('week', -50, '2026-08-08', TODAY)).toBe(-3);
        expect(clampOffset('week', -2, '2026-08-08', TODAY)).toBe(-2);
        expect(clampOffset('week', 3, '2026-08-08', TODAY)).toBe(0);
    });

    it('scales the bound with the period length', () => {
        const earliest = '2024-01-01';
        // 971 days of history: 138 whole weeks, 32 30-day blocks, 10 quarters,
        // 2 years.
        expect(minOffsetFor('week', earliest, TODAY)).toBe(-138);
        expect(minOffsetFor('month', earliest, TODAY)).toBe(-32);
        expect(minOffsetFor('3months', earliest, TODAY)).toBe(-10);
        expect(minOffsetFor('year', earliest, TODAY)).toBe(-2);
    });

    it.each(BOUNDED)('%s: the clamped floor is reachable and one past it is not', (tf) => {
        const earliest = '2024-01-01';
        const floor = minOffsetFor(tf, earliest, TODAY);
        expect(canStepBack(tf, floor + 1, earliest, TODAY)).toBe(true);
        expect(canStepBack(tf, floor, earliest, TODAY)).toBe(false);
        expect(periodDayRange(tf, floor, TODAY).endDay >= earliest).toBe(true);
    });
});

describe('canStepForward — never into the future', () => {
    it.each(BOUNDED)('%s is forward-disabled at the current period', (tf) => {
        expect(canStepForward(tf, 0)).toBe(false);
    });

    it.each(BOUNDED)('%s is forward-enabled once paged back', (tf) => {
        expect(canStepForward(tf, -1)).toBe(true);
        expect(canStepForward(tf, -20)).toBe(true);
    });

    it('treats a bogus positive offset as the present, not as room to move', () => {
        expect(canStepForward('week', 3)).toBe(false);
    });
});

describe('alltime has nowhere to step', () => {
    it('disables both directions and clamps to the current period', () => {
        expect(canStepBack('alltime', 0, '2020-01-01', TODAY)).toBe(false);
        expect(canStepBack('alltime', -3, null, TODAY)).toBe(false);
        expect(canStepForward('alltime', -3)).toBe(false);
        expect(minOffsetFor('alltime', '2020-01-01', TODAY)).toBe(0);
        expect(clampOffset('alltime', -9, null, TODAY)).toBe(0);
    });
});

describe('todayLocalDay', () => {
    it('keys an instant to the LOCAL day, not the UTC one', () => {
        // 2026-08-29T20:00Z is already 2026-08-30 in Brisbane (UTC+10). Keying
        // this in UTC is the exact bug class jest.tz.js exists to expose.
        expect(todayLocalDay(new Date('2026-08-29T20:00:00.000Z'))).toBe('2026-08-30');
        expect(todayLocalDay(new Date('2026-08-29T03:00:00.000Z'))).toBe('2026-08-29');
    });
});
