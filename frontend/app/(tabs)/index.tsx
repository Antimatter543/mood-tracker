import { View, Text, StyleSheet } from 'react-native';
import { useGlobalStyles, useThemeColors } from '@/styles/global';
import { Layout } from '../../components/PageContainer';
import { Card } from '@/components/Card';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState, memo, useMemo } from 'react';
import { LineChart } from 'react-native-chart-kit';
import { GET_CURRENT_STREAK, WEEKLY_MOOD_AVERAGES_NULLED } from '@/components/visualisations/queries';
import { CHART_PADDING, interpolateData, SCREEN_WIDTH, useChartConfig } from '@/components/visualisations/chartUtils';
import { useDataContext } from '@/context/DataContext';


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

// Mood icon component
function MoodIcon({ mood }: { mood: number | null }) {
    const colors = useThemeColors();
    // Since this is a very simple component, we can just define styles inline
    // or use StyleSheet.create without useMemo
    const styles = StyleSheet.create({
        moodIcon: {
            fontSize: 32,
            marginLeft: 'auto',
        }
    });

    if (mood === null) return null;

    const getMoodIcon = (mood: number) => {
        if (mood >= 8) return "😄";  // Very happy
        if (mood >= 6) return "🙂";  // Happy
        if (mood >= 4) return "😐";  // Neutral
        if (mood >= 2) return "🙁";  // Sad
        return "😢";                 // Very sad
    };

    return (
        <Text style={styles.moodIcon}>
            {getMoodIcon(mood)}
        </Text>
    );
}

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

    const displayMood = mood !== null ? mood.toFixed(1) : '--';

    return (
        <Card>
            <Text style={styles.cardTitle}>
                {formatDate(new Date().toISOString()).full}
            </Text>
            <View style={styles.moodRow}>
                <Text style={styles.moodValue}>{displayMood}</Text>
                <Text style={styles.moodLabel}>Today's Mood</Text>
                <MoodIcon mood={mood} />
            </View>
            {streak > 0 && (
                <View style={styles.streakContainer}>
                    <Text style={styles.streakText}>
                        {streak} day streak 🔥
                    </Text>
                </View>
            )}
            {/* <Text style={styles.lastUpdated}>Last updated 2h ago</Text> */}
        </Card>
    );
});

// Weekly Chart Card Component
const WeeklyChartCard = memo(function WeeklyChartCard({ data }: { data: (number | null)[] }) {
    const colors = useThemeColors();
    const styles = useThemedStyles(colors);
    const chartConfig = useChartConfig();
    const chartWidth = SCREEN_WIDTH - (CHART_PADDING + 32);

    const getPast7Days = () => {
        const dates = [];
        for (let i = 6; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            dates.push(date.toISOString());
        }
        return dates;
    };

    const formatToDayName = (dateStr: string) => {
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', { weekday: 'short' });
    };

    // Process data with interpolation
    const { data: interpolatedData, nullIndices } = useMemo(() =>
        interpolateData(data.length > 0 ? data : [0, 0, 0, 0, 0, 0, 0])
        , [data]);
    console.log(interpolatedData);

    const chartData = useMemo(() => ({
        labels: getPast7Days().map(date => formatToDayName(date)),
        datasets: [{
            data: interpolatedData,
            withDots: true
        }]
    }), [interpolatedData]);

    return (
        <Card>
            <Text style={styles.cardTitle}>This Week</Text>
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
                    style={[styles.chart]}
                />
            </View>
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
            <Text style={styles.cardTitle}>Monthly Overview</Text>
            <View style={styles.statsGrid}>
                <View style={styles.statItem}>
                    <Text style={styles.statLabel}>Average Mood</Text>
                    <Text style={styles.statValue}>{displayAverage}</Text>
                </View>
                <View style={styles.statItem}>
                    <Text style={styles.statLabel}>Total Entries</Text>
                    <Text style={styles.statValue}>{stats.totalEntries}</Text>
                </View>
                <View style={styles.statItem}>
                    <Text style={styles.statLabel}>Best Day</Text>
                    <Text style={styles.statValue}>{formatDate(stats.bestDay).short}</Text>
                </View>
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
            <Text style={styles.cardTitle}>Recent Activities</Text>
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
        cardTitle: {
            fontSize: 18,
            fontWeight: '600',
            color: colors.text,
            marginBottom: 16,
        },
        moodRow: {
            flexDirection: 'row',
            alignItems: 'baseline',
            gap: 8,
        },
        moodValue: {
            fontSize: 32,
            fontWeight: 'bold',
            color: colors.accent,  // Use the accent color for mood
        },
        moodLabel: {
            fontSize: 16,
            color: colors.textSecondary,  // More subtle text color
        },
        lastUpdated: {
            fontSize: 12,
            color: colors.textSecondary,
            marginTop: 8,
        },
        chartContainer: {
            alignItems: 'center',
            width: '100%',
        },
        chart: {
            borderRadius: 16,
            paddingRight: 0,
        },
        statsGrid: {
            flexDirection: 'row',
            justifyContent: 'space-between',
        },
        statItem: {
            alignItems: 'flex-start',
        },
        statLabel: {
            fontSize: 14,
            color: colors.textSecondary,
            marginBottom: 4,
        },
        statValue: {
            fontSize: 18,
            fontWeight: 'bold',
            color: colors.text,
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
            marginTop: 8,
            paddingVertical: 4,
            paddingHorizontal: 12,
            backgroundColor: colors.overlays.tag,
            borderRadius: 12,
            alignSelf: 'flex-start',
        },
        streakText: {
            color: colors.text,
            fontSize: 14,
            fontWeight: '500',
        },
    }), [colors]);
};

export default function Home() {
    const colors = useThemeColors();
    const styles = useThemedStyles(colors);
    const globalStyle = useGlobalStyles(colors);
    const db = useSQLiteContext();
    const { refreshCount } = useDataContext();
    const [todaysMood, setTodaysMood] = useState<number | null>(null);
    const [monthlyStats, setMonthlyStats] = useState({
        average: 0,
        totalEntries: 0,
        bestDay: ''
    });
    const [recentActivities, setRecentActivities] = useState<string[]>([]);
    const [weeklyData, setWeeklyData] = useState<(number | null)[]>([]);
    const [streak, setStreak] = useState<number>(0);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const [today, monthStats, activities, weeklyMoods, currentStreak] = await Promise.all([
                    // Today's mood
                    db.getFirstAsync<{ mood: number }>(`
                    SELECT ROUND(AVG(mood), 1) as mood 
                    FROM entries 
                    WHERE date(date) = date('now')
                    `),

                    // Monthly stats
                    db.getFirstAsync<{
                        average: number,
                        count: number,
                        bestDay: string
                    }>(`
                    WITH DailyAverages AS (
                    SELECT 
                        date(date) as day,
                        ROUND(AVG(mood), 1) as daily_avg
                    FROM entries
                    WHERE date >= date('now', '-30 days')
                    GROUP BY date(date)
                    )
                    SELECT
                    ROUND(AVG(mood), 1) as average,
                    COUNT(*) as count,
                    (
                        SELECT day
                        FROM DailyAverages
                        WHERE daily_avg = (SELECT MAX(daily_avg) FROM DailyAverages)
                        LIMIT 1
                    ) as bestDay
                    FROM entries
                    WHERE date >= date('now', '-30 days')
                  `),

                    // Recent activities
                    db.getAllAsync<{ name: string, count: number }>(`
                    SELECT 
                    a.name,
                    COUNT(*) as count
                    FROM activities a
                    JOIN entry_activities ea ON ea.activity_id = a.id
                    JOIN entries e ON e.id = ea.entry_id
                    WHERE e.date >= date('now', '-7 days')
                    GROUP BY a.name
                    ORDER BY count DESC
                    LIMIT 7
                    `),

                    // Weekly mood data
                    db.getAllAsync<{ avgMood: number | null }>(WEEKLY_MOOD_AVERAGES_NULLED),

                    // Add streak query
                    db.getFirstAsync<{ streak: number }>(GET_CURRENT_STREAK)

                ]);

                setTodaysMood(today?.mood || null);

                if (monthStats) {
                    setMonthlyStats({
                        average: monthStats.average,
                        totalEntries: monthStats.count,
                        bestDay: monthStats.bestDay
                    });
                }

                setRecentActivities(activities.map(a => `${a.name} (${a.count}) `));
                setWeeklyData(weeklyMoods.map(row => row.avgMood));

                setStreak(currentStreak?.streak || 0);

                console.log("Loaded entry heyo!!!")
                if (__DEV__) {
                    console.log("APPARENTLY THIS ONLY SHOWS IN DEV MODE")
                }
            } catch (error) {
                console.error('Error fetching data:', error);
            }
        };

        fetchData();
    }, [db, refreshCount]);

    return (
        <Layout>
            {/* <View style={globalStyle.header}>
                <Feather name="home" color={colors.text} size={24} />
                <Text style={globalStyle.headerText}>Home Page</Text>
            </View> */}

            <View style={styles.container}>
                <TodaysMoodCard mood={todaysMood} streak={streak} />
                <WeeklyChartCard data={weeklyData} />
                {/* <BasicLineChart /> */}
                <MonthlyOverviewCard stats={monthlyStats} />
                <RecentActivitiesCard activities={recentActivities} />
            </View>
        </Layout>
    );
}