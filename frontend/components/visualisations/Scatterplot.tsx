import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { Card } from '@/components/Card';
import { useThemeColors } from '@/styles/global';
import { useDataContext } from '@/context/DataContext';
import InfoBubble from '../InfoBubble';
import { MoodEntry } from '../types';

const PLOT_HEIGHT = 200;
const NUM_BUCKETS = 10;

const MoodHistogram = () => {
    const colors = useThemeColors();
    const db = useSQLiteContext();
    const { refreshCount } = useDataContext();
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
            width: 40,
            height: PLOT_HEIGHT,
            justifyContent: 'center',
        },
        plotContainer: {
            flex: 1,
            flexDirection: 'row',
        },
        yAxis: {
            width: 40,
            height: PLOT_HEIGHT,
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            paddingRight: 8,
        },
        yAxisLabel: {
            color: colors.textSecondary,
            fontSize: 12,
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
            marginLeft: 80, // Match the left padding from y-axis labels
            marginRight: 20,
            height: 30, // Reduced from 50
        },
        xAxisLabels: {
            height: 10,
            position: 'relative',
        },
        xAxisLabel: {
            color: colors.textSecondary,
            fontSize: 12,
            transform: [{ translateX: -4 }], // Center the label on the tick
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
            left: -PLOT_HEIGHT / 2 + 20,
        },
        xAxisTitle: {
            textAlign: 'center',
            marginTop: 8, // Reduced from 16
        },
    }), [colors]);

    useEffect(() => {
        const fetchMoodData = async () => {
            try {
                const entries = await db.getAllAsync<MoodEntry>(`
                    SELECT mood FROM entries 
                    WHERE date >= date('now', '-30 days')
                    ORDER BY mood
                `);
    
                const newBuckets = Array(NUM_BUCKETS).fill(0);
    
                entries.forEach(entry => {
                    // Fix the bucketing logic to properly handle decimal values
                    // For a mood scale of 0-10 with 11 buckets (0, 1, 2, ..., 10)
                    // We want 7.5 to go into bucket 7, not 8
                    const bucketIndex = Math.min(Math.floor(entry.mood), NUM_BUCKETS - 1);
                    newBuckets[bucketIndex]++;
                });
    
                const max = Math.max(...newBuckets);
                setBuckets(newBuckets);
                setMaxFrequency(max);
            } catch (error) {
                console.error('Error fetching mood data:', error);
            }
        };
    
        fetchMoodData();
    }, [db, refreshCount]);

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
            <Text style={styles.title}>Monthly Mood Distribution</Text>

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
                            <Text key={index} style={styles.yAxisLabel}>
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
                        <Text key={i} style={[
                            styles.xAxisLabel,
                            { position: 'absolute', left: `${(i * 100 + 50) / NUM_BUCKETS}%` }
                        ]}>
                            {i}
                        </Text>
                    ))}
                </View>

                {/* X-axis title */}
                <Text style={[styles.axisTitle, styles.xAxisTitle]}>Mood Rating</Text>
            </View>
        </Card>
    );
};

export default MoodHistogram;