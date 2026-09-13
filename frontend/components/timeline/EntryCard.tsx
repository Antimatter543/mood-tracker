import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Card } from '../Card';
import { MoodEntry } from '../types';
import { ThemeColors } from '@/styles/global';
import { moodColor } from './moodColor';
import { ActivityRow } from './ActivityRow';
import { EntryPhotos } from './EntryPhotos';

/**
 * EVERY callback takes the entry (or its id) as an ARGUMENT rather than being
 * pre-bound to it by the parent. That is what lets the Timeline hand the same
 * function identity to all 100+ cards, which is what lets `React.memo` below
 * actually bail out. With per-item `() => onEdit(entry)` closures the props
 * differed on every parent render and memo never hit once.
 */
type EntryCardProps = {
    entry: MoodEntry;
    onEdit: (entry: MoodEntry) => void;
    onDelete: (id: number) => void;
    /** Toggle this entry's starred state. */
    onToggleStar: (entry: MoodEntry) => void;
    colors: ThemeColors;
};

/** "9:05 AM" style — strip seconds off the locale time. */
const formatTime = (iso: string): string => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
};

const useStyles = (colors: ThemeColors) =>
    useMemo(
        () =>
            StyleSheet.create({
                card: {
                    padding: 0, // padding handled by `body`; the bar overlays the left edge
                    marginBottom: 12,
                },
                // Absolutely positioned at the card's left edge so it spans the
                // FULL card height regardless of Card's internal child wrapper
                // (Card wraps children in its own View, so a flexDirection:'row'
                // on the card style never reaches these children — an in-flow bar
                // collapsed to an invisible top sliver). Card has overflow:'hidden'
                // + borderRadius:24, so the bar's corners are clipped to the card's
                // rounded shape automatically.
                accentBar: {
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: 4,
                },
                body: {
                    padding: 16,
                    paddingLeft: 20, // 16 + the 4px accent bar so text clears it
                },
                headerRow: {
                    flexDirection: 'row',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                },
                moodBlock: {
                    flexDirection: 'row',
                    alignItems: 'baseline',
                },
                moodNumber: {
                    color: colors.text,
                    fontSize: 28,
                    fontWeight: '700',
                    letterSpacing: -0.5,
                },
                moodOutOf: {
                    color: colors.textSecondary,
                    fontSize: 14,
                    fontWeight: '500',
                    marginLeft: 2,
                },
                headerRight: {
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                },
                time: {
                    color: colors.textSecondary,
                    fontSize: 13,
                    marginRight: 6,
                },
                iconButton: {
                    padding: 8,
                    alignItems: 'center',
                    justifyContent: 'center',
                },
                notes: {
                    color: colors.text,
                    fontSize: 15,
                    lineHeight: 22,
                    marginTop: 12,
                },
            }),
        [colors]
    );

/**
 * A single clean timeline entry. One card surface; the mood is conveyed by a
 * left accent bar (tinted via the canonical heatmap scale) plus a prominent
 * number, NOT label prose. Quiet ghost icon-buttons for edit/delete; a compact
 * wrapping activity row; plain notes; and photos that hero when there's one.
 *
 * MEMOIZED (see the wrapper at the bottom of this file), and that is a
 * correctness concern on the Timeline, not just a micro-optimisation. The
 * Timeline's SectionList keeps the whole loaded window mounted (RN's default
 * `windowSize` spans far more than the content is tall for lists this size), so
 * an unmemoized card meant every single mounted entry re-rendered on every
 * parent state change — and each page append fires three of those (the spinner
 * on, the new sections, the spinner off). Deep in the list that turned one
 * `onEndReached` into seconds of synchronous React work rebuilding a native view
 * tree the user was actively flinging, which RN itself flags on device
 * ("VirtualizedList: You have a large list that is slow to update - make sure
 * your renderItem function renders components that follow React performance best
 * practices"). Keep the props value-comparable.
 */
const EntryCardImpl: React.FC<EntryCardProps> = ({ entry, onEdit, onDelete, onToggleStar, colors }) => {
    const styles = useStyles(colors);
    const accent = moodColor(entry.mood, colors.accent, colors.overlays.tag);
    const time = formatTime(entry.date);
    // NULL/absent = not starred; any instant = starred. Filled star (accent)
    // vs outline (muted) — Feather has no filled star, so the star glyph comes
    // from MaterialCommunityIcons ('star' / 'star-outline').
    const starred = entry.starred_at != null;

    return (
        <Card style={styles.card} variant="flat">
            <View style={[styles.accentBar, { backgroundColor: accent }]} />
            <View style={styles.body}>
                <View style={styles.headerRow}>
                    <View style={styles.moodBlock}>
                        <Text style={styles.moodNumber}>{entry.mood}</Text>
                        <Text style={styles.moodOutOf}>/10</Text>
                    </View>
                    <View style={styles.headerRight}>
                        {time ? <Text style={styles.time}>{time}</Text> : null}
                        <Pressable
                            testID="entry-star-toggle"
                            style={styles.iconButton}
                            onPress={() => onToggleStar(entry)}
                            accessibilityRole="button"
                            accessibilityLabel={starred ? 'Unstar entry' : 'Star entry'}
                            accessibilityState={{ selected: starred }}
                            hitSlop={10}
                        >
                            <MaterialCommunityIcons
                                name={starred ? 'star' : 'star-outline'}
                                color={starred ? colors.accent : colors.textSecondary}
                                size={18}
                            />
                        </Pressable>
                        <Pressable
                            style={styles.iconButton}
                            onPress={() => onEdit(entry)}
                            accessibilityRole="button"
                            accessibilityLabel="Edit entry"
                            hitSlop={10}
                        >
                            <Feather name="edit-2" color={colors.textSecondary} size={18} />
                        </Pressable>
                        <Pressable
                            style={styles.iconButton}
                            onPress={() => onDelete(entry.id)}
                            accessibilityRole="button"
                            accessibilityLabel="Delete entry"
                            hitSlop={10}
                        >
                            <Feather name="trash-2" color={colors.textSecondary} size={18} />
                        </Pressable>
                    </View>
                </View>

                <ActivityRow activities={entry.activities} colors={colors} />

                {entry.notes ? (
                    <Text style={styles.notes} numberOfLines={4}>
                        {entry.notes}
                    </Text>
                ) : null}

                {entry.photos && entry.photos.length > 0 && (
                    <EntryPhotos photos={entry.photos} colors={colors} />
                )}
            </View>
        </Card>
    );
};

/**
 * Default shallow comparison is exactly right here: `entry` objects are replaced
 * wholesale when their row changes (the list never mutates one in place — an edit
 * or a star toggle maps to a NEW object), `colors` is a module-level constant per
 * theme, and the three callbacks are entry-agnostic so the Timeline can memoize
 * them once. Guarded by __tests__/timelineListPerf.test.tsx.
 */
export const EntryCard = React.memo(EntryCardImpl);
EntryCard.displayName = 'EntryCard';
