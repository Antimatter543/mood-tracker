import { useCallback, useState, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { Card } from '@/components/Card';
import { useThemeColors } from '@/styles/global';
import { useDataRefresh } from '@/hooks/useDataRefresh';
import InfoBubble from '../InfoBubble';
import { MoodEntry } from '../types';
import { bucketMoodHistogram, NUM_BUCKETS } from './transforms/scatter';
import { useTimeframe } from '@/context/TimeframeContext';

const PLOT_HEIGHT = 200;

const MoodHistogram = () => {
    const colors = useThemeColors();
    const db = useSQLiteContext();
    const { periodWindow } = useTimeframe();
    const [buckets, setBuckets] = useState(Array(NUM_BUCKETS).fill(0));
    const [maxFrequency, setMaxFrequency] = useState(0);

    const styles = useMemo(() => StyleSheet.create({
        title: {
            fontSize: 20,
            fontWeight: 'bold',
            color: colors.text,
            marginBottom: 16,
        },
        container: {
            flexDirection: 'row',
            height: PLOT_HEIGHT - 10, // Reduced from 40
            marginVertical: 20,
        },
        yAxisTitleContainer: {
            width: 16,
            height: PLOT_HEIGHT,
            justifyContent: 'center',
        },
        plotContainer: {
            flex: 1,
            flexDirection: 'row',
        },
        yAxis: {
            width: 30,
            height: PLOT_HEIGHT,
            alignItems: 'flex-end',
            paddingRight: 8,
        },
        yAxisLabel: {
            position: 'absolute',
            color: colors.textSecondary,
            fontSize: 12,
            paddingRight: 8,
        },
        plotArea: {
            flex: 1,
            height: PLOT_HEIGHT,
            position: 'relative',
        },
        gridLine: {
            position: 'absolute',
            left: 0,
            right: 0,
            height: 1,
            backgroundColor: colors.overlays.tag,
        },
        barsContainer: {
            flex: 1,
            flexDirection: 'row',
            alignItems: 'flex-end',
            height: PLOT_HEIGHT,
        },
        barWrapper: {
            flex: 1,
            alignItems: 'center',
            justifyContent: 'flex-end',
        },
        bar: {
            width: '80%',
            backgroundColor: colors.accent,
            borderTopLeftRadius: 4,
            borderTopRightRadius: 4,
            minHeight: 1,
        },
        freqLabel: {
            position: 'absolute',
            top: -20,
            color: colors.textSecondary,
            fontSize: 10,
        },
        xAxisContainer: {
            height: 30,
            marginLeft: 45,
            marginBottom: 8,
        },
        xAxisLabels: {
            flexDirection: 'row',
            justifyContent: 'flex-end',
            width: '100%',
        },
        xAxisLabel: {
            flex: 1,
            color: colors.textSecondary,
            fontSize: 12,
            textAlign: 'center',
            width: '100%',
        },
        axisTitle: {
            color: colors.textSecondary,
            fontSize: 14,
            fontWeight: '500',
        },
        yAxisTitle: {
            transform: [{ rotate: '-90deg' }],
            width: PLOT_HEIGHT,
            textAlign: 'center',
            position: 'absolute',
            left: -PLOT_HEIGHT / 2 + 10,
        },
        xAxisTitle: {
            textAlign: 'center',
            marginTop: 0,
        },
    }), [colors]);

    const fetchMoodData = useCallback(async () => {
            try {
                // Scope to the TimeframeSelector window. Boundaries are
                // parameterised local-time UTC ISO strings — NOT the previous
                // hardcoded UTC date('now', '-30 days'), which ignored the
                // selector entirely and always showed the last 30 days.
                const { start, end } = periodWindow;
                const entries = await db.getAllAsync<MoodEntry>(`
                    SELECT mood FROM entries
                    WHERE deleted_at IS NULL AND date BETWEEN ? AND ?
                    ORDER BY mood
                `, [start, end]);

                const newBuckets = bucketMoodHistogram(entries);
                const max = newBuckets.length > 0 ? Math.max(...newBuckets) : 0;
                setBuckets(newBuckets);
                setMaxFrequency(max);
            } catch (error) {
                console.error('Error fetching mood data:', error);
            }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- query reads db + periodWindow; setState identities are stable
        }, [db, periodWindow]);
    // Focus-aware refetch (replaces useEffect([db, refreshCount, timeframe])).
    useDataRefresh(fetchMoodData, [db, periodWindow]);

    const getBarHeight = (count: number) => {
        if (maxFrequency === 0) return 0;
        return (count / maxFrequency) * PLOT_HEIGHT;
    };

    // Generate y-axis labels
    const yAxisLabels = Array.from(
        { length: 5 },
        (_, i) => Math.round(maxFrequency * (4 - i) / 4)
    );

    return (
        <Card>
            <InfoBubble
                text="A histogram showing how frequently you experience each mood level (0-10). Taller bars mean you log that mood more often, giving you insight into your most common emotional states. I wonder if it's a gaussian distribution?"
                position="top-right"
            />
            <Text style={styles.title}>Mood Distribution</Text>

            <View style={styles.container}>
                {/* Y-axis title */}
                <View style={styles.yAxisTitleContainer}>
                    <Text style={[styles.axisTitle, styles.yAxisTitle]}>Frequency</Text>
                </View>

                {/* Y-axis labels and plot area */}
                <View style={styles.plotContainer}>
                    {/* Y-axis labels */}
                    <View style={styles.yAxis}>
                        {yAxisLabels.map((label, index) => (
                            <Text key={index} style={[styles.yAxisLabel, {top: (index * PLOT_HEIGHT) / 4 - 8,}]}>
                                {label}
                            </Text>
                        ))}
                    </View>

                    {/* Plot area */}
                    <View style={styles.plotArea}>
                        {/* Grid lines */}
                        {yAxisLabels.map((_, index) => (
                            <View
                                key={index}
                                style={[
                                    styles.gridLine,
                                    {
                                        top: (index * PLOT_HEIGHT) / 4,
                                    }
                                ]}
                            />
                        ))}

                        {/* Bars */}
                        <View style={styles.barsContainer}>
                            {buckets.map((count, index) => (
                                <View key={index} style={styles.barWrapper}>
                                    <View
                                        style={[
                                            styles.bar,
                                            {
                                                height: getBarHeight(count),
                                            }
                                        ]}
                                    />
                                    {count > 0 && (
                                        <Text style={styles.freqLabel}>{count}</Text>
                                    )}
                                </View>
                            ))}
                        </View>
                    </View>
                </View>
            </View>

            {/* X-axis container with labels */}
            <View style={styles.xAxisContainer}>
                {/* Tick marks and numbers */}
                <View style={styles.xAxisLabels}>
                    {Array.from({ length: NUM_BUCKETS }, (_, i) => (
                        <Text key={i} style={styles.xAxisLabel}>
                            {i}
                        </Text>
                    ))}
                </View>

                {/* X-axis title */}
                <Text style={[styles.axisTitle, styles.xAxisTitle]}>Mood rating</Text>
            </View>
        </Card>
    );
};

export default MoodHistogram;