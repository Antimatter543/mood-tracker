import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { moodColor } from '@/components/timeline/moodColor';
import { useThemeColors } from '@/styles/global';
import { useDateFormat } from '@/hooks/useDateFormat';
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
    /** The day's entries, newest first, or null when there are none. */
    entries: LatestEntry[] | null;
    /** `'panel'` gets more room to breathe than the floating `'bubble'`. */
    variant?: 'bubble' | 'panel';
};

/** Entries listed before collapsing the rest into "+N more". The floating bubble is smaller. */
export const BUBBLE_MAX_ENTRIES = 3;
export const PANEL_MAX_ENTRIES = 5;

/** Averages are shown to 1 dp — the same precision the daily aggregate stores. */
const formatMood = (mood: number): string => mood.toFixed(1);

export const MoodTrendReadout: React.FC<MoodTrendReadoutProps> = ({
    day,
    average,
    entries,
    variant = 'bubble',
}) => {
    const colors = useThemeColors();
    const { pref: dateFormatPref } = useDateFormat();
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

    // Newest first (see sortedEntriesPerDay). A busy day must not grow the
    // readout without bound, so show the newest few and count the rest.
    const cap = panel ? PANEL_MAX_ENTRIES : BUBBLE_MAX_ENTRIES;
    const visible = entries ? entries.slice(0, cap) : [];
    const hidden = entries ? entries.length - visible.length : 0;

    return (
        <View style={styles.wrap} testID="mood-trend-readout">
            <Text style={styles.day}>{formatReadoutDay(day, dateFormatPref)}</Text>

            {average === null ? (
                // A day with no entry. The line still crosses it (dashed), so say
                // plainly that the crossing is an estimate — never let an
                // interpolated point read as something the user recorded.
                <Text style={styles.muted}>No entry — interpolated</Text>
            ) : (
                <Text style={styles.average}>Avg mood {formatMood(average)}</Text>
            )}

            {visible.map((entry, index) => (
                // Index key: the list is derived, never reordered in place, and two
                // entries can share a minute, so time/mood is not unique.
                <React.Fragment key={index}>
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
                </React.Fragment>
            ))}
            {hidden > 0 && <Text style={styles.muted}>+{hidden} more</Text>}
        </View>
    );
};

export default MoodTrendReadout;
