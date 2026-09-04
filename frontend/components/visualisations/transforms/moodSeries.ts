// moodSeries.ts
//
// PURE series shaping for the Statistics mood-trend chart. No React imports.
//
// Two jobs, both of which used to be done wrong (or not at all) inline in
// MoodTrendChart:
//
// 1. GAP FILLING. `dailyAverageRows` only emits days the user actually logged.
//    Plotting those consecutively puts a three-month silence and a one-day
//    silence at the same distance apart, so the x axis stops being a time axis
//    and a "14-day moving average" is really a 14-ENTRY average. `fillDailyGaps`
//    re-expands the series onto the calendar, marking unlogged days `null` so
//    the renderer can dash across them instead of inventing a mood.
//
// 2. DOWN-SAMPLING. An all-time window is hundreds to thousands of days; drawing
//    every one of them makes a hairball. `sampleIndices` picks the indices to
//    keep ONCE, so the raw series, the moving average and the labels can all be
//    sampled through the same index list and stay aligned. (Sampling each array
//    independently is how the raw line and its overlay drift apart.)

import { addDays, daysBetween } from '@/databases/dateHelpers';
import type { DayAvgRow } from './dailyAverages';

/** One plotted slot: a local day, and its average mood or `null` for "not logged". */
export type MoodSeriesPoint = {
    /** Local day, "YYYY-MM-DD". */
    date: string;
    /** Average mood that day, or null when the user logged nothing. */
    value: number | null;
};

/**
 * Upper bound on generated slots. ~11 years of daily slots is already far more
 * than any chart can show (they get down-sampled to ~90 anyway); past that, a
 * corrupt or absurd stored date could otherwise spin a multi-million-iteration
 * loop on the render path. Over the cap we return the logged days as-is — a
 * compressed axis is a far better failure than a frozen screen.
 */
const MAX_FILLED_DAYS = 4000;

/** True when a "YYYY-MM-DD" day parses. Parsed as LOCAL midnight, never bare. */
const isValidDay = (day: string): boolean =>
    typeof day === 'string' && !Number.isNaN(new Date(`${day}T00:00:00`).getTime());

/**
 * Expand logged-day rows onto the calendar between the FIRST and LAST logged
 * day (inclusive), inserting `null` for every day in between with no entry.
 *
 * The range is bounded by the data, not by the selected period, deliberately:
 * a user who logged twice in a year-long window should see those two points and
 * the silence between them, not 360 empty leading slots that squash the real
 * data into the last inch of the chart.
 *
 * Rows are assumed ascending by day (which `dailyAverageRows` guarantees).
 * Empty input returns an empty series — the caller renders its empty state.
 */
export const fillDailyGaps = (rows: readonly DayAvgRow[]): MoodSeriesPoint[] => {
    if (!rows || rows.length === 0) return [];

    const unfilled = () => rows.map((r) => ({ date: r.date, value: r.avgMood }));

    const first = rows[0].date;
    const last = rows[rows.length - 1].date;

    // `daysBetween` THROWS on an unparseable day, and this runs on the render
    // path of the Statistics screen — where an exception is a white screen, not
    // a missing chart. Validate the endpoints ourselves and degrade instead.
    if (!isValidDay(first) || !isValidDay(last)) return unfilled();

    const span = daysBetween(first, last);

    // Degenerate or implausible range: fall back to the logged days themselves.
    if (!Number.isFinite(span) || span < 0 || span + 1 > MAX_FILLED_DAYS) {
        return unfilled();
    }

    const byDay = new Map<string, number>();
    for (const r of rows) byDay.set(r.date, r.avgMood);

    const out: MoodSeriesPoint[] = [];
    let day = first;
    for (let i = 0; i <= span; i++) {
        const value = byDay.get(day);
        out.push({ date: day, value: value === undefined ? null : value });
        day = addDays(day, 1);
    }
    return out;
};

/**
 * Indices to keep when reducing a `length`-long series to at most `maxPoints`.
 *
 * Takes every N-th index and ALWAYS includes the last one, so the trend's most
 * recent end — the part the user actually came to look at — is never clipped.
 * `maxPoints <= 0` or a series already short enough keeps everything.
 */
export const sampleIndices = (length: number, maxPoints: number): number[] => {
    if (length <= 0) return [];
    if (maxPoints <= 0 || length <= maxPoints) {
        return Array.from({ length }, (_, i) => i);
    }
    const step = Math.ceil(length / maxPoints);
    const out: number[] = [];
    for (let i = 0; i < length; i += step) out.push(i);
    if (out[out.length - 1] !== length - 1) out.push(length - 1);
    return out;
};
