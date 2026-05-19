import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { useDataContext } from '@/context/DataContext';
import { useThemeColors } from '@/styles/global';
import { Card } from '@/components/Card';
import InfoBubble from '../InfoBubble';
import { useTimeframe } from '@/context/TimeframeContext';
import {
    computeActivityImpact,
    barWidthFraction,
    type ActivityImpactRow,
} from './transforms/activityImpact';

type ActivityImpact = ActivityImpactRow;

const ActivityImpactChart = () => {
    const colors = useThemeColors();
    const db = useSQLiteContext();
    const { refreshCount } = useDataContext();
    const { timeframeCondition, timeframeDescription } = useTimeframe();
    const [impactData, setImpactData] = useState<ActivityImpact[]>([]);
    const [totalEntries, setTotalEntries] = useState(0);

    // Define negative impact color based on theme
    const negativeColor = useMemo(() => {
        // For cherry theme, use a color that matches the theme
        if (colors.accent === '#DB7093') { // Cherry theme
            return '#E57373'; // Lighter red for cherry theme
        } else if (colors.accent === '#6495ED') { // Midnight theme
            return '#FF5252'; // Bright red for midnight theme
        } else if (colors.accent === '#43A047') { // Forest theme
            return '#FF7043'; // Orange-red for forest theme
        }
        // Default red for other themes
        return '#ff4444';
    }, [colors]);

    const styles = useMemo(() => StyleSheet.create({
        title: {
            fontSize: 18,
            fontWeight: '600',
            color: colors.text,
            marginBottom: 16,
        },
        legend: {
            flexDirection: 'row',
            marginBottom: 16,
            gap: 16,
        },
        legendItem: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
        },
        legendDot: {
            width: 8,
            height: 8,
            borderRadius: 4,
        },
        legendText: {
            color: colors.text,
            fontSize: 12,
        },
        chartContainer: {
            gap: 16,
        },
        barContainer: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
        },
        labelContainer: {
            width: '25%',
        },
        activityLabel: {
            color: colors.text,
            fontSize: 14,
            fontWeight: '500',
        },
        entryCount: {
            color: colors.textSecondary,
            fontSize: 12,
        },
        barWrapper: {
            flex: 1,
            flexDirection: 'row',
            height: 24,
            backgroundColor: colors.overlays.tag,
            borderRadius: 12,
            overflow: 'hidden',
        },
        barHalf: {
            width: '50%',
            height: '100%',
        },
        centerLine: {
            position: 'absolute',
            left: '50%',
            width: 1,
            height: '100%',
            backgroundColor: colors.border,
        },
        bar: {
            height: '100%',
        },
        positiveBar: {
            backgroundColor: colors.accent,
        },
        negativeBar: {
            backgroundColor: negativeColor,
        },
        impactValue: {
            width: '10%',
            fontSize: 14,
            fontWeight: '600',
            textAlign: 'right',
        },
        positiveImpact: {
            color: colors.accent,
        },
        negativeImpact: {
            color: negativeColor,
        },
        footer: {
            marginTop: 24,
            paddingTop: 16,
            borderTopWidth: 1,
            borderTopColor: colors.border,
        },
        statsContainer: {
            flexDirection: 'row',
            justifyContent: 'space-between',
        },
        stat: {
            gap: 4,
        },
        statLabel: {
            color: colors.textSecondary,
            fontSize: 12,
        },
        statValue: {
            color: colors.text,
            fontSize: 14,
            fontWeight: '600',
        },
        emptyState: {
            alignItems: 'center',
            padding: 20,
        },
        emptyText: {
            color: colors.textSecondary,
            fontSize: 14,
            textAlign: 'center',
            marginTop: 8,
        },
    }), [colors, negativeColor]);

    useEffect(() => {
        const fetchActivityImpact = async () => {
            try {
                const results = await db.getAllAsync<ActivityImpact>(`
                    WITH OverallAvg AS (
                        SELECT AVG(mood) as avg_mood
                        FROM entries
                        WHERE ${timeframeCondition}
                    )
                    SELECT 
                        a.name as activity_name,
                        ROUND(AVG(e.mood) - (SELECT avg_mood FROM OverallAvg), 1) as impact,
                        COUNT(DISTINCT e.id) as entry_count
                    FROM activities a
                    JOIN entry_activities ea ON a.id = ea.activity_id
                    JOIN entries e ON ea.entry_id = e.id
                    WHERE ${timeframeCondition}
                    GROUP BY a.id, a.name
                    HAVING COUNT(DISTINCT e.id) >= 3
                    ORDER BY impact DESC
                `);

                setImpactData(results);

                const totalResult = await db.getFirstAsync<{ total: number }>(
                    `SELECT COUNT(*) as total FROM entries WHERE ${timeframeCondition}`
                );
                setTotalEntries(totalResult?.total || 0);
            } catch (error) {
                console.error('Error fetching activity impact:', error);
            }
        };

        fetchActivityImpact();
    }, [db, refreshCount, timeframeCondition]);

    // Delegate display ordering + scaling to the transform.
    // The transform also filters NaN/null impacts (which can arise when the
    // SQL subquery `AVG(mood)` is NULL over a zero-entry window).
    const breakdown = useMemo(
        () => computeActivityImpact(impactData, 5),
        [impactData],
    );
    const { positive: positiveImpacts, displayOrder: displayData, maxAbsImpact } = breakdown;

    const getBarWidth = (impact: number): number =>
        barWidthFraction(impact, maxAbsImpact);

    if (impactData.length === 0) {
        return (
            <Card>
                <Text style={styles.title}>Activity Impact on Mood</Text>
                <View style={styles.emptyState}>
                    <Text style={styles.emptyText}>
                        Not enough data available for this time period.
                        Try selecting a longer timeframe or add more entries with activities.
                    </Text>
                </View>
            </Card>
        );
    }

    return (
        <Card>
            <InfoBubble
                text={`This chart shows how different activities affect your mood during the selected time period (${timeframeDescription.toLowerCase()}). Longer bars indicate stronger positive impacts, helping you identify which activities most improve your wellbeing.`}
                position="top-right"
            />
            <Text style={styles.title}>Activity Impact on Mood</Text>

            <View style={styles.legend}>
                <View style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: colors.accent }]} />
                    <Text style={styles.legendText}>Positive Impact</Text>
                </View>
                <View style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: negativeColor }]} />
                    <Text style={styles.legendText}>Negative Impact</Text>
                </View>
            </View>

            <View style={styles.chartContainer}>
                {displayData.map((item) => {
                    // transform filters null impacts out of displayOrder, but TS still
                    // sees the input type as nullable — coerce once.
                    const impact = item.impact ?? 0;
                    return (
                    <View key={item.activity_name} style={styles.barContainer}>
                        <View style={styles.labelContainer}>
                            <Text style={styles.activityLabel}>{item.activity_name}</Text>
                            <Text style={styles.entryCount}>{item.entry_count} entries</Text>
                        </View>

                        <View style={styles.barWrapper}>
                            <View style={styles.barHalf}>
                                {impact < 0 && (
                                    <View
                                        style={[
                                            styles.bar,
                                            styles.negativeBar,
                                            { width: `${getBarWidth(impact) * 100}%`, marginLeft: 'auto' }
                                        ]}
                                    />
                                )}
                            </View>

                            <View style={styles.centerLine} />

                            <View style={styles.barHalf}>
                                {impact > 0 && (
                                    <View
                                        style={[
                                            styles.bar,
                                            styles.positiveBar,
                                            { width: `${getBarWidth(impact) * 100}%` }
                                        ]}
                                    />
                                )}
                            </View>
                        </View>

                        <Text style={[
                            styles.impactValue,
                            impact >= 0 ? styles.positiveImpact : styles.negativeImpact
                        ]}>
                            {impact >= 0 ? '+' : ''}{impact}
                        </Text>
                    </View>
                    );
                })}
            </View>

            <View style={styles.footer}>
                <View style={styles.statsContainer}>
                    <View style={styles.stat}>
                        <Text style={styles.statLabel}>Most Impactful</Text>
                        <Text style={styles.statValue}>
                            {positiveImpacts[0]?.activity_name || '--'} ({(positiveImpacts[0]?.impact ?? 0) >= 0 ? '+' : ''}{positiveImpacts[0]?.impact ?? '--'})
                        </Text>
                    </View>
                    <View style={styles.stat}>
                        <Text style={styles.statLabel}>Total Entries</Text>
                        <Text style={styles.statValue}>{totalEntries}</Text>
                    </View>
                </View>
            </View>
        </Card>
    );
};

export default ActivityImpactChart;