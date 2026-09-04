import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useThemeColors } from '@/styles/global';

/**
 * The mood-trend chart's key. Shared by the card and the expanded view so the
 * two can never label the same two lines differently.
 *
 * The swatches deliberately mirror how MoodLineChart draws each line: the daily
 * average is a solid accent bar, the moving average a dashed neutral one.
 */
export const TrendLegend: React.FC<{ maWindow: number }> = ({ maWindow }) => {
    const colors = useThemeColors();

    const styles = useMemo(
        () =>
            StyleSheet.create({
                legend: {
                    flexDirection: 'row',
                    gap: 16,
                    marginTop: 8,
                    flexWrap: 'wrap',
                    justifyContent: 'center',
                },
                item: { flexDirection: 'row', alignItems: 'center', gap: 6 },
                solid: {
                    width: 14,
                    height: 3,
                    borderRadius: 2,
                    backgroundColor: colors.accent,
                },
                // A dashed stroke can't be expressed in a RN View, so the dash is
                // suggested with two short segments rather than faked with a border.
                dashRow: { flexDirection: 'row', gap: 3, alignItems: 'center' },
                dash: {
                    width: 5,
                    height: 2,
                    borderRadius: 1,
                    backgroundColor: colors.text,
                    opacity: 0.6,
                },
                text: { color: colors.textSecondary, fontSize: 12 },
            }),
        [colors]
    );

    return (
        <View style={styles.legend} testID="mood-trend-legend">
            <View style={styles.item}>
                <View style={styles.solid} />
                <Text style={styles.text}>Daily average</Text>
            </View>
            {maWindow > 0 && (
                <View style={styles.item}>
                    <View style={styles.dashRow}>
                        <View style={styles.dash} />
                        <View style={styles.dash} />
                    </View>
                    <Text style={styles.text}>{maWindow}-day trend</Text>
                </View>
            )}
        </View>
    );
};

export default TrendLegend;
