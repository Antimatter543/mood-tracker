import React, { useState, useMemo, useCallback } from "react";
import { Text, StyleSheet } from "react-native";
import { LineChart } from "react-native-chart-kit";
import { useThemeColors } from "@/styles/global";
import { useSQLiteContext } from "expo-sqlite";
import { CHART_PADDING, SCREEN_WIDTH, useChartConfig } from "./chartUtils";
import { useDataRefresh } from "@/hooks/useDataRefresh";
import InfoBubble from "../InfoBubble";
import { Card } from "../Card";
import { useTimeframe } from "@/context/TimeframeContext";
import {
    buildWeeklyMoodChartData,
    formatLabel,
    type MoodAvgRow,
    type Timeframe,
} from "./transforms/weeklyMood";
import { dailyAverageRows } from "./transforms/dailyAverages";
import { WEEKLY_MOOD_AVERAGES } from "./queries";
import {
    startOfLocalDay,
    endOfLocalDay,
    addDays,
    localDateString,
} from "./transforms/dateHelpers";

/**
 * Returns the local-time window (start, end) covering the timeframe relative
 * to the user's local "now". Replaces the UTC-anchored SQL `date('now')`.
 */
const computeWindow = (timeframe: Timeframe): { start: string; end: string } => {
    const today = localDateString(new Date());
    const end = endOfLocalDay(today);

    switch (timeframe) {
        case 'week':
            return { start: startOfLocalDay(addDays(today, -7)), end };
        case 'month':
            return { start: startOfLocalDay(addDays(today, -30)), end };
        case '3months':
            return { start: startOfLocalDay(addDays(today, -90)), end };
        case 'year':
            return { start: startOfLocalDay(addDays(today, -365)), end };
        case 'alltime':
            // Effectively unbounded — pick a far-past anchor.
            return { start: '1970-01-01 00:00:00', end };
        default:
            return { start: startOfLocalDay(addDays(today, -7)), end };
    }
};


export function BasicLineChart() {
    const colors = useThemeColors();
    const chartConfig = useChartConfig();
    const chartWidth = SCREEN_WIDTH - (CHART_PADDING + 32);

    const db = useSQLiteContext();
    const { timeframe, timeframeDescription } = useTimeframe();

    const [chartData, setChartData] = useState<{
        labels: string[];
        datasets: { data: number[]; withDots: boolean; }[];
    } | null>(null);
    const [nullIndices, setNullIndices] = useState<number[]>([]);
    const [loading, setLoading] = useState(true);

    // Stable label formatter — captures only `timeframe`, so it's safe in deps.
    const formatDateLabel = useCallback(
        (dateStr: string, index: number, totalPoints: number) =>
            formatLabel(dateStr, index, totalPoints, timeframe as Timeframe),
        [timeframe],
    );

    // Dynamic chart title based on timeframe
    const getChartTitle = () => {
        switch(timeframe) {
            case 'week':
                return "Weekly Mood Average";
            case 'month':
                return "Monthly Mood Trend";
            case '3months':
                return "Quarterly Mood Trend";
            case 'year':
                return "Yearly Mood Trend";
            case 'alltime':
                return "All-Time Mood Trend";
            default:
                return "Mood Trend";
        }
    };

    const styles = useMemo(() => StyleSheet.create({
        title: {
            fontSize: 18,
            fontWeight: '600',
            marginBottom: 16,
            color: colors.text,
        },
        chart: {
            marginVertical: 8,
            borderRadius: 16,
        },
        loadingText: {
            color: colors.textSecondary,
            textAlign: 'center',
            padding: 20,
        },
        noDataText: {
            color: colors.textSecondary,
            textAlign: 'center',
            padding: 20,
        }
    }), [colors]);

    const fetchData = useCallback(async () => {
            setLoading(true);
            try {
                const { start, end } = computeWindow(timeframe as Timeframe);
                // Raw {date: instant, mood} rows -> per-LOCAL-day averages in JS.
                const rawRows = await db.getAllAsync<{ date: string; mood: number }>(
                    WEEKLY_MOOD_AVERAGES,
                    [start, end],
                );
                const rows: MoodAvgRow[] = dailyAverageRows(rawRows);

                const built = buildWeeklyMoodChartData(rows, timeframe as Timeframe);
                if (built.isEmpty) {
                    setChartData(null);
                    setLoading(false);
                    return;
                }

                // Apply timeframe-aware label override (formatLabel inside the
                // transform handles week/month/3months/year/alltime). The
                // transform calls the inline formatter with no closure leak.
                const labels = rows.map((r, i) =>
                    formatDateLabel(r.date, i, rows.length),
                );

                setNullIndices(built.nullIndices);
                setChartData({
                    labels,
                    datasets: [
                        { data: built.data, withDots: true },
                        { data: [10], withDots: false },
                        { data: [0], withDots: false },
                    ],
                });
            } catch (error) {
                console.error('Error fetching mood data:', error);
                setChartData(null);
            }
            setLoading(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- query reads db + timeframe; formatDateLabel is stable; setState identities are stable
        }, [db, timeframe, formatDateLabel]);
    // Focus-aware refetch (replaces useEffect([db, refreshCount, timeframe, formatDateLabel])).
    useDataRefresh(fetchData, [db, timeframe, formatDateLabel]);

    // Get timeframe description for the chart
    const getTimerangeDescription = () => {
        switch(timeframe) {
            case 'week':
                return "past 7 days";
            case 'month':
                return "past 30 days";
            case '3months':
                return "past 3 months";
            case 'year':
                return "past year";
            case 'alltime':
                return "all time";
            default:
                return timeframeDescription.toLowerCase();
        }
    };

    if (loading) {
        return (
            <Card>
                <Text style={styles.title}>{getChartTitle()}</Text>
                <Text style={styles.loadingText}>Loading data...</Text>
            </Card>
        );
    }

    if (!chartData) {
        return (
            <Card>
                <Text style={styles.title}>{getChartTitle()}</Text>
                <Text style={styles.noDataText}>No data available for this time period.</Text>
            </Card>
        );
    }

    return (
        <Card>
            <InfoBubble
                text={`Shows your average mood over the ${getTimerangeDescription()}. The green line tracks your mood changes, helping you spot trends and patterns.`}
                position="top-right"
            />
            <Text style={styles.title}>{getChartTitle()}</Text>
            <LineChart
                data={chartData}
                width={chartWidth}
                height={220}
                yAxisLabel=""
                yAxisSuffix=""
                yAxisInterval={2}
                segments={5}
                withVerticalLines={false}
                withDots={true}
                getDotColor={(_dataPoint, index) => {
                    if (nullIndices.includes(index)) {
                        return '#e74c3c';  // Soft red for missing data
                    }
                    return colors.accent;
                }}
                chartConfig={{
                    ...chartConfig,
                    strokeWidth: 2,
                }}
                bezier
                fromZero
                style={styles.chart}
            />
        </Card>
    );
}
