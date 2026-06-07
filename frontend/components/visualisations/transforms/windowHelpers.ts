// windowHelpers.ts
//
// Shared local-time window computation for timeframe-scoped charts.
//
// Previously `computeWindow` lived inline in WeeklyMoodChart.tsx. As more charts
// (DailyMoodBar, MoodTrendChart, Scatterplot, ActivityCorrelationChart) need the
// same window, it's extracted here to avoid a third+ copy. Every chart that
// scopes to the TimeframeSelector should import this.
//
// TIMEZONE: the boundaries are computed in JS local time via dateHelpers, then
// converted to UTC ISO strings (startOfLocalDay/endOfLocalDay) for SQLite's
// BETWEEN ? AND ?. NEVER use SQLite's date('now') — it's UTC and breaks for
// users east/west of UTC near midnight.

import {
    startOfLocalDay,
    endOfLocalDay,
    addDays,
    localDateString,
} from './dateHelpers';

export type Timeframe = 'week' | 'month' | '3months' | 'year' | 'alltime';

export type Window = { start: string; end: string };

/**
 * Returns the local-time window (start, end) covering `timeframe` relative to
 * the user's local "now". `start`/`end` are UTC ISO strings suitable for
 * `WHERE date BETWEEN ? AND ?`.
 */
export const computeWindow = (timeframe: Timeframe): Window => {
    const today = localDateString(new Date());
    const end = endOfLocalDay(today);

    switch (timeframe) {
        case 'week':
            return { start: startOfLocalDay(addDays(today, -7)), end };
        case 'month':
            return { start: startOfLocalDay(addDays(today, -30)), end };
        case '3months':
            return { start: startOfLocalDay(addDays(today, -90)), end };
        case 'year':
            return { start: startOfLocalDay(addDays(today, -365)), end };
        case 'alltime':
            // Effectively unbounded — pick a far-past anchor.
            return { start: '1970-01-01T00:00:00.000Z', end };
        default:
            return { start: startOfLocalDay(addDays(today, -7)), end };
    }
};

/**
 * Approximate number of calendar days covered by a timeframe. Used by KPI
 * consistency math (entries / daysInWindow). For 'alltime', the caller should
 * pass the actual span; this returns a large default that the caller can
 * override.
 */
export const daysInTimeframe = (timeframe: Timeframe): number => {
    switch (timeframe) {
        case 'week':
            return 7;
        case 'month':
            return 30;
        case '3months':
            return 90;
        case 'year':
            return 365;
        case 'alltime':
            return 365; // caller may override with real span
        default:
            return 7;
    }
};
