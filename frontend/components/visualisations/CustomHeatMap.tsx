import React, { useEffect, useState, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, Dimensions, ScrollView } from 'react-native';
import { Svg, Rect, Text as SvgText } from 'react-native-svg';
import { useSQLiteContext } from 'expo-sqlite';
import { useThemeColors } from '@/styles/global';
import { useDataContext } from '@/context/DataContext';
import { Card } from '@/components/Card';
import InfoBubble from '../InfoBubble';

const screenWidth = Dimensions.get('window').width;
const PADDING = 24;
const chartWidth = screenWidth - (2 * PADDING);

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
                            date('now') as end_date
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
                `);

                setMoodData(results.map(row => ({
                    date: row.date,
                    mood: row.avg_mood
                })));
                
                // Scroll to the end when data is loaded
                setTimeout(() => {
                    scrollViewRef.current?.scrollToEnd({ animated: false });
                }, 200);
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

    // Generate the calendar grid data
    const generateCalendarData = useMemo(() => {
        if (moodData.length === 0) return { cells: [], monthLabels: [], totalWeeks: 0 };
        
        // Create a map for quick mood lookups
        const moodByDate = new Map<string, number | null>();
        moodData.forEach(day => {
            moodByDate.set(day.date, day.mood);
        });
        
        // Find earliest and latest dates in our data
        const earliestDate = new Date(moodData[0].date);
        const latestDate = new Date(moodData[moodData.length - 1].date);
        
        // Find the first Monday before or on our earliest date to start the grid
        const startDate = new Date(earliestDate);
        const startDay = startDate.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
        
        // If not Monday (1), adjust back to previous Monday
        if (startDay !== 1) {
            startDate.setDate(startDate.getDate() - (startDay === 0 ? 6 : startDay - 1));
        }
        
        // Calculate how many weeks we need
        const totalDays = Math.ceil((latestDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
        const totalWeeks = Math.ceil(totalDays / 7);
        
        // Generate cells for the calendar
        const cells: Array<{
            date: string,
            dayOfMonth: number,
            mood: number | null,
            x: number,
            y: number,
            inRange: boolean
        }> = [];
        
        // Track months for labels
        const monthLabels: Array<{
            month: string,
            x: number,
            weekIndex: number
        }> = [];
        const seenMonths = new Set<string>();
        
        // Fill in the calendar grid
        for (let week = 0; week < totalWeeks; week++) {
            let firstDayOfWeekInMonth = null;
            
            for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
                // Create date for this cell
                const cellDate = new Date(startDate);
                cellDate.setDate(startDate.getDate() + (week * 7) + dayOfWeek);
                
                // Check if this date is within our data range
                const dateStr = cellDate.toISOString().split('T')[0];
                const inRange = cellDate >= earliestDate && cellDate <= latestDate;
                
                // Track first Monday of each month for label placement
                if (dayOfWeek === 0) { // Monday
                    const monthKey = `${cellDate.getFullYear()}-${cellDate.getMonth()}`;
                    if (!seenMonths.has(monthKey)) {
                        firstDayOfWeekInMonth = cellDate.getDate();
                    }
                }
                
                // Add month label if it's the first Monday of a new month
                if (dayOfWeek === 0 && firstDayOfWeekInMonth !== null) {
                    const month = cellDate.toLocaleDateString('en-US', { month: 'short' });
                    const monthKey = `${cellDate.getFullYear()}-${cellDate.getMonth()}`;
                    
                    if (!seenMonths.has(monthKey)) {
                        seenMonths.add(monthKey);
                        monthLabels.push({
                            month,
                            x: LEFT_PADDING + (week * (SQUARE_SIZE + GAP_SIZE)),
                            weekIndex: week
                        });
                    }
                }
                
                // Add cell to our grid
                cells.push({
                    date: dateStr,
                    dayOfMonth: cellDate.getDate(),
                    mood: moodByDate.get(dateStr) || null,
                    x: LEFT_PADDING + (week * (SQUARE_SIZE + GAP_SIZE)),
                    y: TOP_PADDING + (dayOfWeek * (SQUARE_SIZE + GAP_SIZE)),
                    inRange: true // Show all cells, not just the data range
                });
            }
        }
        
        return { cells, monthLabels, totalWeeks };
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