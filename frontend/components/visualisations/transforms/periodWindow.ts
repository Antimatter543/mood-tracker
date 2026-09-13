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

/** How precisely a range's label spells out its ends. */
export type LabelGranularity = 'day' | 'month';

/**
 * Human label for an inclusive day range — always concrete, never "This week".
 *
 * 'day' granularity reads as days ("Aug 23 – 29", "Jul 31 – Aug 29"); 'month'
 * collapses to months ("Jun – Aug 2026"), which is what the 3-month and year
 * periods want since naming their exact end days adds noise, not information.
 * The year is appended only when it isn't the current one, so the common case
 * stays short enough for the sticky header.
 *
 * Shared by the preset periods and the custom range, so one screen can never
 * render two different date-formatting conventions.
 */
export const formatDayRangeLabel = (
    { startDay, endDay }: DayRange,
    today: string,
    granularity: LabelGranularity = 'day',
): string => {
    const [startYear, startMonth, startDate] = startDay.split('-').map(Number);
    const [endYear, endMonth, endDate] = endDay.split('-').map(Number);
    const startMon = MONTH_NAMES[startMonth - 1];
    const endMon = MONTH_NAMES[endMonth - 1];

    if (granularity === 'month') {
        if (startYear !== endYear) return `${startMon} ${startYear} – ${endMon} ${endYear}`;
        if (startMonth === endMonth) return `${startMon} ${endYear}`;
        return `${startMon} – ${endMon} ${endYear}`;
    }

    // Day granularity. Spanning two years always needs both years spelled out.
    if (startYear !== endYear) {
        return `${startMon} ${startDate}, ${startYear} – ${endMon} ${endDate}, ${endYear}`;
    }
    const yearSuffix = endYear !== Number(today.slice(0, 4)) ? `, ${endYear}` : '';
    // A one-day range is a DATE, not a range: "Aug 15", never "Aug 15 – 15".
    // Unreachable for the presets (all >= 7 days); reachable for a custom range.
    if (startDay === endDay) return `${startMon} ${startDate}${yearSuffix}`;
    return startMonth === endMonth
        ? `${startMon} ${startDate} – ${endDate}${yearSuffix}`
        : `${startMon} ${startDate} – ${endMon} ${endDate}${yearSuffix}`;
};

/**
 * Human label for the period `offset` steps back from now. Granularity follows
 * the period length: week/month read as days, 3 months/year as months.
 */
export const formatPeriodLabel = (
    timeframe: Timeframe,
    offset: number,
    today: string,
): string => {
    if (timeframe === 'alltime') return 'All time';
    return formatDayRangeLabel(
        periodDayRange(timeframe, offset, today),
        today,
        timeframe === '3months' || timeframe === 'year' ? 'month' : 'day',
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOM RANGES
//
// The presets answer "the last N days"; a custom range answers "these two dates
// I picked on a calendar". It joins the model at exactly one point — it produces
// a `PeriodWindow` like any preset — so every chart keeps reading ONE window and
// none of them needs to know a custom range exists.
//
// What a custom range deliberately does NOT get: period paging. "The period
// before Aug 15 – Sep 13" has no single obvious reading (is the step 30 days, or
// a calendar month?), and inventing one would put a wrong label over real data.
// Paging is disabled in custom mode; the presets remain the way to walk history.
// ─────────────────────────────────────────────────────────────────────────────

/** True for a well-formed `YYYY-MM-DD` that names a real calendar day. */
export const isValidDay = (day: unknown): day is string => {
    if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
    const [y, m, d] = day.split('-').map(Number);
    const parsed = new Date(y, m - 1, d);
    // Round-trips only if the day really exists (rejects 2026-02-30, month 13…).
    return (
        parsed.getFullYear() === y &&
        parsed.getMonth() === m - 1 &&
        parsed.getDate() === d
    );
};

/** Inclusive day count of a range — the real denominator for a custom window. */
export const dayCountInclusive = ({ startDay, endDay }: DayRange): number =>
    daysBetweenDays(startDay, endDay) + 1;

/**
 * Coerce two picked days into a usable inclusive range, or `null` if they can't
 * be one. Order-insensitive (tapping the later day first is a normal way to use
 * a calendar) and never allows the future, which would show an empty tail under
 * a confident label.
 *
 * A start BEFORE the user's first entry is deliberately allowed: "everything up
 * to March" is a legitimate question, and padding it with empty leading days is
 * the honest answer rather than silently moving the bound the user chose.
 */
export const normaliseCustomRange = (
    a: string,
    b: string,
    today: string,
): DayRange | null => {
    if (!isValidDay(a) || !isValidDay(b) || !isValidDay(today)) return null;
    const [startDay, endDay] = daysBetweenDays(a, b) < 0 ? [b, a] : [a, b];
    // Clamp the END to today rather than rejecting: a future end can only come
    // from a stale "today" (a session left open across local midnight), and
    // clamping keeps the user's start instead of discarding their selection.
    const clampedEnd = daysBetweenDays(endDay, today) < 0 ? today : endDay;
    // A start past the clamped end (both in the future) has nothing left to show.
    if (daysBetweenDays(startDay, clampedEnd) < 0) return null;
    return { startDay, endDay: clampedEnd };
};

/**
 * The `PeriodWindow` for an inclusive custom day range. Same shape and the same
 * whole-boundary-day UTC instants as a preset window, so it drops straight into
 * every `WHERE date BETWEEN ?start AND ?end` on the screen.
 */
export const computeCustomWindow = ({ startDay, endDay }: DayRange): PeriodWindow => ({
    startDay,
    endDay,
    start: startOfLocalDay(parseDay(startDay)),
    end: endOfLocalDay(parseDay(endDay)),
});

/**
 * The preset whose LENGTH a window of `days` days most resembles.
 *
 * This is how a custom range reaches the charts' length-sensitive policies —
 * x-axis label density (weeklyMood.formatLabel), moving-average width
 * (moodSeries.maWindowFor), the trend card's title — without every one of them
 * growing a 'custom' branch. A 3-day range is answered like a week (weekday
 * labels, no moving average); a 400-day range like a year (sparse "Mon 'YY"
 * labels, a 14-day average). 'alltime' is never returned: it is a *policy*
 * ("ignore the offset, start at the epoch"), not a length, and returning it
 * would make a bounded range claim to be unbounded.
 *
 * Invariant (pinned by test): every preset's own length maps back to itself.
 */
export const granularityForDays = (days: number): BoundedTimeframe => {
    if (!Number.isFinite(days) || days <= PERIOD_LENGTH_DAYS.week) return 'week';
    // Boundaries sit well clear of each preset's own length so the round-trip
    // invariant holds, and lean toward the SHORTER preset — a 6-week range reads
    // better at month resolution than sparsened like a quarter.
    if (days <= 45) return 'month';
    if (days <= 150) return '3months';
    return 'year';
};
