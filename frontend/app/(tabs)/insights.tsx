import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
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
    WEEKLY_MOOD_AVERAGES,
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
import { aggregateDailyAverages } from '@/components/visualisations/transforms/dailyAverages';
import {
    buildMoodState,
    type MoodState,
} from '@/components/visualisations/transforms/moodState';
import {
    buildMoodDrivers,
    type MoodDriversData,
} from '@/components/visualisations/transforms/moodDrivers';
import MoodDriversCard from '@/components/visualisations/MoodDriversCard';
import SleepMoodCard from '@/components/visualisations/SleepMoodCard';
import HeartRateMoodCard from '@/components/visualisations/HeartRateMoodCard';
import {
    sleepMoodCorrelation,
    heartRateMoodCorrelation,
    type MetricMoodCorrelation,
} from '@/components/visualisations/transforms/healthMoodCorrelation';
import { getHealthMetricsRange } from '@/databases/health-metrics';
import { shouldShowHealthConnect } from '@/lib/healthConnectConfig';

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
    moodState: MoodState;
    drivers: MoodDriversData;
    // Health Connect (Android + feature-flag only). Cards render only when the
    // corresponding metric has any on-device data; the correlation itself gates
    // on MIN_PAIRS paired days internally.
    showHealth: boolean;
    hasSleepData: boolean;
    hasHeartRateData: boolean;
    sleepMood: MetricMoodCorrelation;
    heartRateMood: MetricMoodCorrelation;
};

/** Neutral correlation used before health data loads / when the feature is off. */
const EMPTY_CORRELATION: MetricMoodCorrelation = {
    status: 'notEnoughData',
    pairCount: 0,
    pairs: [],
};

const EMPTY_MOOD_STATE: MoodState = {
    state: 'building',
    trend: null,
    volatility: null,
    swing: null,
    slope: null,
    label: 'Keep logging to reveal your pattern',
    description: '',
};

const EMPTY_DRIVERS: MoodDriversData = {
    recoveryDrivers: [],
    stabilityAnchors: [],
    lowDayCount: 0,
    steadyDayCount: 0,
    hasRecoverySignal: false,
    hasStabilitySignal: false,
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
    moodState: EMPTY_MOOD_STATE,
    drivers: EMPTY_DRIVERS,
    showHealth: false,
    hasSleepData: false,
    hasHeartRateData: false,
    sleepMood: EMPTY_CORRELATION,
    heartRateMood: EMPTY_CORRELATION,
};

// expo-router screen-level error boundary: a render throw in Insights shows a
// recoverable "Try again" fallback instead of white-screening until restart.
// See components/ScreenErrorFallback.tsx.
export { ScreenErrorBoundary as ErrorBoundary } from '@/components/ScreenErrorFallback';

export default function InsightsScreen() {
    const colors = useThemeColors();
    const styles = useStyles(colors);
    const db = useSQLiteContext();
    const [data, setData] = useState<Insights | null>(null);

    // Sync loader returning a cleanup: the `active` flag (flipped on
    // blur/unmount by useDataRefresh) gates setData so a late all-time query
    // can't update an unmounted screen. Mirrors stats.tsx's guard.
    const load = useCallback(() => {
            let active = true;
            (async () => {
                try {
                    // All-time window: from the epoch up to the end of today (local).
                    const start = startOfLocalDay(new Date(0));
                    const end = endOfLocalDay(new Date());
                    const today = localDateString(new Date());
                    // Health Connect cards only exist on Android behind the flag;
                    // skip the read entirely elsewhere. Bounds are day-strings
                    // (health_metrics.date is a local 'YYYY-MM-DD'), a wide
                    // all-time span up to today.
                    const showHealth = shouldShowHealthConnect(Platform.OS);

                    const [
                        summary,
                        dowRawRows,
                        dateRows,
                        activityRawRows,
                        moodRawRows,
                        healthRows,
                    ] = await Promise.all([
                            db.getFirstAsync<{ avg_mood: number | null; entry_count: number }>(
                                WINDOW_SUMMARY,
                                [start, end]
                            ),
                            db.getAllAsync<DowInstantRow>(DOW_MOOD_PATTERN, [start, end]),
                            db.getAllAsync<{ date: string }>(RECENT_ENTRY_DATES, [start]),
                            db.getAllAsync<ActivityCorrelationRawRow>(
                                ACTIVITY_CORRELATION,
                                [start, end]
                            ),
                            db.getAllAsync<{ date: string; mood: number }>(
                                WEEKLY_MOOD_AVERAGES,
                                [start, end]
                            ),
                            showHealth
                                ? getHealthMetricsRange(db, '0000-01-01', today)
                                : Promise.resolve([]),
                        ]);
                    if (!active) return;

                    // All sources return RAW instants/rows; day-keying happens
                    // in JS (localDateString / aggregate*) — see queries.ts.
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

                    // 2-axis "how you've been" state over all recorded local days,
                    // and the state-conditioned forward-looking drivers (reusing
                    // the SAME raw activity rows already fetched above).
                    const dailyMoods = aggregateDailyAverages(moodRawRows);
                    const moodState = buildMoodState(dailyMoods);
                    const drivers = buildMoodDrivers(activityRawRows);

                    // Health↔mood correlations (Android only). Pair each health
                    // day (already local-day-keyed + wake-day-attributed) with
                    // that day's mood average — the join is a pure string-key
                    // match, never SQL day-bucketing. Cards render only when the
                    // metric has any data (below); the transform gates on MIN_PAIRS.
                    const hasSleepData = healthRows.some(
                        (r) => r.sleepTotalMinutes != null && r.sleepTotalMinutes > 0
                    );
                    const hasHeartRateData = healthRows.some(
                        (r) => r.avgHeartRate != null && r.avgHeartRate > 0
                    );

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
                        moodState,
                        drivers,
                        showHealth,
                        hasSleepData,
                        hasHeartRateData,
                        sleepMood: sleepMoodCorrelation(healthRows, dailyMoods),
                        heartRateMood: heartRateMoodCorrelation(healthRows, dailyMoods),
                    });
                } catch (e) {
                    console.error('Error building insights:', e);
                    if (active) setData(EMPTY);
                }
            })();
            return () => {
                active = false;
            };
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

            {/* How you've been — 2-axis mood state (only once classified) */}
            {d.moodState.state === 'classified' && (
                <Card>
                    <View style={styles.row}>
                        <View style={[styles.iconCircle, { backgroundColor: colors.accentLight }]}>
                            <Ionicons name="pulse-outline" size={20} color={colors.accent} />
                        </View>
                        <View style={styles.grow}>
                            <Text style={styles.cardTitle}>How you've been</Text>
                            <Text style={styles.cardBody}>{d.moodState.description}</Text>
                        </View>
                    </View>
                </Card>
            )}

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

            {/* State-conditioned, forward-looking drivers */}
            <MoodDriversCard data={d.drivers} />

            {/* Health Connect: sleep/heart-rate ↔ mood (Android + opt-in only).
                Each card renders only when that metric has on-device data, so
                Insights stays uncluttered for non-health users. */}
            {d.showHealth && d.hasSleepData && (
                <SleepMoodCard correlation={d.sleepMood} />
            )}
            {d.showHealth && d.hasHeartRateData && (
                <HeartRateMoodCard correlation={d.heartRateMood} />
            )}

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
