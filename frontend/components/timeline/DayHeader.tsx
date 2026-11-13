import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ThemeColors } from '@/styles/global';
import { LAYOUT_CONTENT_PADDING } from '@/styles/layout';
import type { DateFormatPref } from '@/lib/dateFormat';
import { formatSectionTitle } from './dateHeader';
import { moodColor } from './moodColor';
import type { DaySummary } from './timelineRows';
import { DayHealthCard } from './DayHealthCard';
import { HEALTH_RATING_COLORS, HEALTH_RATING_LABELS, dayHealthRating, type DayHealth } from './dayHealth';
import { now } from '@/lib/clock';

type DayHeaderProps = DaySummary & {
    dateFormatPref: DateFormatPref;
    colors: ThemeColors;
    /** True when FlashList renders this as the pinned copy at the top. */
    sticky?: boolean;
};

/** "1 entry" / "3 entries". */
export const entryCountLabel = (count: number): string =>
    `${count} ${count === 1 ? 'entry' : 'entries'}`;

/** Screen-reader sentence for a day header. Exported for tests. */
export const dayHeaderA11yLabel = (title: string, summary: DaySummary): string => {
    if (!summary.complete) return title;
    const parts = [title, entryCountLabel(summary.count)];
    if (summary.averageMood != null) parts.push(`average mood ${summary.averageMood}`);
    return parts.join(', ');
};

/** Screen-reader label of the mood-and-health button. Exported for tests. */
export const dayHealthButtonLabel = (averageMood: number | null, health: DayHealth): string => {
    const rating = dayHealthRating(health);
    const healthPart = rating ? `health ${HEALTH_RATING_LABELS[rating].toLowerCase()}` : 'health';
    const label = [averageMood != null ? `average mood ${averageMood}` : null, healthPart, 'show details']
        .filter(Boolean)
        .join(', ');
    return label.charAt(0).toUpperCase() + label.slice(1);
};

const useStyles = (colors: ThemeColors) =>
    useMemo(
        () =>
            StyleSheet.create({
                // OPAQUE: this row is also rendered as the pinned sticky copy, and
                // rows scrolling underneath must not show through it.
                header: {
                    flexDirection: 'row',
                    alignItems: 'center',
                    backgroundColor: colors.background,
                    paddingHorizontal: LAYOUT_CONTENT_PADDING,
                    paddingTop: 18,
                    paddingBottom: 10,
                    minHeight: 52,
                },
                stickyEdge: {
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: colors.border,
                },
                title: {
                    flexShrink: 1,
                    color: colors.text,
                    fontSize: 17,
                    fontWeight: '700',
                    letterSpacing: -0.2,
                },
                spacer: {
                    flex: 1,
                    minWidth: 12,
                },
                count: {
                    color: colors.textSecondary,
                    fontSize: 13,
                    fontWeight: '500',
                },
                average: {
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    marginLeft: 10,
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                    borderRadius: 999,
                    backgroundColor: colors.overlays.tag,
                },
                averageDot: {
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                },
                averageButton: {
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: colors.overlays.tagBorder,
                },
                pressed: {
                    opacity: 0.6,
                },
                divider: {
                    width: StyleSheet.hairlineWidth,
                    alignSelf: 'stretch',
                    backgroundColor: colors.overlays.tagBorder,
                },
                averageText: {
                    color: colors.text,
                    fontSize: 13,
                    fontWeight: '600',
                },
            }),
        [colors]
    );

/**
 * The header of one day in the Timeline: "Today" / "Yesterday" / the date in the
 * user's chosen format, then what the day held — how many entries and their
 * average mood (the number AND a dot on the same mood ramp as the entry nodes, so
 * the colour is never the only signal).
 *
 * A day that may continue on the next, not-yet-loaded page (`complete: false`)
 * shows its title only: a count of "the entries we happen to have fetched so
 * far" would be a wrong number presented as a fact. It fills in when the page
 * lands.
 */
const DayHeaderImpl: React.FC<DayHeaderProps> = ({
    dayKey,
    count,
    averageMood,
    complete,
    health,
    dateFormatPref,
    colors,
    sticky = false,
}) => {
    const styles = useStyles(colors);
    const title = formatSectionTitle(dayKey, dateFormatPref, now());
    const [healthOpen, setHealthOpen] = useState(false);
    const openHealth = useCallback(() => setHealthOpen(true), []);
    const closeHealth = useCallback(() => setHealthOpen(false), []);
    const healthRating = health ? dayHealthRating(health) : null;
    const moodBadge =
        averageMood != null ? (
            <>
                <View
                    style={[
                        styles.averageDot,
                        { backgroundColor: moodColor(averageMood, colors.accent, colors.overlays.tag) },
                    ]}
                />
                <Text style={styles.averageText}>{averageMood.toFixed(1)}</Text>
            </>
        ) : null;
    return (
        <View
            style={[styles.header, sticky && styles.stickyEdge]}
            accessibilityRole="header"
            accessibilityLabel={dayHeaderA11yLabel(title, { dayKey, count, averageMood, complete })}
            testID={`day-header-${dayKey}`}
        >
            <Text style={styles.title} numberOfLines={1}>
                {title}
            </Text>
            <View style={styles.spacer} />
            {complete ? (
                <>
                    <Text style={styles.count}>{entryCountLabel(count)}</Text>
                    {health ? (
                        <Pressable
                            onPress={openHealth}
                            style={({ pressed }) => [styles.average, styles.averageButton, pressed && styles.pressed]}
                            hitSlop={8}
                            accessibilityRole="button"
                            accessibilityLabel={dayHealthButtonLabel(averageMood, health)}
                            testID={`day-health-${dayKey}`}
                        >
                            {moodBadge}
                            {averageMood != null ? <View style={styles.divider} /> : null}
                            <Ionicons
                                name="pulse"
                                size={16}
                                color={healthRating ? HEALTH_RATING_COLORS[healthRating] : colors.textSecondary}
                            />
                        </Pressable>
                    ) : averageMood != null ? (
                        <View style={styles.average} testID="day-average">
                            {moodBadge}
                        </View>
                    ) : null}
                </>
            ) : null}
            {health ? (
                <DayHealthCard
                    visible={healthOpen}
                    onClose={closeHealth}
                    title={averageMood != null ? `${title} · average mood ${averageMood.toFixed(1)}` : title}
                    health={health}
                    colors={colors}
                />
            ) : null}
        </View>
    );
};

export const DayHeader = React.memo(DayHeaderImpl);
DayHeader.displayName = 'DayHeader';
