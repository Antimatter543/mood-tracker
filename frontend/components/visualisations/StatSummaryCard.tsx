import React, { useCallback, useState, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { useSQLiteContext } from 'expo-sqlite';
import { useThemeColors } from '@/styles/global';
import { useDataRefresh } from '@/hooks/useDataRefresh';
import { Card } from '@/components/Card';
import { StatTile } from '@/components/StatTile';
import { useTimeframe } from '@/context/TimeframeContext';
import { WINDOW_SUMMARY, RECENT_ENTRY_DATES } from './queries';
import {
    computeWindow,
    daysInTimeframe,
    type Timeframe,
} from './transforms/windowHelpers';
import { startOfLocalDay, addDays, localDateString } from './transforms/dateHelpers';
import { currentStreak, longestStreak } from './transforms/streak';
import { computeMovingAverage } from './transforms/movingAverage';
import { buildWeeklyMoodChartData, type MoodAvgRow } from './transforms/weeklyMood';
import { dailyAverageRows, aggregateDailyAverages } from './transforms/dailyAverages';
import { WEEKLY_MOOD_AVERAGES } from './queries';
import { buildStatSummary, type StatSummaryData } from './transforms/statSummary';
import { buildMoodState, type MoodState } from './transforms/moodState';

/** Material red 300 — semantic "falling" signal, not a brand color. */
const FALLING_COLOR = '#e57373';

const StatSummaryCard: React.FC = () => {
    const colors = useThemeColors();
    const db = useSQLiteContext();
    const { timeframe } = useTimeframe();
    const [summary, setSummary] = useState<StatSummaryData | null>(null);
    const [moodState, setMoodState] = useState<MoodState | null>(null);

    const styles = useMemo(
        () =>
            StyleSheet.create({
                title: {
                    fontSize: 18,
                    fontWeight: '600',
                    color: colors.text,
                    marginBottom: 16,
                },
                grid: {
                    flexDirection: 'row',
                    flexWrap: 'wrap',
                },
                // Per-tile width wrapper — the 2x2 grid cell. The StatTile
                // primitive fills it; padding here breathes the tiles apart.
                tile: {
                    width: '50%',
                    paddingVertical: 12,
                    paddingHorizontal: 4,
                },
            }),
        [colors]
    );

    const fetchSummary = useCallback(async () => {
            try {
                const tf = timeframe as Timeframe;
                const { start, end } = computeWindow(tf);
                // Streak lookback: 60 days of distinct local entry dates.
                const streakStart = startOfLocalDay(
                    addDays(localDateString(new Date()), -60)
                );

                const [windowRow, entryDateRows, rawDailyRows] = await Promise.all([
                    db.getFirstAsync<{ avg_mood: number | null; entry_count: number }>(
                        WINDOW_SUMMARY,
                        [start, end]
                    ),
                    db.getAllAsync<{ date: string }>(RECENT_ENTRY_DATES, [streakStart]),
                    db.getAllAsync<{ date: string; mood: number }>(
                        WEEKLY_MOOD_AVERAGES,
                        [start, end]
                    ),
                ]);

                // RECENT_ENTRY_DATES now returns raw instants -> map to LOCAL
                // day strings + de-dupe before the streak (matches the rest of
                // the app; currentStreak/longestStreak tolerate the order).
                const entryDates = Array.from(
                    new Set(entryDateRows.map((r) => localDateString(r.date)))
                );
                const today = localDateString(new Date());

                // Per-LOCAL-day averages from the raw rows for the MA slope.
                const dailyRows: MoodAvgRow[] = dailyAverageRows(rawDailyRows);

                // Moving-average slope over the window's gap-filled daily avgs.
                const built = buildWeeklyMoodChartData(dailyRows, tf);
                const dense = built.isEmpty
                    ? []
                    : built.data.map((value, i) => ({
                          date: String(i),
                          avgMood: value,
                      }));
                const ma = computeMovingAverage(dense, 7);
                const slope =
                    ma.length >= 2
                        ? (ma[ma.length - 1].value - ma[0].value) /
                          (ma.length - 1)
                        : 0;

                setSummary(
                    buildStatSummary({
                        currentStreak: currentStreak(entryDates, today),
                        longestStreak: longestStreak(entryDates),
                        avgMoodInWindow: windowRow?.avg_mood ?? 0,
                        totalEntries: windowRow?.entry_count ?? 0,
                        daysInWindow: daysInTimeframe(tf),
                        movingAverageSlope: slope,
                    })
                );

                // 2-axis mood-state from the window's RECORDED days (no gap-fill,
                // so real swings survive). Pass the same MA slope the chart uses
                // so the trend direction matches the line.
                setMoodState(
                    buildMoodState(aggregateDailyAverages(rawDailyRows), { slope })
                );
            } catch (error) {
                console.error('Error building stat summary:', error);
                setSummary(null);
                setMoodState(null);
            }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- query reads db + timeframe; setState identities are stable
        }, [db, timeframe]);
    // Focus-aware refetch (replaces useEffect([db, refreshCount, timeframe])).
    useDataRefresh(fetchSummary, [db, timeframe]);

    // The trend chip now carries the richer 2-axis mood-state when classified,
    // falling back to the single trendArrow while still 'building'. The icon
    // tracks the trend axis; the volatility shows as the swing subtitle.
    const trend: 'rising' | 'falling' | 'steady' | 'stable' =
        moodState?.state === 'classified' && moodState.trend
            ? moodState.trend
            : summary?.trendArrow ?? 'stable';
    const trendIcon: React.ComponentProps<typeof Feather>['name'] =
        trend === 'rising'
            ? 'trending-up'
            : trend === 'falling'
              ? 'trending-down'
              : 'minus';
    const trendColor =
        trend === 'rising'
            ? colors.accent
            : trend === 'falling'
              ? FALLING_COLOR
              : colors.textSecondary;
    // Value = the warm state label (e.g. "Settled") when classified, else the
    // plain arrow word. Subtitle = the swing magnitude, or "Trend" while building.
    const trendValue =
        moodState?.state === 'classified'
            ? moodState.label
            : trend === 'rising'
              ? 'Rising'
              : trend === 'falling'
                ? 'Falling'
                : 'Stable';
    const trendSubtitle =
        moodState?.state === 'classified' && moodState.swing != null
            ? `~${moodState.swing.toFixed(1)} pts/day swing`
            : 'Trend';

    const tiles: {
        icon: React.ComponentProps<typeof Feather>['name'];
        value: string;
        label: string;
        color?: string;
    }[] = [
        {
            icon: 'zap',
            value: `${summary?.streak ?? 0} ${
                (summary?.streak ?? 0) === 1 ? 'day' : 'days'
            }`,
            label: `Streak · best ${summary?.longestStreak ?? 0}`,
        },
        {
            icon: 'activity',
            value: `${(summary?.avgMood ?? 0).toFixed(1)} / 10`,
            label: 'Avg mood',
        },
        {
            icon: 'check-circle',
            value: `${summary?.consistency ?? 0}%`,
            label: 'Consistency',
        },
        {
            icon: trendIcon,
            value: trendValue,
            label: trendSubtitle,
            color: trendColor,
        },
    ];

    return (
        <Card accentTop>
            <Text style={styles.title}>Overview</Text>
            <View style={styles.grid}>
                {tiles.map((tile) => (
                    <View key={tile.label} style={styles.tile}>
                        <StatTile
                            icon={tile.icon}
                            value={tile.value}
                            label={tile.label}
                            color={tile.color}
                        />
                    </View>
                ))}
            </View>
        </Card>
    );
};

export default StatSummaryCard;
