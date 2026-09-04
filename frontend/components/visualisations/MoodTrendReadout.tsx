import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { moodColor } from '@/components/timeline/moodColor';
import { useThemeColors } from '@/styles/global';
import { formatReadoutDay, type LatestEntry } from './transforms/latestEntry';

/**
 * What a held point on the mood-trend chart says.
 *
 * ONE component for both surfaces so the card's floating bubble and the
 * expanded view's fixed panel can never disagree about what a day means: the
 * card passes it to `MoodLineChart`'s `tooltip` prop, the expanded view renders
 * it below the chart (steadier than a bubble at full-screen size).
 */
export type MoodTrendReadoutProps = {
    /** Local day, "YYYY-MM-DD". */
    day: string;
    /** That day's average mood, or null when nothing was logged. */
    average: number | null;
    /** The day's most recent entry, or null when there is none. */
    entry: LatestEntry | null;
    /** `'panel'` gets more room to breathe than the floating `'bubble'`. */
    variant?: 'bubble' | 'panel';
};

/** Averages are shown to 1 dp — the same precision the daily aggregate stores. */
const formatMood = (mood: number): string => mood.toFixed(1);

export const MoodTrendReadout: React.FC<MoodTrendReadoutProps> = ({
    day,
    average,
    entry,
    variant = 'bubble',
}) => {
    const colors = useThemeColors();
    const panel = variant === 'panel';

    const styles = useMemo(
        () =>
            StyleSheet.create({
                wrap: panel ? { gap: 4 } : { gap: 2, maxWidth: 200 },
                day: {
                    color: colors.text,
                    fontSize: panel ? 15 : 13,
                    fontWeight: '600',
                },
                average: {
                    color: colors.textSecondary,
                    fontSize: panel ? 14 : 12,
                },
                entryRow: {
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    marginTop: 2,
                },
                swatch: {
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                },
                entryText: {
                    color: colors.text,
                    fontSize: panel ? 14 : 12,
                    flexShrink: 1,
                },
                note: {
                    color: colors.textSecondary,
                    fontSize: panel ? 14 : 12,
                    fontStyle: 'italic',
                },
                muted: {
                    color: colors.textSecondary,
                    fontSize: panel ? 14 : 12,
                },
            }),
        [colors, panel]
    );

    return (
        <View style={styles.wrap} testID="mood-trend-readout">
            <Text style={styles.day}>{formatReadoutDay(day)}</Text>

            {average === null ? (
                // A day with no entry. The line still crosses it (dashed), so say
                // plainly that the crossing is an estimate — never let an
                // interpolated point read as something the user recorded.
                <Text style={styles.muted}>No entry — interpolated</Text>
            ) : (
                <Text style={styles.average}>Avg mood {formatMood(average)}</Text>
            )}

            {entry && (
                <>
                    <View style={styles.entryRow}>
                        <View
                            style={[
                                styles.swatch,
                                {
                                    backgroundColor: moodColor(
                                        entry.mood,
                                        colors.accent,
                                        colors.overlays.tag
                                    ),
                                },
                            ]}
                        />
                        <Text style={styles.entryText} numberOfLines={1}>
                            {entry.time} · mood {formatMood(entry.mood)}
                        </Text>
                    </View>
                    {entry.note && (
                        <Text style={styles.note} numberOfLines={panel ? 2 : 1}>
                            {entry.note}
                        </Text>
                    )}
                </>
            )}
        </View>
    );
};

export default MoodTrendReadout;
