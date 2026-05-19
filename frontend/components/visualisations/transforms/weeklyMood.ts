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
            return `Week ${index + 1}`;

        case '3months': {
            if (index === 0 || index === totalPoints - 1) {
                return `${date.getMonth() + 1}/${date.getDate()}`;
            }
            if (index % 3 === 0) {
                return `${date.getMonth() + 1}/${date.getDate()}`;
            }
            return '';
        }

        case 'year':
        case 'alltime':
            return date.toLocaleDateString(undefined, { month: 'short' });

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
