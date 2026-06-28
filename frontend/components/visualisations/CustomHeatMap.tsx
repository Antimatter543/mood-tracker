import React, { useCallback, useState, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { Svg, Rect, Text as SvgText } from 'react-native-svg';
import { useSQLiteContext } from 'expo-sqlite';
import { useThemeColors } from '@/styles/global';
import { useDataRefresh } from '@/hooks/useDataRefresh';
import { Card } from '@/components/Card';
import InfoBubble from '../InfoBubble';
import {
    buildHeatmapGrid,
    mirrorWeekIndex,
    type HeatmapInput,
} from './transforms/heatmap';
import { aggregateDailyAverages } from './transforms/dailyAverages';
import { localDateString } from './transforms/dateHelpers';
import { moodColor } from '@/components/timeline/moodColor';

interface DayData {
    date: string;
    mood: number | null;
}

const CustomHeatmap: React.FC = () => {
    const colors = useThemeColors();
    const db = useSQLiteContext();
    const [moodData, setMoodData] = useState<DayData[]>([]);

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

    // Mood -> color via the shared canonical scale (see components/timeline/
    // moodColor.ts) so the heatmap and the timeline render mood identically.
    // null mood falls back to the muted tag tint.
    const getMoodColor = (mood: number | null) =>
        moodColor(mood, colors.accent, colors.overlays.tag);

    const getTextColor = (mood: number | null) => {
        if (mood === null) return colors.textSecondary;
        // If mood is high (indicating darker green), use white text
        return mood > 6 ? colors.text : colors.overlays.textSecondary;
    };

    const fetchData = useCallback(async () => {
            try {
                // End date is the user's LOCAL today (YYYY-MM-DD).
                const endDate = localDateString(new Date());

                // Fetch ALL raw entries (heatmap is all-time) as {date: instant,
                // mood}. Day-keying happens in JS via aggregateDailyAverages —
                // SQL never day-buckets (the old recursive-CTE query joined on
                // `date(entries.date)` in UTC, mis-placing late-evening entries).
                const rawRows = await db.getAllAsync<{ date: string; mood: number }>(
                    `SELECT date, mood FROM entries ORDER BY date`,
                );

                const daily = aggregateDailyAverages(rawRows);

                // Empty DB -> nothing to plot (buildHeatmapGrid handles []).
                if (daily.length === 0) {
                    setMoodData([]);
                    return;
                }

                // Per-local-day populated cells, capped at today so a future-
                // dated entry doesn't stretch the grid past now.
                const days: { date: string; mood: number | null }[] = daily
                    .filter((d) => d.day <= endDate)
                    .map((d) => ({ date: d.day, mood: d.avg }));

                if (days.length === 0) {
                    setMoodData([]);
                    return;
                }

                // Preserve the old "show EXTRA_MONTHS before the earliest data"
                // lead-in: prepend an empty boundary day so the grid extends back
                // a month (buildHeatmapGrid gap-fills the days in between as
                // null). Use local calendar-month arithmetic.
                const earliest = days[0].date;
                const [ey, em, ed] = earliest.split('-').map(Number);
                const leadIn = new Date(ey, em - 1 - EXTRA_MONTHS, ed);
                const leadInDay = localDateString(leadIn);
                if (leadInDay < earliest) {
                    days.unshift({ date: leadInDay, mood: null });
                }

                setMoodData(days);
                // Newest week is mirrored to the LEFT edge (see
                // generateCalendarData), so the ScrollView opens on the most
                // recent data with no auto-scroll needed.
            } catch (error) {
                console.error('Error fetching mood data:', error);
            }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- query reads only db; setState identities are stable
        }, [db]);
    // Focus-aware refetch (replaces useEffect([db, refreshCount])).
    useDataRefresh(fetchData, [db]);

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
        // Horizontal columns are MIRRORED: the newest week sits on the LEFT
        // edge and older weeks extend to the right, so recent moods are visible
        // immediately on open without scrolling. The vertical day-of-week rows
        // (Mon top → Sun bottom) are untouched. The transform stays
        // chronological (weekIndex 0 = oldest); we mirror only at pixel time.
        const { totalWeeks } = grid;
        return {
            cells: grid.cells.map((c) => ({
                date: c.date,
                dayOfMonth: c.dayOfMonth,
                mood: c.mood,
                x:
                    LEFT_PADDING +
                    mirrorWeekIndex(c.weekIndex, totalWeeks) *
                        (SQUARE_SIZE + GAP_SIZE),
                y: TOP_PADDING + c.dayIndex * (SQUARE_SIZE + GAP_SIZE),
                inRange: true,
            })),
            monthLabels: grid.monthLabels.map((m) => ({
                month: m.month,
                x:
                    LEFT_PADDING +
                    mirrorWeekIndex(m.weekIndex, totalWeeks) *
                        (SQUARE_SIZE + GAP_SIZE),
                weekIndex: m.weekIndex,
            })),
            totalWeeks,
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
                    showsHorizontalScrollIndicator={true}
                    style={styles.scrollContainer}
                    // Columns are mirrored so the newest week is on the LEFT
                    // edge; the ScrollView's default (left) position already
                    // shows the most recent data, so no auto-scroll is needed.
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