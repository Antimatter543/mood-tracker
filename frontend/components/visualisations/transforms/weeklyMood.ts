// weeklyMood.ts
//
// Turns raw "daily-average" rows from SQL into the labels+data+nullIndices
// shape consumed by react-native-chart-kit's LineChart.

import { interpolateData } from '../chartUtils';

export type MoodAvgRow = {
    date: string;          // "YYYY-MM-DD"
    avgMood: number | null; // null when no entries that day
};

export type Timeframe = 'week' | 'month' | '3months' | 'year' | 'alltime';

export type WeeklyMoodChartData = {
    labels: string[];
    data: number[];
    nullIndices: number[];
    /** True when there are no rows at all (the caller should render empty state). */
    isEmpty: boolean;
};

/**
 * Format a single row's date as a chart label, based on the active timeframe.
 *
 * Splitting label-formatting out of the React component:
 *   1. Lets tests pin behaviour at known dates without rendering.
 *   2. Fixes the useEffect stale-closure warning in WeeklyMoodChart (the
 *      previous inline `formatDateLabel` captured `timeframe` from render
 *      and was not listed in the effect deps).
 */
// Non-week timeframes plot one point PER DAY - up to 365+ points. chart-kit
// draws every label, so returning a label for each point crams overlapping
// text onto the axis. We instead show only a handful of evenly-spaced index
// positions (TARGET_AXIS_LABELS total), blanking the rest. Spreading by index
// guarantees labels stay sparse regardless of calendar density.
const TARGET_AXIS_LABELS = 5;

/**
 * True at ~TARGET_AXIS_LABELS evenly-spaced positions across [0, totalPoints).
 * Always includes the first and last index so the axis is anchored at both ends.
 */
const isSparseLabelIndex = (index: number, totalPoints: number): boolean => {
    if (totalPoints <= TARGET_AXIS_LABELS) return true;
    if (index === 0 || index === totalPoints - 1) return true;
    // Step between shown labels, rounded so we land on integer indices.
    const step = (totalPoints - 1) / (TARGET_AXIS_LABELS - 1);
    // Show when this index is the nearest integer to one of the target slots.
    const slot = Math.round(index / step);
    return Math.round(slot * step) === index;
};

/** "Jan '25" — month + 2-digit year, so adjacent years are unambiguous. */
const monthYearLabel = (date: Date): string => {
    const month = date.toLocaleDateString(undefined, { month: 'short' });
    const yy = String(date.getFullYear()).slice(-2);
    return `${month} '${yy}`;
};

/** Short enough for month/quarter axes on narrow phones. */
const numericMonthDayLabel = (date: Date): string =>
    `${date.getMonth() + 1}/${date.getDate()}`;

export const formatLabel = (
    dateStr: string,
    index: number,
    totalPoints: number,
    timeframe: Timeframe
): string => {
    // Use Date constructor on YYYY-MM-DD strings — parses as UTC. For label
    // formatting we want the local-calendar view of that date. Append a time
    // so it parses as local midnight rather than UTC midnight.
    const date = new Date(`${dateStr}T00:00:00`);

    switch (timeframe) {
        case 'week':
            return date.toLocaleDateString(undefined, { weekday: 'short' });

        case 'month':
            return isSparseLabelIndex(index, totalPoints)
                ? numericMonthDayLabel(date)
                : '';

        case '3months':
            return isSparseLabelIndex(index, totalPoints)
                ? numericMonthDayLabel(date)
                : '';

        case 'year':
        case 'alltime':
            // ~5 evenly-spaced labels, each "Mon 'YY" so the year is explicit
            // and you can tell e.g. Jan '25 from Jan '26. Everything else blank.
            return isSparseLabelIndex(index, totalPoints)
                ? monthYearLabel(date)
                : '';

        default:
            return date.toLocaleDateString(undefined, { weekday: 'short' });
    }
};

/**
 * Build the chart-ready data shape from raw daily-average rows.
 *
 * - Empty rows -> `isEmpty: true`, caller renders empty state.
 * - Null avgMood values are interpolated (linear); their original indices
 *   are returned in `nullIndices` so the renderer can colour those dots red.
 */
export const buildWeeklyMoodChartData = (
    rows: MoodAvgRow[],
    timeframe: Timeframe
): WeeklyMoodChartData => {
    if (rows.length === 0) {
        return { labels: [], data: [], nullIndices: [], isEmpty: true };
    }

    const moodValues = rows.map((r) => r.avgMood);
    const labels = rows.map((r, i) => formatLabel(r.date, i, rows.length, timeframe));
    const { data, nullIndices } = interpolateData(moodValues);

    return { labels, data, nullIndices, isEmpty: false };
};
