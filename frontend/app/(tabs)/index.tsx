import { View, Text, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Feather from '@expo/vector-icons/Feather';
import { useThemeColors, ThemeColors } from '@/styles/global';
import { Layout } from '../../components/PageContainer';
import { Card } from '@/components/Card';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState, memo, useMemo } from 'react';
import { WEEKLY_MOOD_AVERAGES, MONTHLY_DAILY_AVERAGES, RECENT_ENTRY_DATES, TOTAL_ENTRIES } from '@/components/visualisations/queries';
import { isWeekEmpty } from '@/components/visualisations/chartUtils';
import { MoodWeekChart } from '@/components/visualisations/MoodWeekChart';
import { StatTile } from '@/components/StatTile';
import { ActivityIcon } from '@/components/activityIcon';
import { useDataRefresh } from '@/hooks/useDataRefresh';
import { startOfLocalDay, endOfLocalDay, localDateString } from '@/databases/dateHelpers';
import { dailyAverageMap, bestDayLocal } from '@/components/visualisations/transforms/dailyAverages';
import { currentStreak } from '@/components/visualisations/transforms/streak';

/** A top-activity row for the "Recent activities" card — name + its real icon. */
type RecentActivity = {
    name: string;
    icon_name: string;
    icon_family: string;
};


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
                // De-bubbled: an inline zap icon + text in the accent color,
                // matching the Overview streak-tile language (no background pill).
                <View style={styles.streakRow}>
                    <Feather name="zap" size={14} color={colors.accent} />
                    <Text style={styles.streakText}>
                        {streak} day{streak === 1 ? '' : 's'} streak
                    </Text>
                </View>
            )}
        </Card>
    );
});

// Weekly Chart Card Component — our own systematic SVG chart (MoodWeekChart),
// replacing react-native-chart-kit's LineChart on Home.
const WeeklyChartCard = memo(function WeeklyChartCard({ data }: { data: (number | null)[] }) {
    const colors = useThemeColors();
    const styles = useThemedStyles(colors);

    // The last 7 LOCAL day-name labels (oldest first), aligned to the 7 data
    // slots `fetchData` produced (today + the prior 6, earliest first).
    // NOTE (Rules of Hooks, lessons.md 2026-06-08): this hook runs on EVERY
    // render — the empty-week early return below sits BELOW it so the hook count
    // is constant whether or not the week has data.
    const labels = useMemo(() => {
        const out: string[] = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            out.push(d.toLocaleDateString('en-US', { weekday: 'short' }));
        }
        return out;
    }, []);

    // An empty week (no entries in the last 7 days) would render as a flat line
    // with nothing to plot — show the same calm placeholder inside the card.
    if (isWeekEmpty(data)) {
        return (
            <Card>
                <Text style={styles.cardTitle}>Past 7 days</Text>
                <View style={styles.weekEmpty}>
                    <Ionicons name="analytics-outline" size={32} color={colors.textSecondary} />
                    <Text style={styles.weekEmptyText}>
                        Log your mood to start seeing your week
                    </Text>
                </View>
            </Card>
        );
    }

    return (
        <Card>
            <Text style={styles.cardTitle}>Past 7 days</Text>
            <MoodWeekChart data={data} labels={labels} height={130} />
        </Card>
    );
});

// Monthly Overview Card Component — the "Overview" idiom (open StatTiles, no
// box-inside-box). Three stats in the proven 2x2 grid (Avg / Total / Best Day),
// the fourth cell intentionally empty.
const MonthlyOverviewCard = memo(function MonthlyOverviewCard({ stats }: {
    stats: {
        average: number;
        totalEntries: number;
        bestDay: string;
    }
}) {
    const styles = useThemedStyles(useThemeColors());

    const displayAverage = stats.average ? `${stats.average.toFixed(1)} / 10` : '-- / 10';
    const bestDay = stats.bestDay ? formatDate(stats.bestDay).short : '--';

    const tiles: {
        icon: React.ComponentProps<typeof Feather>['name'];
        value: string;
        label: string;
    }[] = [
        { icon: 'activity', value: displayAverage, label: 'Average mood' },
        { icon: 'edit-3', value: `${stats.totalEntries}`, label: 'Total entries' },
        { icon: 'award', value: bestDay, label: 'Best day' },
    ];

    return (
        <Card>
            <Text style={styles.cardTitle}>Last 30 days</Text>
            <View style={styles.tileGrid}>
                {tiles.map((tile) => (
                    <View key={tile.label} style={styles.tileCell}>
                        <StatTile icon={tile.icon} value={tile.value} label={tile.label} />
                    </View>
                ))}
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

// Recent Activities Card Component — de-bubbled: each activity is an icon (in a
// small accent chip, matching the Overview tile chips) + its name, wrapping. The
// real icon is rendered via the shared ActivityIcon mapping (icon_name +
// icon_family come from the extended top-activities query).
const RecentActivitiesCard = memo(function RecentActivitiesCard({ activities }: { activities: RecentActivity[] }) {
    const colors = useThemeColors();
    const styles = useThemedStyles(colors);

    if (activities.length === 0) return null;

    return (
        <Card>
            <Text style={styles.cardTitle}>Recent activities</Text>
            <View style={styles.activitiesContainer}>
                {activities.map((activity, index) => (
                    <View key={`${activity.name}-${index}`} style={styles.activityUnit}>
                        <View style={styles.activityChip}>
                            <ActivityIcon
                                iconName={activity.icon_name}
                                iconFamily={activity.icon_family}
                                color={colors.accent}
                                size={15}
                            />
                        </View>
                        <Text style={styles.activityText} numberOfLines={1}>
                            {activity.name}
                        </Text>
                    </View>
                ))}
            </View>
        </Card>
    );
});

// Themed styles hook
const useThemedStyles = (colors: ThemeColors) => {
    return useMemo(() => StyleSheet.create({
        container: {
            width: '100%',
            gap: 8,
            flexGrow: 0,
        },
        greeting: {
            fontSize: 26,
            fontWeight: '700',
            color: colors.text,
            letterSpacing: -0.5,
            marginBottom: 16,
            marginLeft: 2,
        },
        // The ONE section-title convention: sits ABOVE the card's content (the
        // Overview card's "title" style). Replaces the old `subtitle` that was
        // used inconsistently above AND below content.
        cardTitle: {
            fontSize: 18,
            fontWeight: '600',
            color: colors.text,
            marginBottom: 16,
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
        // De-bubbled streak: inline zap icon + accent text, no background pill.
        streakRow: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            marginTop: 12,
        },
        streakText: {
            color: colors.accent,
            fontSize: 14,
            fontWeight: '600',
        },
        // Calm in-card placeholder shown when the week has no entries. ~130px to
        // match the chart height so the card doesn't jump when the first entry lands.
        weekEmpty: {
            height: 130,
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
        // Overview 2x2 tile grid (mirrors StatSummaryCard) — open StatTiles, no
        // box-inside-box. Each cell is 50% width; the StatTile fills it.
        tileGrid: {
            flexDirection: 'row',
            flexWrap: 'wrap',
        },
        tileCell: {
            width: '50%',
            paddingVertical: 12,
            paddingHorizontal: 4,
        },
        // Recent activities: wrapping [icon-chip + name] units, no pill bubbles.
        activitiesContainer: {
            flexDirection: 'row',
            flexWrap: 'wrap',
            rowGap: 14,
            columnGap: 16,
        },
        activityUnit: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
        },
        activityChip: {
            width: 30,
            height: 30,
            borderRadius: 15,
            backgroundColor: colors.accentLight,
            alignItems: 'center',
            justifyContent: 'center',
        },
        activityText: {
            color: colors.text,
            fontSize: 14,
            fontWeight: '500',
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
    const [recentActivities, setRecentActivities] = useState<RecentActivity[]>([]);
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

                    db.getAllAsync<{
                        name: string;
                        icon_name: string;
                        icon_family: string;
                        count: number;
                    }>(
                        `
                        SELECT a.name, a.icon_name, a.icon_family, COUNT(*) as count
                        FROM activities a
                        JOIN entry_activities ea ON ea.activity_id = a.id
                        JOIN entries e ON e.id = ea.entry_id
                        WHERE e.date BETWEEN ? AND ?
                        GROUP BY a.id
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

                setRecentActivities(
                    activities.map((a) => ({
                        name: a.name,
                        icon_name: a.icon_name,
                        icon_family: a.icon_family,
                    }))
                );

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