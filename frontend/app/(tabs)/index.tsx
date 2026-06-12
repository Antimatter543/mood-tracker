import { View, Text, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useThemeColors } from '@/styles/global';
import { Layout } from '../../components/PageContainer';
import { Card } from '@/components/Card';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState, memo, useMemo } from 'react';
import { LineChart } from 'react-native-chart-kit';
import { WEEKLY_MOOD_AVERAGES, MONTHLY_DAILY_AVERAGES, RECENT_ENTRY_DATES, TOTAL_ENTRIES } from '@/components/visualisations/queries';
import { CHART_PADDING, interpolateData, isWeekEmpty, SCREEN_WIDTH, useChartConfig } from '@/components/visualisations/chartUtils';
import { useDataRefresh } from '@/hooks/useDataRefresh';
import { startOfLocalDay, endOfLocalDay, localDateString } from '@/databases/dateHelpers';
import { dailyAverageMap, bestDayLocal } from '@/components/visualisations/transforms/dailyAverages';
import { currentStreak } from '@/components/visualisations/transforms/streak';


// Simple date formatting helper
// Update formatDate to handle invalid dates
const formatDate = (dateStr: string | null) => {
    if (!dateStr) return { full: '--', short: '--' };

    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return { full: '--', short: '--' };

    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const shortMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const longMonths = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

    return {
        full: `${days[date.getDay()]}, ${longMonths[date.getMonth()]} ${date.getDate()}`,
        short: `${shortMonths[date.getMonth()]} ${date.getDate()}`
    };
};

// Time-of-day greeting based on the local hour.
const greetingForHour = (hour: number): string => {
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
};

// Mood icon component — brand rule: no emoji as icons, use Ionicons sized + colored to theme.
function MoodIcon({ mood }: { mood: number | null }) {
    const colors = useThemeColors();
    if (mood === null) return null;

    const name: keyof typeof Ionicons.glyphMap =
        mood >= 8 ? 'happy' :
        mood >= 6 ? 'happy-outline' :
        mood >= 4 ? 'remove-circle-outline' :
        mood >= 2 ? 'sad-outline' :
                    'sad';

    return <Ionicons name={name} size={36} color={moodColor(mood, colors.accent)} style={{ marginLeft: 'auto' }} />;
}

/**
 * Mood-level to color mapping for the big mood number and icon.
 * High mood uses the theme accent (so it matches all 5 themes); mid/low keep
 * semantic amber(warn)/red(error) so a bad day always reads as a bad day.
 */
const moodColor = (mood: number | null, fallback: string): string => {
    if (mood === null) return fallback;
    if (mood >= 8) return fallback; // theme accent = positive
    if (mood >= 6) return fallback; // accent
    if (mood >= 4) return '#F9A825';
    if (mood >= 2) return '#FB8C00';
    return '#E57373';
};

// Today's Mood Card Component
const TodaysMoodCard = memo(function TodaysMoodCard({
    mood,
    streak
}: {
    mood: number | null;
    streak: number;
}) {
    const colors = useThemeColors();
    const styles = useThemedStyles(colors);

    return (
        <Card accentTop style={styles.heroCard}>
            <Text style={styles.heroDate}>
                {formatDate(new Date().toISOString()).full}
            </Text>
            <View style={styles.moodRow}>
                {mood !== null ? (
                    <Text style={[styles.moodValue, { color: moodColor(mood, colors.accent) }]}>
                        {mood.toFixed(1)}
                    </Text>
                ) : (
                    // No entry today: a 64px accent "--" reads as two solid green
                    // bars. Show a clear, muted empty state instead.
                    <Text style={styles.moodValueEmpty}>No entry yet</Text>
                )}
                <Text style={styles.moodLabel}>Today's Mood</Text>
                <MoodIcon mood={mood} />
            </View>
            {streak > 0 && (
                <View style={[styles.streakContainer, { backgroundColor: colors.accentLight }]}>
                    <Text style={styles.streakText}>
                        {streak} day streak
                    </Text>
                </View>
            )}
        </Card>
    );
});

// Weekly Chart Card Component
const WeeklyChartCard = memo(function WeeklyChartCard({ data }: { data: (number | null)[] }) {
    const colors = useThemeColors();
    const styles = useThemedStyles(colors);
    const chartConfig = useChartConfig();
    const chartWidth = SCREEN_WIDTH - (CHART_PADDING + 32);
    const weekEmpty = isWeekEmpty(data);

    // NOTE: all hooks must run on every render (Rules of Hooks). The empty-week
    // early return lives BELOW these `useMemo`s — never above them — so the hook
    // count stays constant whether or not the week has data. The interpolation
    // is cheap and harmless on an empty week (its result is simply unused).
    const { data: interpolatedData, nullIndices } = useMemo(() =>
        interpolateData(data.length > 0 ? data : [0, 0, 0, 0, 0, 0, 0])
        , [data]);

    const chartData = useMemo(() => {
        const getPast7Days = () => {
            const dates = [];
            for (let i = 6; i >= 0; i--) {
                const date = new Date();
                date.setDate(date.getDate() - i);
                dates.push(date.toISOString());
            }
            return dates;
        };
        const formatToDayName = (dateStr: string) =>
            new Date(dateStr).toLocaleDateString('en-US', { weekday: 'short' });

        return {
            labels: getPast7Days().map(formatToDayName),
            datasets: [{ data: interpolatedData, withDots: true }],
        };
    }, [interpolatedData]);

    // An empty week (no entries in the last 7 days) would otherwise render as a
    // flat zero line with red interpolated dots — it reads as an error. Show a
    // calm placeholder inside the same card instead.
    if (weekEmpty) {
        return (
            <Card>
                <View style={styles.weekEmpty}>
                    <Ionicons name="analytics-outline" size={32} color={colors.textSecondary} />
                    <Text style={styles.weekEmptyText}>
                        Log your mood to start seeing your week
                    </Text>
                </View>
                <Text style={styles.subtitle}>Past 7 days</Text>
            </Card>
        );
    }

    return (
        <Card>
            <View style={styles.chartContainer}>
                <LineChart
                    data={chartData}
                    width={chartWidth}
                    height={120}
                    chartConfig={chartConfig}
                    bezier
                    withInnerLines={false}
                    withOuterLines={false}
                    withHorizontalLabels={true}
                    withVerticalLabels={true}
                    withDots={true}
                    getDotColor={(value, index) => {
                        if (nullIndices.includes(index)) {
                            return '#e74c3c'; // Red for interpolated points
                        }
                        return colors.accent;
                    }}
                    fromZero={true}
                    yAxisInterval={2}
                    xLabelsOffset={-10}
                    yAxisSuffix=""
                    style={styles.chart}
                />
            </View>
            <Text style={styles.subtitle}>Past 7 days</Text>
        </Card>
    );
});

// Monthly Overview Card Component
const MonthlyOverviewCard = memo(function MonthlyOverviewCard({ stats }: {
    stats: {
        average: number;
        totalEntries: number;
        bestDay: string;
    }
}) {
    const colors = useThemeColors();
    const styles = useThemedStyles(colors);

    const displayAverage = stats.average !== null ? stats.average.toFixed(1) : '--';

    return (
        <Card>
            <Text style={styles.subtitle}>Last 30 days</Text>
            <View style={styles.statsGrid}>
                <View style={[styles.statItem, { backgroundColor: colors.accentLight }]}>
                    <Text style={styles.statLabel}>Average Mood</Text>
                    <Text style={styles.statValue}>{displayAverage}</Text>
                </View>
                <View style={[styles.statItem, { backgroundColor: colors.accentLight }]}>
                    <Text style={styles.statLabel}>Total Entries</Text>
                    <Text style={styles.statValue}>{stats.totalEntries}</Text>
                </View>
                <View style={[styles.statItem, { backgroundColor: colors.accentLight }]}>
                    <Text style={styles.statLabel}>Best Day</Text>
                    <Text style={styles.statValue}>{formatDate(stats.bestDay).short}</Text>
                </View>
            </View>
        </Card>
    );
});

// First-entry nudge — only shown on a brand-new (empty) database. Points the
// user at the floating "+" button. Intentionally a single tasteful card, not a
// multi-screen onboarding.
const FirstEntryNudge = memo(function FirstEntryNudge() {
    const colors = useThemeColors();
    const styles = useThemedStyles(colors);

    return (
        <Card>
            <View style={styles.nudgeCard}>
                <View style={styles.nudgeIcon}>
                    <Ionicons name="add" size={24} color={colors.accent} />
                </View>
                <Text style={styles.nudgeText}>
                    Tap the + button to log your first mood
                </Text>
            </View>
        </Card>
    );
});

// Recent Activities Card Component
const RecentActivitiesCard = memo(function RecentActivitiesCard({ activities }: { activities: string[] }) {
    const colors = useThemeColors();
    const styles = useThemedStyles(colors);

    return (
        <Card>
            <Text style={styles.subtitle}>Recent activities</Text>
            <View style={styles.activitiesContainer}>
                {activities.map((activity, index) => (
                    <View key={index} style={styles.activityTag}>
                        <Text style={styles.activityText}>{activity}</Text>
                    </View>
                ))}
            </View>
        </Card>
    );
});

// Themed styles hook
const useThemedStyles = (colors: any) => {
    return useMemo(() => StyleSheet.create({
        container: {
            width: '100%',
            gap: 8,
            flexGrow: 0,
        },
        greeting: {
            fontSize: 18,
            fontWeight: '600',
            color: colors.textSecondary,
            marginBottom: 12,
            marginLeft: 2,
        },
        subtitle: {
            fontSize: 12,
            fontWeight: '600',
            color: colors.textSecondary,
            marginBottom: 8,
            letterSpacing: 0.3,
        },
        heroCard: {
            marginBottom: 24,
        },
        heroDate: {
            fontSize: 13,
            fontWeight: '600',
            color: colors.textSecondary,
            marginBottom: 8,
        },
        moodRow: {
            flexDirection: 'row',
            alignItems: 'baseline',
            gap: 8,
        },
        moodValue: {
            fontSize: 64,
            fontWeight: '900',
            color: colors.accent,
            letterSpacing: -2,
        },
        moodValueEmpty: {
            fontSize: 22,
            fontWeight: '600',
            color: colors.textSecondary,
            letterSpacing: 0,
        },
        moodLabel: {
            fontSize: 16,
            color: colors.textSecondary,
        },
        chartContainer: {
            alignItems: 'center',
            width: '100%',
        },
        // Calm in-card placeholder shown when the week has no entries (replaces
        // the red-dotted flat line). Matches the chart's ~120px height so the
        // card doesn't jump when the first entry lands.
        weekEmpty: {
            height: 120,
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
        },
        weekEmptyText: {
            fontSize: 14,
            color: colors.textSecondary,
            textAlign: 'center',
        },
        // First-entry nudge: a gentle row pointing the new user at the FAB.
        nudgeCard: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
        },
        nudgeIcon: {
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: colors.accentLight,
            alignItems: 'center',
            justifyContent: 'center',
        },
        nudgeText: {
            flex: 1,
            fontSize: 15,
            color: colors.text,
            fontWeight: '500',
        },
        chart: {
            borderRadius: 16,
            paddingRight: 0,
        },
        statsGrid: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            gap: 8,
        },
        statItem: {
            alignItems: 'flex-start',
            flex: 1,
            paddingVertical: 10,
            paddingHorizontal: 12,
            borderRadius: 16,
        },
        statLabel: {
            fontSize: 12,
            color: colors.textSecondary,
            marginBottom: 4,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
        },
        statValue: {
            fontSize: 24,
            fontWeight: '800',
            color: colors.text,
            letterSpacing: -0.5,
        },
        activitiesContainer: {
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 8,
        },
        activityTag: {
            backgroundColor: colors.overlays.tag,
            paddingHorizontal: 12,
            paddingVertical: 6,
            borderRadius: 16,
        },
        activityText: {
            color: colors.text,
            fontSize: 14,
        },
        streakContainer: {
            marginTop: 10,
            paddingVertical: 6,
            paddingHorizontal: 14,
            borderRadius: 12,
            alignSelf: 'flex-start',
        },
        streakText: {
            color: colors.accent,
            fontSize: 14,
            fontWeight: '600',
        },
    }), [colors]);
};

export default function Home() {
    const colors = useThemeColors();
    const styles = useThemedStyles(colors);
    const db = useSQLiteContext();
    const [todaysMood, setTodaysMood] = useState<number | null>(null);
    const [monthlyStats, setMonthlyStats] = useState({
        average: 0,
        totalEntries: 0,
        bestDay: ''
    });
    const [recentActivities, setRecentActivities] = useState<string[]>([]);
    const [weeklyData, setWeeklyData] = useState<(number | null)[]>([]);
    const [streak, setStreak] = useState<number>(0);
    // All-time entry count — drives the brand-new-user first-entry nudge.
    const [totalEntries, setTotalEntries] = useState<number>(0);

    const fetchData = useCallback(async () => {
            try {
                // All windows are computed in the user's local timezone and
                // passed to SQL as UTC ISO bounds. Storing entries as UTC ISO
                // + comparing in UTC ISO keeps things consistent; SQLite's
                // `date('now')` (UTC) is no longer involved.
                const now = new Date();
                const DAY_MS = 86_400_000;
                const todayLocal = localDateString(now);
                const todayStart = startOfLocalDay(now);
                const todayEnd = endOfLocalDay(now);
                const weekStart = startOfLocalDay(new Date(now.getTime() - 7 * DAY_MS));
                const monthStart = startOfLocalDay(new Date(now.getTime() - 30 * DAY_MS));
                const streakWindowStart = startOfLocalDay(new Date(now.getTime() - 60 * DAY_MS));

                const [
                    today,
                    monthRows,
                    activities,
                    weeklyRows,
                    streakEntryRows,
                    totals,
                ] = await Promise.all([
                    db.getFirstAsync<{ mood: number }>(
                        `SELECT ROUND(AVG(mood), 1) as mood FROM entries WHERE date BETWEEN ? AND ?`,
                        [todayStart, todayEnd]
                    ),

                    // Raw {date: instant, mood} rows; average/count/bestDay are
                    // computed in JS so "best day" is the right LOCAL day (the
                    // old inline SQL keyed it with UTC date(date)).
                    db.getAllAsync<{ date: string; mood: number }>(
                        MONTHLY_DAILY_AVERAGES,
                        [monthStart, todayEnd]
                    ),

                    db.getAllAsync<{ name: string; count: number }>(
                        `
                        SELECT a.name, COUNT(*) as count
                        FROM activities a
                        JOIN entry_activities ea ON ea.activity_id = a.id
                        JOIN entries e ON e.id = ea.entry_id
                        WHERE e.date BETWEEN ? AND ?
                        GROUP BY a.name
                        ORDER BY count DESC
                        LIMIT 7
                        `,
                        [weekStart, todayEnd]
                    ),

                    db.getAllAsync<{ date: string; mood: number }>(
                        WEEKLY_MOOD_AVERAGES,
                        [weekStart, todayEnd]
                    ),

                    db.getAllAsync<{ date: string }>(
                        RECENT_ENTRY_DATES,
                        [streakWindowStart]
                    ),

                    db.getFirstAsync<{ count: number }>(TOTAL_ENTRIES),
                ]);

                setTodaysMood(today?.mood || null);
                setTotalEntries(totals?.count ?? 0);

                // Last-30-days stats. average = mean over all entries in the
                // window (1 dp), totalEntries = entry count, bestDay = local day
                // with the highest daily average — all derived in JS.
                if (monthRows.length > 0) {
                    const sum = monthRows.reduce((s, r) => s + r.mood, 0);
                    setMonthlyStats({
                        average: Math.round((sum / monthRows.length) * 10) / 10,
                        totalEntries: monthRows.length,
                        bestDay: bestDayLocal(monthRows),
                    });
                } else {
                    setMonthlyStats({ average: 0, totalEntries: 0, bestDay: '' });
                }

                setRecentActivities(activities.map(a => a.name));

                // Fill in the 7-day window (last 6 days + today, earliest first)
                // with null for days that had no entries — same shape (and count)
                // the chart's 7 labels expect. Keys are local days from
                // aggregateDailyAverages, so they match the local-day labels we
                // build below by construction.
                const weeklyByDay = dailyAverageMap(weeklyRows);
                const weekly: (number | null)[] = [];
                for (let i = 6; i >= 0; i--) {
                    const dStr = localDateString(new Date(now.getTime() - i * DAY_MS));
                    weekly.push(weeklyByDay.get(dStr) ?? null);
                }
                setWeeklyData(weekly);

                // Map raw instants -> local day strings before the streak; the
                // streak transform de-dupes internally so mapping alone is fine.
                setStreak(currentStreak(streakEntryRows.map(r => localDateString(r.date)), todayLocal));
            } catch (error) {
                console.error('Error fetching dashboard data:', error);
            }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- queries read only db; setState identities are stable
        }, [db]);
    // Focus-aware refetch (replaces useEffect([db, refreshCount])): the Home
    // dashboard always reflects the latest data when the tab regains focus
    // (e.g. after adding an entry), and live-updates while focused.
    useDataRefresh(fetchData, [db]);

    return (
        <Layout>
            <View style={styles.container}>
                <Text style={styles.greeting}>{greetingForHour(new Date().getHours())}</Text>
                <TodaysMoodCard mood={todaysMood} streak={streak} />
                <WeeklyChartCard data={weeklyData} />
                {totalEntries === 0 && <FirstEntryNudge />}
                <MonthlyOverviewCard stats={monthlyStats} />
                <RecentActivitiesCard activities={recentActivities} />
            </View>
        </Layout>
    );
}