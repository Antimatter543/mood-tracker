import React, { useEffect, useState, useMemo } from "react";
import { Text, StyleSheet } from "react-native";
import { LineChart } from "react-native-chart-kit";
import { useThemeColors } from "@/styles/global";
import { useSQLiteContext } from "expo-sqlite";
import { CHART_PADDING, formatDayLabel, SCREEN_WIDTH, useChartConfig } from "./chartUtils";
import { useDataContext } from "@/context/DataContext";
import { interpolateData } from "./chartUtils";
import InfoBubble from "../InfoBubble";
import { Card } from "../Card";
import { useTimeframe } from "@/context/TimeframeContext";

type MoodDataPoint = {
    avgMood: number | null;
    date: string;
};

export function BasicLineChart() {
    const colors = useThemeColors();
    const chartConfig = useChartConfig();
    const chartWidth = SCREEN_WIDTH - (CHART_PADDING + 32);

    const db = useSQLiteContext();
    const { refreshCount } = useDataContext();
    const { timeframe, timeframeCondition, timeframeDescription } = useTimeframe();
    
    const [chartData, setChartData] = useState<{
        labels: string[];
        datasets: { data: number[]; withDots: boolean; }[];
    } | null>(null);
    const [nullIndices, setNullIndices] = useState<number[]>([]);
    const [loading, setLoading] = useState(true);

    // Determine the grouping and limits based on timeframe
    const getDataQuery = () => {
        switch(timeframe) {
            case 'week':
                return `
                    WITH RECURSIVE dates(date) AS (
                        SELECT date('now', '-7 days')
                        UNION ALL
                        SELECT date(date, '+1 day')
                        FROM dates
                        WHERE date < date('now')
                    )
                    SELECT 
                        dates.date,
                        ROUND(AVG(entries.mood), 1) as avgMood
                    FROM dates 
                    LEFT JOIN entries ON date(entries.date) = dates.date
                    GROUP BY dates.date
                    ORDER BY dates.date
                `;
            case 'month':
                return `
                    WITH 
                    month_dates AS (
                        SELECT 
                            date('now', '-30 days') as start_date,
                            date('now') as end_date
                    ),
                    weeks AS (
                        SELECT 0 as week_num, date(start_date) as week_start FROM month_dates
                        UNION ALL
                        SELECT 1 as week_num, date(start_date, '+7 days') as week_start FROM month_dates
                        UNION ALL
                        SELECT 2 as week_num, date(start_date, '+14 days') as week_start FROM month_dates
                        UNION ALL
                        SELECT 3 as week_num, date(start_date, '+21 days') as week_start FROM month_dates
                    )
                    SELECT 
                        weeks.week_start as date,
                        ROUND(AVG(entries.mood), 1) as avgMood
                    FROM weeks 
                    LEFT JOIN entries ON 
                        date(entries.date) >= date(weeks.week_start) AND 
                        date(entries.date) < date(weeks.week_start, '+7 days') AND
                        date(entries.date) <= (SELECT end_date FROM month_dates)
                    GROUP BY weeks.week_num
                    ORDER BY weeks.week_start
                `;
            case '3months':
                return `
                    WITH RECURSIVE dates(date) AS (
                        SELECT date('now', '-90 days')
                        UNION ALL
                        SELECT date(date, '+5 days')
                        FROM dates
                        WHERE date < date('now')
                    )
                    SELECT 
                        dates.date,
                        ROUND(AVG(e.mood), 1) as avgMood
                    FROM dates 
                    LEFT JOIN entries e ON 
                        date(e.date) >= date(dates.date) AND 
                        date(e.date) < date(dates.date, '+5 days')
                    GROUP BY dates.date
                    ORDER BY dates.date
                `;
            case 'year':
                return `
                    WITH RECURSIVE months(date) AS (
                        SELECT date('now', 'start of month', '-11 months')
                        UNION ALL
                        SELECT date(date, '+1 month')
                        FROM months
                        WHERE date < date('now', 'start of month')
                    )
                    SELECT 
                        strftime('%Y-%m-%d', months.date) as date,
                        ROUND(AVG(entries.mood), 1) as avgMood
                    FROM months 
                    LEFT JOIN entries ON strftime('%Y-%m', entries.date) = strftime('%Y-%m', months.date)
                    GROUP BY strftime('%Y-%m', months.date)
                    ORDER BY date
                `;
            case 'alltime':
                return `
                    WITH min_max_dates AS (
                        SELECT 
                            MIN(date(date)) as min_date,
                            MAX(date(date)) as max_date
                        FROM entries
                    ),
                    months AS (
                        SELECT 
                            date(min_date, 'start of month') as start_date
                        FROM min_max_dates
                        UNION ALL
                        SELECT 
                            date(start_date, '+1 month')
                        FROM months, min_max_dates
                        WHERE start_date < date(max_date, 'start of month')
                    )
                    SELECT 
                        strftime('%Y-%m-%d', months.start_date) as date,
                        ROUND(AVG(entries.mood), 1) as avgMood
                    FROM months 
                    LEFT JOIN entries ON strftime('%Y-%m', entries.date) = strftime('%Y-%m', months.start_date)
                    GROUP BY strftime('%Y-%m', months.start_date)
                    ORDER BY date
                    LIMIT 24  -- Limit to 2 years max for all time view
                `;
            default:
                return `
                    WITH RECURSIVE dates(date) AS (
                        SELECT date('now', '-7 days')
                        UNION ALL
                        SELECT date(date, '+1 day')
                        FROM dates
                        WHERE date < date('now')
                    )
                    SELECT 
                        dates.date,
                        ROUND(AVG(entries.mood), 1) as avgMood
                    FROM dates 
                    LEFT JOIN entries ON date(entries.date) = dates.date
                    GROUP BY dates.date
                    ORDER BY dates.date
                `;
        }
    };

    // Format labels based on timeframe
    const formatDateLabel = (dateStr: string, index: number, totalPoints: number) => {
        const date = new Date(dateStr);
        
        switch(timeframe) {
            case 'week':
                return formatDayLabel(dateStr); // Short day name (e.g., "Mon")
                
            case 'month':
                // For month view, show week labels (Week 1-4)
                const weekNum = index + 1;
                return `Week ${weekNum}`;
                
            case '3months':
                // For 3-month view, show month names at the start of each month
                const day = date.getDate();
                const isFirstOfMonth = day <= 5 && date.getDate() === 1;
                
                if (isFirstOfMonth) {
                    return date.toLocaleDateString(undefined, { month: 'short' });
                } else if (index === 0 || index === totalPoints - 1) {
                    // Show something at the start and end for context
                    return `${date.getMonth() + 1}/${date.getDate()}`;
                }
                
                // Show date occasionally throughout
                if (index % 3 === 0) {
                    return `${date.getMonth() + 1}/${date.getDate()}`;
                }
                return '';
                
            case 'year':
            case 'alltime':
                // For longer periods, just show month names
                return date.toLocaleDateString(undefined, { month: 'short' });
                
            default:
                return formatDayLabel(dateStr);
        }
    };

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

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            try {
                const query = getDataQuery();
                const results = await db.getAllAsync<MoodDataPoint>(query);
                
                if (results.length === 0) {
                    setChartData(null);
                    setLoading(false);
                    return;
                }
                
                const moodValues = results.map(row => row.avgMood);
                const labels = results.map((row, index) => 
                    formatDateLabel(row.date, index, results.length)
                );
                
                const { data: interpolatedData, nullIndices: nulls } = interpolateData(moodValues);

                setNullIndices(nulls);
                setChartData({
                    labels,
                    datasets: [{
                        data: interpolatedData,
                        withDots: true // Always show dots for all timeframes
                    },
                    {
                        data: [10],
                        withDots: false
                    },
                    {
                        data: [0],
                        withDots: false
                    },
                ]
                });
            } catch (error) {
                console.error('Error fetching mood data:', error);
                setChartData(null);
            }
            setLoading(false);
        };

        fetchData();
    }, [db, refreshCount, timeframe]);

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
                withDots={true} // Always show dots
                getDotColor={(dataPoint, index) => {
                    if (nullIndices.includes(index)) {
                        return '#e74c3c';  // Soft red for missing data
                    }
                    return colors.accent;  // Use theme accent color for recorded moods
                }}
                chartConfig={{
                    ...chartConfig,
                    strokeWidth: 2, // Consistent line thickness for all timeframes
                }}
                bezier
                fromZero
                style={styles.chart}
            />
        </Card>
    );
}