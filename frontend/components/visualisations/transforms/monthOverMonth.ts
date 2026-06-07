// monthOverMonth.ts
//
// Pure transform: compare the current calendar month against the previous one.
//
// Note: this is CALENDAR-month based (1st to last day), NOT the rolling
// TimeframeSelector window. The card that renders this must label it clearly so
// users don't conflate it with the timeframe-scoped charts.

export type MonthMoodRow = {
    avg_mood: number | null;
    entry_count: number;
};

export type MonthOverMonthData = {
    currentAvg: number;
    previousAvg: number;
    delta: number; // currentAvg - previousAvg
    currentEntryCount: number;
    previousEntryCount: number;
    trend: 'up' | 'down' | 'flat'; // |delta| < FLAT_THRESHOLD -> flat
    currentConsistencyPct: number; // currentEntryCount / daysInCurrentMonth * 100, capped 100
    previousConsistencyPct: number; // previousEntryCount / daysInPreviousMonth * 100, capped 100
};

/** A mood delta smaller than this (absolute) is considered flat. */
export const FLAT_THRESHOLD = 0.3;

const num = (v: number | null): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : 0;

const pct = (count: number, days: number): number => {
    if (days <= 0) return 0;
    return Math.min(100, (count / days) * 100);
};

/**
 * Compute month-over-month comparison.
 *
 * @param current               aggregate for the current calendar month.
 * @param previous              aggregate for the previous calendar month.
 * @param daysInCurrentMonth    number of days in the current month (28-31).
 * @param daysInPreviousMonth   number of days in the previous month. Defaults
 *                              to daysInCurrentMonth if not provided (kept
 *                              optional for backward compat).
 */
export const computeMonthOverMonth = (
    current: MonthMoodRow,
    previous: MonthMoodRow,
    daysInCurrentMonth: number,
    daysInPreviousMonth: number = daysInCurrentMonth
): MonthOverMonthData => {
    const currentAvg = num(current.avg_mood);
    const previousAvg = num(previous.avg_mood);
    const delta = currentAvg - previousAvg;

    let trend: 'up' | 'down' | 'flat';
    if (Math.abs(delta) < FLAT_THRESHOLD) {
        trend = 'flat';
    } else if (delta > 0) {
        trend = 'up';
    } else {
        trend = 'down';
    }

    return {
        currentAvg,
        previousAvg,
        delta,
        currentEntryCount: num(current.entry_count),
        previousEntryCount: num(previous.entry_count),
        trend,
        currentConsistencyPct: pct(num(current.entry_count), daysInCurrentMonth),
        previousConsistencyPct: pct(
            num(previous.entry_count),
            daysInPreviousMonth
        ),
    };
};
