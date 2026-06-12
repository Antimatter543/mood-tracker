import React, { useCallback, useState, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { useSQLiteContext } from 'expo-sqlite';
import { useThemeColors } from '@/styles/global';
import { useDataRefresh } from '@/hooks/useDataRefresh';
import { Card } from '@/components/Card';
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
import { dailyAverageRows } from './transforms/dailyAverages';
import { WEEKLY_MOOD_AVERAGES } from './queries';
import { buildStatSummary, type StatSummaryData } from './transforms/statSummary';

/** Material red 300 — semantic "falling" signal, not a brand color. */
const FALLING_COLOR = '#e57373';

const StatSummaryCard: React.FC = () => {
    const colors = useThemeColors();
    const db = useSQLiteContext();
    const { timeframe } = useTimeframe();
    const [summary, setSummary] = useState<StatSummaryData | null>(null);

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
                tile: {
                    width: '50%',
                    paddingVertical: 12,
                    paddingHorizontal: 4,
                },
                tileInner: {
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                },
                iconWrap: {
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    backgroundColor: colors.accentLight,
                    justifyContent: 'center',
                    alignItems: 'center',
                },
                textCol: {
                    flex: 1,
                },
                value: {
                    fontSize: 18,
                    fontWeight: '700',
                    color: colors.text,
                },
                label: {
                    fontSize: 12,
                    color: colors.textSecondary,
                    marginTop: 2,
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
            } catch (error) {
                console.error('Error building stat summary:', error);
                setSummary(null);
            }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- query reads db + timeframe; setState identities are stable
        }, [db, timeframe]);
    // Focus-aware refetch (replaces useEffect([db, refreshCount, timeframe])).
    useDataRefresh(fetchSummary, [db, timeframe]);

    const trend = summary?.trendArrow ?? 'stable';
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
    const trendLabel =
        trend === 'rising'
            ? 'Rising'
            : trend === 'falling'
              ? 'Falling'
              : 'Stable';

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
            value: trendLabel,
            label: 'Trend',
            color: trendColor,
        },
    ];

    return (
        <Card accentTop>
            <Text style={styles.title}>Overview</Text>
            <View style={styles.grid}>
                {tiles.map((tile) => (
                    <View key={tile.label} style={styles.tile}>
                        <View style={styles.tileInner}>
                            <View style={styles.iconWrap}>
                                <Feather
                                    name={tile.icon}
                                    size={18}
                                    color={tile.color ?? colors.accent}
                                />
                            </View>
                            <View style={styles.textCol}>
                                <Text
                                    style={[
                                        styles.value,
                                        tile.color ? { color: tile.color } : null,
                                    ]}
                                    numberOfLines={1}
                                >
                                    {tile.value}
                                </Text>
                                <Text style={styles.label} numberOfLines={1}>
                                    {tile.label}
                                </Text>
                            </View>
                        </View>
                    </View>
                ))}
            </View>
        </Card>
    );
};

export default StatSummaryCard;
