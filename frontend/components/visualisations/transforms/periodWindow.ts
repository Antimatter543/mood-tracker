// periodWindow.ts
//
// The ONE authority for "which slice of time is the Statistics screen showing?".
//
// The timeframe pills (Week / Month / 3 Months / Year / All Time) pick a period
// LENGTH; a signed `offset` picks WHICH period of that length. `offset === 0` is
// the current one, `-1` the one before it, and so on. The Stats header's
// back/forward chevrons just step that integer — every window, label and bound
// is derived here, so the arrows, the header text and the six timeframe-scoped
// charts can never disagree about the range they're describing.
//
// WHY TRAILING PERIODS, NOT CALENDAR ONES
// Periods are equal-length blocks anchored on today (week = the 7 days ending
// today, its predecessor = the 7 days before that), NOT calendar weeks/months.
// Two reasons:
//   1. Every step compares like with like. Calendar months are 28-31 days, so
//      an "avg mood" or "consistency %" would silently shift meaning as you
//      page back through them.
//   2. No partial-period cliff. Under calendar alignment the current period is
//      whatever has elapsed so far, so on the 1st of a month the Stats screen
//      would collapse to a single day of data — a real regression on the app's
//      main screen for a feature that is meant to ADD reach, not remove it.
// The label is always the CONCRETE range ("Aug 23 – 29"), never a vague
// "This week", so the trailing-window semantics are visible rather than implied.
//
// TIMEZONE: every boundary is computed on local `YYYY-MM-DD` day strings and
// only converted to UTC ISO at the edge (startOfLocalDay / endOfLocalDay) for
// SQLite's `BETWEEN ? AND ?`. NEVER use SQLite's `date('now')` — it is UTC and
// mis-buckets entries for users east/west of UTC. See databases/dateHelpers.ts.

import { startOfLocalDay, endOfLocalDay, localDateString, addDays } from './dateHelpers';

export type Timeframe = 'week' | 'month' | '3months' | 'year' | 'alltime';

/** A bounded timeframe — every one except 'alltime', which has no period length. */
export type BoundedTimeframe = Exclude<Timeframe, 'alltime'>;

/**
 * Period length in local calendar days, per timeframe. These are also the
 * denominators `daysInTimeframe` feeds the consistency KPI, so a window is
 * exactly as long as the stat that divides by it claims.
 */
export const PERIOD_LENGTH_DAYS: Record<BoundedTimeframe, number> = {
    week: 7,
    month: 30,
    '3months': 90,
    year: 365,
};

/** Far-past anchor for 'alltime' — effectively unbounded below. */
export const ALLTIME_START = '1970-01-01T00:00:00.000Z';
const ALLTIME_START_DAY = '1970-01-01';

const MONTH_NAMES = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const MS_PER_DAY = 86_400_000;

/** Local `YYYY-MM-DD` for "today". Extracted so callers/tests can pin it. */
export const todayLocalDay = (now: Date = new Date()): string => localDateString(now);

/**
 * Parses a `YYYY-MM-DD` day string to a LOCAL-midnight Date. Deliberately not
 * `new Date(day)` — that parses a bare date form as UTC midnight, which lands
 * on the previous calendar day for anyone west of UTC.
 */
const parseDay = (day: string): Date => {
    const [y, m, d] = day.split('-').map(Number);
    return new Date(y, m - 1, d);
};

/**
 * Whole local calendar days from `from` to `to` (positive when `to` is later).
 * Rounded so DST 23h/25h days don't shave a day off the count.
 */
export const daysBetweenDays = (from: string, to: string): number =>
    Math.round((parseDay(to).getTime() - parseDay(from).getTime()) / MS_PER_DAY);

/** Inclusive local-day bounds of a period. Both ends are real calendar days. */
export type DayRange = { startDay: string; endDay: string };

/**
 * The window the Stats screen is scoped to: inclusive local-day bounds plus the
 * UTC ISO instants to hand SQLite. Charts should read this off TimeframeContext
 * rather than recomputing it, so one screen never renders two different ranges.
 */
export type PeriodWindow = DayRange & { start: string; end: string };

/** Coerces any incoming offset to a valid one: an integer, never in the future. */
const normaliseOffset = (offset: number): number =>
    Number.isFinite(offset) ? Math.min(0, Math.trunc(offset)) : 0;

/**
 * Inclusive local-day range of the period `offset` steps back from now.
 *
 * Periods tile the past without gaps or overlap: for week, offset 0 is
 * [today-6 .. today] and offset -1 is [today-13 .. today-7]. 'alltime' ignores
 * the offset entirely — there is only ever one all-time period.
 */
export const periodDayRange = (
    timeframe: Timeframe,
    offset: number,
    today: string,
): DayRange => {
    if (timeframe === 'alltime') {
        return { startDay: ALLTIME_START_DAY, endDay: today };
    }
    const length = PERIOD_LENGTH_DAYS[timeframe];
    const endDay = addDays(today, normaliseOffset(offset) * length);
    return { startDay: addDays(endDay, -(length - 1)), endDay };
};

/**
 * Full window for `(timeframe, offset)`: day bounds for labelling plus UTC ISO
 * instants for `WHERE date BETWEEN ?start AND ?end`. The instants cover the
 * WHOLE of both boundary days in local time (00:00:00.000 → 23:59:59.999), so
 * no day is ever half-counted.
 */
export const computePeriodWindow = (
    timeframe: Timeframe,
    offset: number,
    today: string,
): PeriodWindow => {
    const { startDay, endDay } = periodDayRange(timeframe, offset, today);
    return {
        startDay,
        endDay,
        start: timeframe === 'alltime' ? ALLTIME_START : startOfLocalDay(parseDay(startDay)),
        end: endOfLocalDay(parseDay(endDay)),
    };
};

/**
 * The furthest-back offset still worth showing: the last period whose window
 * ends on or after the user's earliest entry. Returns `-Infinity` when the
 * earliest entry isn't known yet (still loading) so navigation isn't blocked by
 * a pending query, and `0` for 'alltime' (which has nowhere to step).
 *
 * `earliestDay` in the future (only reachable via a future-dated entry) is
 * treated as "today", so the bound can never open up FORWARD navigation.
 */
export const minOffsetFor = (
    timeframe: Timeframe,
    earliestDay: string | null,
    today: string,
): number => {
    if (timeframe === 'alltime') return 0;
    if (earliestDay == null) return Number.NEGATIVE_INFINITY;
    const span = Math.max(0, daysBetweenDays(earliestDay, today));
    const steps = Math.floor(span / PERIOD_LENGTH_DAYS[timeframe]);
    // `-steps` when steps is 0 would be -0, which reads as 0 everywhere except
    // Object.is, not worth leaving as a trap for a future equality check.
    return steps === 0 ? 0 : -steps;
};

/**
 * Snaps an offset into the navigable range. Used when the earliest-entry query
 * resolves AFTER the user has already paged back, which would otherwise strand
 * them on a window with no data behind it.
 */
export const clampOffset = (
    timeframe: Timeframe,
    offset: number,
    earliestDay: string | null,
    today: string,
): number => {
    if (timeframe === 'alltime') return 0;
    return Math.max(normaliseOffset(offset), minOffsetFor(timeframe, earliestDay, today));
};

/** Can the user step BACK from `offset`? False past the earliest entry, and for 'alltime'. */
export const canStepBack = (
    timeframe: Timeframe,
    offset: number,
    earliestDay: string | null,
    today: string,
): boolean => {
    if (timeframe === 'alltime') return false;
    return normaliseOffset(offset) - 1 >= minOffsetFor(timeframe, earliestDay, today);
};

/** Can the user step FORWARD from `offset`? Never past the present. */
export const canStepForward = (timeframe: Timeframe, offset: number): boolean =>
    timeframe !== 'alltime' && normaliseOffset(offset) < 0;

/**
 * Human label for the period — always a concrete range, never "This week".
 *
 * Granularity follows the period length: week/month read as days ("Aug 23 – 29",
 * "Jul 31 – Aug 29"), 3 months/year read as months ("Jun – Aug 2026",
 * "Sep 2025 – Aug 2026"). The year is appended only when it isn't the current
 * one, so the common case stays short enough for the sticky header.
 */
export const formatPeriodLabel = (
    timeframe: Timeframe,
    offset: number,
    today: string,
): string => {
    if (timeframe === 'alltime') return 'All time';

    const { startDay, endDay } = periodDayRange(timeframe, offset, today);
    const [startYear, startMonth, startDate] = startDay.split('-').map(Number);
    const [endYear, endMonth, endDate] = endDay.split('-').map(Number);
    const startMon = MONTH_NAMES[startMonth - 1];
    const endMon = MONTH_NAMES[endMonth - 1];

    if (timeframe === '3months' || timeframe === 'year') {
        if (startYear !== endYear) return `${startMon} ${startYear} – ${endMon} ${endYear}`;
        if (startMonth === endMonth) return `${startMon} ${endYear}`;
        return `${startMon} – ${endMon} ${endYear}`;
    }

    // Day granularity. Spanning two years always needs both years spelled out.
    if (startYear !== endYear) {
        return `${startMon} ${startDate}, ${startYear} – ${endMon} ${endDate}, ${endYear}`;
    }
    const yearSuffix = endYear !== Number(today.slice(0, 4)) ? `, ${endYear}` : '';
    return startMonth === endMonth
        ? `${startMon} ${startDate} – ${endDate}${yearSuffix}`
        : `${startMon} ${startDate} – ${endMon} ${endDate}${yearSuffix}`;
};
