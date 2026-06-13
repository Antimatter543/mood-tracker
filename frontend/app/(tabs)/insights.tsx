import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSQLiteContext } from 'expo-sqlite';
import { Layout } from '@/components/PageContainer';
import { Card } from '@/components/Card';
import { ThemeColors, useThemeColors } from '@/styles/global';
import { useDataRefresh } from '@/hooks/useDataRefresh';
import { EmptyState } from '@/components/EmptyState';
import {
    startOfLocalDay,
    endOfLocalDay,
    localDateString,
} from '@/databases/dateHelpers';
import {
    DOW_MOOD_PATTERN,
    WINDOW_SUMMARY,
    RECENT_ENTRY_DATES,
    ACTIVITY_CORRELATION,
} from '@/components/visualisations/queries';
import { currentStreak, longestStreak } from '@/components/visualisations/transforms/streak';
import {
    buildDowPatternData,
    aggregateDowRows,
    type DowInstantRow,
} from '@/components/visualisations/transforms/dayOfWeekPattern';
import {
    computeActivityCorrelation,
    aggregateActivityCorrelation,
    type ActivityCorrelationRawRow,
} from '@/components/visualisations/transforms/activityCorrelation';

/**
 * Insights — honest, locally-derived patterns from the user's own entries.
 *
 * This replaces the old "Social" tab, which shipped fake friend data behind a
 * "Coming Soon" overlay in a 100%-local, account-free app. Every number here is
 * computed on-device from the entries table via the same pure, unit-tested
 * transforms the Statistics screen uses. No timeframe selector — this is an
 * all-time snapshot of "what your data says about you".
 */

type Insights = {
    totalEntries: number;
    avgMood: number;
    streak: number;
    longest: number;
    bestDay: string | null;
    worstDay: string | null;
    hasDowSignal: boolean;
    topActivity: { name: string; avgWith: number; avgWithout: number; delta: number } | null;
};

const EMPTY: Insights = {
    totalEntries: 0,
    avgMood: 0,
    streak: 0,
    longest: 0,
    bestDay: null,
    worstDay: null,
    hasDowSignal: false,
    topActivity: null,
};

export default function InsightsScreen() {
    const colors = useThemeColors();
    const styles = useStyles(colors);
    const db = useSQLiteContext();
    const [data, setData] = useState<Insights | null>(null);

    const load = useCallback(async () => {
            try {
                // All-time window: from the epoch up to the end of today (local).
                const start = startOfLocalDay(new Date(0));
                const end = endOfLocalDay(new Date());
                const today = localDateString(new Date());

                const [summary, dowRawRows, dateRows, activityRawRows] = await Promise.all([
                    db.getFirstAsync<{ avg_mood: number | null; entry_count: number }>(
                        WINDOW_SUMMARY,
                        [start, end]
                    ),
                    db.getAllAsync<DowInstantRow>(DOW_MOOD_PATTERN, [start, end]),
                    db.getAllAsync<{ date: string }>(RECENT_ENTRY_DATES, [start]),
                    db.getAllAsync<ActivityCorrelationRawRow>(ACTIVITY_CORRELATION, [start, end]),
                ]);

                // All three sources now return RAW instants/rows; day-keying
                // happens in JS (localDateString / aggregate*) — see queries.ts.
                const dates = Array.from(
                    new Set(dateRows.map((r) => localDateString(r.date)))
                );
                const dow = buildDowPatternData(aggregateDowRows(dowRawRows));
                const corr = computeActivityCorrelation(
                    aggregateActivityCorrelation(activityRawRows)
                );
                // Most uplifting activity = largest positive, meaningful delta.
                const positives = corr.meaningful
                    .filter((m) => m.delta > 0)
                    .sort((a, b) => b.delta - a.delta);
                const top = positives[0] ?? null;

                setData({
                    totalEntries: summary?.entry_count ?? 0,
                    avgMood: summary?.avg_mood ?? 0,
                    streak: currentStreak(dates, today),
                    longest: longestStreak(dates),
                    bestDay: dow.hasEnoughData ? dow.bestDay : null,
                    worstDay: dow.hasEnoughData ? dow.worstDay : null,
                    hasDowSignal: dow.hasEnoughData,
                    topActivity: top
                        ? {
                              name: top.activity_name,
                              avgWith: top.avg_with,
                              avgWithout: top.avg_without,
                              delta: top.delta,
                          }
                        : null,
                });
            } catch (e) {
                console.error('Error building insights:', e);
                setData(EMPTY);
            }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- query reads only db; setState identities are stable
        }, [db]);
    // Focus-aware refetch (replaces useEffect([db, refreshCount])): always
    // reloads when this tab regains focus AND live-updates while focused.
    useDataRefresh(load, [db]);

    if (data && data.totalEntries === 0) {
        return (
            <Layout>
                <EmptyState />
            </Layout>
        );
    }

    const d = data ?? EMPTY;

    return (
        <Layout>
            <Text style={styles.heading}>Insights</Text>
            <Text style={styles.sub}>What your entries say about you</Text>

            {/* Streak hero */}
            <Card accentTop>
                <View style={styles.row}>
                    <View style={[styles.iconCircle, { backgroundColor: colors.accentLight }]}>
                        <Ionicons name="flame" size={22} color={colors.accent} />
                    </View>
                    <View style={styles.grow}>
                        <Text style={styles.bigValue}>
                            {d.streak} {d.streak === 1 ? 'day' : 'days'}
                        </Text>
                        <Text style={styles.cardSub}>
                            Current streak · longest {d.longest}
                        </Text>
                    </View>
                </View>
            </Card>

            {/* Overview */}
            <Card>
                <View style={styles.statsGrid}>
                    <View style={styles.stat}>
                        <Text style={styles.statValue}>{d.avgMood.toFixed(1)}</Text>
                        <Text style={styles.statLabel}>Average mood</Text>
                    </View>
                    <View style={styles.stat}>
                        <Text style={styles.statValue}>{d.totalEntries}</Text>
                        <Text style={styles.statLabel}>Entries logged</Text>
                    </View>
                </View>
            </Card>

            {/* Day-of-week pattern */}
            <Card>
                <View style={styles.row}>
                    <View style={[styles.iconCircle, { backgroundColor: colors.accentLight }]}>
                        <Ionicons name="calendar-outline" size={20} color={colors.accent} />
                    </View>
                    <View style={styles.grow}>
                        {d.hasDowSignal && d.bestDay ? (
                            <>
                                <Text style={styles.cardTitle}>Your week</Text>
                                <Text style={styles.cardBody}>
                                    You tend to feel best on{' '}
                                    <Text style={styles.emphasis}>{d.bestDay}</Text>
                                    {d.worstDay && d.worstDay !== d.bestDay ? (
                                        <>
                                            {' '}and toughest on{' '}
                                            <Text style={styles.emphasis}>{d.worstDay}</Text>
                                        </>
                                    ) : null}
                                    .
                                </Text>
                            </>
                        ) : (
                            <>
                                <Text style={styles.cardTitle}>Your week</Text>
                                <Text style={styles.cardBody}>
                                    Keep logging for a couple of weeks to reveal which days
                                    tend to lift you up.
                                </Text>
                            </>
                        )}
                    </View>
                </View>
            </Card>

            {/* Top activity correlation */}
            <Card>
                <View style={styles.row}>
                    <View style={[styles.iconCircle, { backgroundColor: colors.accentLight }]}>
                        <Ionicons name="sparkles-outline" size={20} color={colors.accent} />
                    </View>
                    <View style={styles.grow}>
                        <Text style={styles.cardTitle}>What lifts your mood</Text>
                        {d.topActivity ? (
                            <Text style={styles.cardBody}>
                                When you log{' '}
                                <Text style={styles.emphasis}>{d.topActivity.name}</Text>, your
                                mood averages{' '}
                                <Text style={styles.emphasis}>
                                    {d.topActivity.avgWith.toFixed(1)}
                                </Text>{' '}
                                — that's{' '}
                                <Text style={[styles.emphasis, { color: colors.accent }]}>
                                    +{d.topActivity.delta.toFixed(1)}
                                </Text>{' '}
                                above days without it ({d.topActivity.avgWithout.toFixed(1)}).
                            </Text>
                        ) : (
                            <Text style={styles.cardBody}>
                                Log activities alongside your mood and we'll surface which ones
                                tend to lift you most.
                            </Text>
                        )}
                    </View>
                </View>
            </Card>

            <Text style={styles.footnote}>
                All insights are computed on your device from your own entries. Nothing leaves
                your phone.
            </Text>
        </Layout>
    );
}

const useStyles = (colors: ThemeColors) =>
    useMemo(
        () =>
            StyleSheet.create({
                heading: {
                    fontSize: 28,
                    fontWeight: '800',
                    color: colors.text,
                    letterSpacing: -0.5,
                },
                sub: {
                    fontSize: 15,
                    color: colors.textSecondary,
                    marginBottom: 20,
                    marginTop: 2,
                },
                row: {
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 14,
                },
                grow: { flex: 1 },
                iconCircle: {
                    width: 44,
                    height: 44,
                    borderRadius: 22,
                    justifyContent: 'center',
                    alignItems: 'center',
                },
                bigValue: {
                    fontSize: 30,
                    fontWeight: '900',
                    color: colors.text,
                    letterSpacing: -1,
                },
                cardSub: {
                    fontSize: 14,
                    color: colors.textSecondary,
                    marginTop: 2,
                },
                statsGrid: {
                    flexDirection: 'row',
                },
                stat: {
                    flex: 1,
                    alignItems: 'center',
                },
                statValue: {
                    fontSize: 28,
                    fontWeight: '800',
                    color: colors.text,
                    letterSpacing: -0.5,
                },
                statLabel: {
                    fontSize: 13,
                    color: colors.textSecondary,
                    marginTop: 4,
                },
                cardTitle: {
                    fontSize: 16,
                    fontWeight: '700',
                    color: colors.text,
                    marginBottom: 4,
                },
                cardBody: {
                    fontSize: 15,
                    lineHeight: 22,
                    color: colors.textSecondary,
                },
                emphasis: {
                    color: colors.text,
                    fontWeight: '700',
                },
                footnote: {
                    fontSize: 12,
                    color: colors.textSecondary,
                    textAlign: 'center',
                    marginTop: 8,
                    paddingHorizontal: 16,
                    lineHeight: 18,
                    opacity: 0.8,
                },
            }),
        [colors]
    );
