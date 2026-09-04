import { useCallback, useState } from 'react';
import { useSQLiteContext } from 'expo-sqlite';

import { useDataRefresh } from '@/hooks/useDataRefresh';
import { useTimeframe } from '@/context/TimeframeContext';
import { interpolateData } from './chartUtils';
import { ENTRY_DETAILS_IN_RANGE, WEEKLY_MOOD_AVERAGES } from './queries';
import { dailyAverageRows } from './transforms/dailyAverages';
import { computeMovingAverage } from './transforms/movingAverage';
import {
    fillDailyGaps,
    maWindowFor,
    sampleIndices,
    MAX_POINTS,
    type MoodSeriesPoint,
} from './transforms/moodSeries';
import { latestEntryPerDay, type EntryDetailRow, type LatestEntry } from './transforms/latestEntry';
import { formatLabel } from './transforms/weeklyMood';
import { type Timeframe } from './transforms/windowHelpers';

/**
 * The Statistics mood-trend data pipeline, extracted from the chart component so
 * the card and its expanded view share ONE read (and one definition of what a
 * point means) instead of each fetching its own.
 */

export type MoodTrendData = {
    /** Down-sampled daily series, oldest first. `value: null` = no entry that day. */
    series: MoodSeriesPoint[];
    /** Moving average aligned 1:1 with `series`, or null when the window is 0. */
    overlay: number[] | null;
    /** Sparse x-axis labels aligned 1:1 with `series`. */
    labels: string[];
    /** Local day -> that day's most recent entry, for the scrub readout. */
    latestEntries: Map<string, LatestEntry>;
    /** Days in the moving-average window (0 = no overlay). */
    maWindow: number;
    loading: boolean;
    /** True once loaded with no entries in this period. */
    isEmpty: boolean;
};

const EMPTY_ENTRIES: Map<string, LatestEntry> = new Map();

export const useMoodTrendData = (): MoodTrendData => {
    const db = useSQLiteContext();
    const { timeframe, periodWindow } = useTimeframe();
    const tf = timeframe as Timeframe;

    const [loaded, setLoaded] = useState<Omit<MoodTrendData, 'loading' | 'isEmpty'> | null>(null);
    const [loading, setLoading] = useState(true);

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const { start, end } = periodWindow;

            // ONE continuation for both reads. React does not batch across an
            // `await`, so two sequential awaits would commit a render describing
            // half a view — the exact shape of the activity-grid bug in
            // tasks/lessons.md. Both reads use the same window.
            const [rawRows, detailRows] = await Promise.all([
                db.getAllAsync<{ date: string; mood: number }>(WEEKLY_MOOD_AVERAGES, [start, end]),
                db.getAllAsync<EntryDetailRow>(ENTRY_DETAILS_IN_RANGE, [start, end]),
            ]);

            const rows = dailyAverageRows(rawRows);
            if (rows.length === 0) {
                setLoaded(null);
                setLoading(false);
                return;
            }

            // Re-expand onto the calendar so the x axis is a TIME axis: unlogged
            // days become null slots the chart dashes across, instead of being
            // silently closed up (which made a three-month silence and a
            // one-day silence the same width).
            const dense = fillDailyGaps(rows);

            // The moving average is computed over the INTERPOLATED dense series
            // (a trend line with holes in it isn't a trend line) and over the
            // FULL series before down-sampling, so its window really is N days.
            const window = maWindowFor(tf);
            const maFull =
                window > 0
                    ? computeMovingAverage(
                          interpolateData(dense.map((p) => p.value)).data.map((value, i) => ({
                              date: dense[i].date,
                              avgMood: value,
                          })),
                          window
                      )
                    : null;

            // One index list drives the raw series, the overlay AND the labels,
            // so they cannot drift out of alignment.
            const keep = sampleIndices(dense.length, MAX_POINTS);
            const series = keep.map((i) => dense[i]);

            setLoaded({
                series,
                overlay: maFull ? keep.map((i) => maFull[i].value) : null,
                labels: series.map((p, i) => formatLabel(p.date, i, series.length, tf)),
                latestEntries: latestEntryPerDay(detailRows),
                maWindow: window,
            });
        } catch (error) {
            console.error('Error fetching mood trend data:', error);
            setLoaded(null);
        }
        setLoading(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- reads db + periodWindow; tf only shapes labels/MA width; setState identities are stable
    }, [db, periodWindow, tf]);

    useDataRefresh(fetchData, [db, periodWindow, tf]);

    if (!loaded) {
        return {
            series: [],
            overlay: null,
            labels: [],
            latestEntries: EMPTY_ENTRIES,
            maWindow: 0,
            loading,
            isEmpty: !loading,
        };
    }

    return { ...loaded, loading, isEmpty: false };
};
