import React, { useEffect, useState, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { Svg, Rect, Text as SvgText } from 'react-native-svg';
import { useSQLiteContext } from 'expo-sqlite';
import { useThemeColors } from '@/styles/global';
import { useDataContext } from '@/context/DataContext';
import { Card } from '@/components/Card';
import InfoBubble from '../InfoBubble';
import { buildHeatmapGrid, type HeatmapInput } from './transforms/heatmap';
import { localDateString } from './transforms/dateHelpers';

interface DayData {
    date: string;
    mood: number | null;
}

const CustomHeatmap: React.FC = () => {
    const colors = useThemeColors();
    const db = useSQLiteContext();
    const { refreshCount } = useDataContext();
    const [moodData, setMoodData] = useState<DayData[]>([]);
    const scrollViewRef = useRef<ScrollView>(null);

    const styles = useMemo(() => StyleSheet.create({
        title: {
            fontSize: 18,
            fontWeight: '600',
            color: colors.text,
            marginBottom: 16,
        },
        subtitle: {
            fontSize: 12,
            color: colors.textSecondary,
            textAlign: 'center',
            marginTop: 8,
        },
        chartContainer: {
            alignItems: 'center',
        },
        scrollContainer: {
            maxWidth: '100%',
        }
    }), [colors]);

    // Configuration
    const SQUARE_SIZE = 20;
    const GAP_SIZE = 2;
    const DAYS_IN_WEEK = 7;
    const EXTRA_MONTHS = 1; // Show 1 month before earliest data
    const LEFT_PADDING = 30; // For day labels
    const TOP_PADDING = 20;  // For month labels

    // Calculate colors based on mood value
    const getMoodColor = (mood: number | null) => {
        if (mood === null) return colors.overlays.tag;
        
        // Convert hex to rgba
        const hexToRgba = (hex: string, opacity: number) => {
            // Remove the hash if it exists
            hex = hex.replace('#', '');
            
            // Parse the hex values
            const r = parseInt(hex.substring(0, 2), 16);
            const g = parseInt(hex.substring(2, 4), 16);
            const b = parseInt(hex.substring(4, 6), 16);
            
            // Return the rgba value
            return `rgba(${r}, ${g}, ${b}, ${opacity})`;
        };
        
        const intensity = mood / 10; // Normalize to 0-1
        return hexToRgba(colors.accent, 0.2 + (intensity * 0.8)); // Min opacity 0.2, max 1.0
    };

    const getTextColor = (mood: number | null) => {
        if (mood === null) return colors.textSecondary;
        // If mood is high (indicating darker green), use white text
        return mood > 6 ? colors.text : colors.overlays.textSecondary;
    };

    useEffect(() => {
        const fetchData = async () => {
            try {
                // End date is the user's LOCAL today (YYYY-MM-DD), computed in
                // JS and passed as a param — NOT SQLite's UTC date('now'), which
                // would drop today's grid cell for users east of UTC after their
                // local midnight.
                const endDate = localDateString(new Date());

                // Fetch all mood data without limit
                const results = await db.getAllAsync<{ date: string; avg_mood: number | null }>(`
                    WITH all_entries AS (
                        SELECT date(date) as date
                        FROM entries
                        GROUP BY date(date)
                    ),
                    date_range AS (
                        SELECT
                            date(
                                (SELECT MIN(date) FROM all_entries),
                                '-${EXTRA_MONTHS} months'
                            ) as start_date,
                            ? as end_date
                    ),
                    all_dates AS (
                        WITH RECURSIVE dates(date) AS (
                            SELECT start_date FROM date_range
                            UNION ALL
                            SELECT date(date, '+1 day')
                            FROM dates
                            WHERE date < (SELECT end_date FROM date_range)
                        )
                        SELECT date FROM dates
                    )
                    SELECT
                        all_dates.date,
                        ROUND(AVG(entries.mood), 1) as avg_mood
                    FROM all_dates
                    LEFT JOIN entries ON date(entries.date) = all_dates.date
                    GROUP BY all_dates.date
                    ORDER BY all_dates.date
                `, [endDate]);

                // On an empty `entries` table, MIN(date) is NULL so the query
                // returns a single row with date: null. Drop any falsy/invalid
                // date rows before they reach buildHeatmapGrid, which would
                // otherwise throw RangeError on `new Date(null)`.
                setMoodData(
                    results
                        .filter(row => row.date)
                        .map(row => ({
                            date: row.date,
                            mood: row.avg_mood
                        }))
                );
                // Scrolling to the newest (rightmost) data is handled by the
                // ScrollView's onContentSizeChange — a timeout-based scrollToEnd
                // races the SVG layout and often fires before content has width,
                // leaving the heatmap parked at the oldest data.
            } catch (error) {
                console.error('Error fetching mood data:', error);
            }
        };

        fetchData();
    }, [db, refreshCount]);

    const renderDayLabels = () => {
        // Day labels: Monday to Sunday in correct order
        const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        return days.map((day, index) => (
            <SvgText
                key={day}
                x={10}
                y={TOP_PADDING + (index * (SQUARE_SIZE + GAP_SIZE)) + SQUARE_SIZE / 2 + 4}
                fontSize={10}
                fill={colors.textSecondary}
                textAnchor="middle"
            >
                {day}
            </SvgText>
        ));
    };

    // Pure grid layout from the transform; the component is purely a pixel
    // positioner on top.
    const generateCalendarData = useMemo(() => {
        const grid = buildHeatmapGrid(moodData as HeatmapInput[]);
        if (grid.cells.length === 0) {
            return { cells: [], monthLabels: [], totalWeeks: 0 };
        }
        return {
            cells: grid.cells.map((c) => ({
                date: c.date,
                dayOfMonth: c.dayOfMonth,
                mood: c.mood,
                x: LEFT_PADDING + c.weekIndex * (SQUARE_SIZE + GAP_SIZE),
                y: TOP_PADDING + c.dayIndex * (SQUARE_SIZE + GAP_SIZE),
                inRange: true,
            })),
            monthLabels: grid.monthLabels.map((m) => ({
                month: m.month,
                x: LEFT_PADDING + m.weekIndex * (SQUARE_SIZE + GAP_SIZE),
                weekIndex: m.weekIndex,
            })),
            totalWeeks: grid.totalWeeks,
        };
    }, [moodData]);

    const renderMonthLabels = () => {
        return generateCalendarData.monthLabels.map(({ month, x, weekIndex }) => (
            <SvgText
                key={`${month}-${weekIndex}`}
                x={x}
                y={12}
                fontSize={10}
                fill={colors.textSecondary}
            >
                {month}
            </SvgText>
        ));
    };

    const renderSquares = () => {
        return generateCalendarData.cells.map(cell => (
            <React.Fragment key={cell.date}>
                <Rect
                    x={cell.x}
                    y={cell.y}
                    width={SQUARE_SIZE}
                    height={SQUARE_SIZE}
                    fill={getMoodColor(cell.mood)}
                    rx={2}
                />
                <SvgText
                    x={cell.x + (SQUARE_SIZE / 2)}
                    y={cell.y + (SQUARE_SIZE / 2) + 4}
                    fontSize={10}
                    fill={getTextColor(cell.mood)}
                    textAnchor="middle"
                >
                    {cell.dayOfMonth}
                </SvgText>
            </React.Fragment>
        ));
    };

    // Calculate required SVG width based on number of weeks
    const svgWidth = LEFT_PADDING + (generateCalendarData.totalWeeks * (SQUARE_SIZE + GAP_SIZE));
    const svgHeight = TOP_PADDING + (DAYS_IN_WEEK * (SQUARE_SIZE + GAP_SIZE));

    return (
        <Card>
            <InfoBubble 
                text="A custom heat map showing your average mood score during different days. Darker colors indicate better moods, while lighter colors represent days that might not have gone as well."
                position="top-right"
            />
            <Text style={styles.title}>Mood Heatmap</Text>
            <View style={styles.chartContainer}>
                <ScrollView
                    horizontal
                    ref={scrollViewRef}
                    showsHorizontalScrollIndicator={true}
                    style={styles.scrollContainer}
                    // Reliably reveal the newest data: scroll to the right edge
                    // once the SVG content has a measured width. Re-fires if the
                    // content grows (new entries), keeping recent dates in view.
                    onContentSizeChange={() =>
                        scrollViewRef.current?.scrollToEnd({ animated: false })
                    }
                >
                    <Svg width={svgWidth} height={svgHeight}>
                        {renderDayLabels()}
                        {renderMonthLabels()}
                        {renderSquares()}
                    </Svg>
                </ScrollView>
            </View>
            <Text style={styles.subtitle}>Darker color indicates higher mood</Text>
        </Card>
    );
};

export default CustomHeatmap;