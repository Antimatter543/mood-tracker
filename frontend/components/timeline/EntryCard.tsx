import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useRecyclingState } from '@shopify/flash-list';
import { MoodEntry } from '../types';
import { ThemeColors } from '@/styles/global';
import { LAYOUT_CONTENT_PADDING } from '@/styles/layout';
import { moodColor } from './moodColor';
import { dangerColor, nodeFill } from './timelinePalette';
import { ActivityRow } from './ActivityRow';
import { EntryPhotos } from './EntryPhotos';

/**
 * EVERY callback takes the entry (or its id) as an ARGUMENT rather than being
 * pre-bound to it by the parent. That is what lets the Timeline hand the same
 * function identity to every card, which is what lets `React.memo` below
 * actually bail out. With per-item `() => onEdit(entry)` closures the props
 * differed on every parent render and memo never hit once.
 */
type EntryCardProps = {
    entry: MoodEntry;
    /** First entry of its day: the rail starts at this node. */
    isFirstOfDay?: boolean;
    /** Last loaded entry of its day: the rail ends at this node. */
    isLastOfDay?: boolean;
    onEdit: (entry: MoodEntry) => void;
    onDelete: (id: number) => void;
    /** Toggle this entry's starred state. */
    onToggleStar: (entry: MoodEntry) => void;
    colors: ThemeColors;
};

/** Rail geometry. The node's centre sits level with the card's first line. */
export const RAIL_WIDTH = 44;
export const NODE_SIZE = 34;
const NODE_TOP = 10;
const RAIL_LINE_WIDTH = 2;
/** Vertical gap between two cards. Part of the CELL (see `cell`), not a margin. */
const CARD_GAP = 12;

/** "9:05 AM" style — strip seconds off the locale time. */
const formatTime = (iso: string): string => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
};

/** A mood as the node prints it: integers bare, fractions to one decimal. */
export const formatMood = (mood: number): string =>
    Number.isInteger(mood) ? String(mood) : mood.toFixed(1);

const useStyles = (colors: ThemeColors) =>
    useMemo(
        () =>
            StyleSheet.create({
                // The cell owns its gap as PADDING, so the rail (absolutely
                // positioned against the cell) runs unbroken from one entry's
                // node to the next.
                cell: {
                    flexDirection: 'row',
                    paddingLeft: LAYOUT_CONTENT_PADDING - 8,
                    paddingRight: LAYOUT_CONTENT_PADDING,
                    paddingBottom: CARD_GAP,
                },
                rail: {
                    width: RAIL_WIDTH,
                    alignItems: 'center',
                },
                railLine: {
                    position: 'absolute',
                    width: RAIL_LINE_WIDTH,
                    left: (RAIL_WIDTH - RAIL_LINE_WIDTH) / 2,
                    backgroundColor: colors.overlays.tagBorder,
                },
                node: {
                    marginTop: NODE_TOP,
                    width: NODE_SIZE,
                    height: NODE_SIZE,
                    borderRadius: NODE_SIZE / 2,
                    borderWidth: 2,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: colors.background,
                },
                nodeText: {
                    color: colors.text,
                    fontSize: 13,
                    fontWeight: '700',
                    letterSpacing: -0.3,
                },
                card: {
                    flex: 1,
                    marginLeft: 8,
                    backgroundColor: colors.cardBackground,
                    borderRadius: 16,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: colors.border,
                    overflow: 'hidden',
                },
                body: {
                    paddingHorizontal: 16,
                    paddingTop: 14,
                    paddingBottom: 14,
                },
                bodyPressed: {
                    backgroundColor: colors.overlays.tag,
                },
                timeRow: {
                    flexDirection: 'row',
                    alignItems: 'center',
                    // Room for the absolutely-positioned action cluster.
                    paddingRight: 80,
                    minHeight: 22,
                },
                time: {
                    color: colors.textSecondary,
                    fontSize: 13,
                    fontWeight: '600',
                    letterSpacing: 0.2,
                },
                notes: {
                    color: colors.text,
                    fontSize: 15,
                    lineHeight: 22,
                    marginTop: 10,
                },
                photos: {
                    paddingHorizontal: 16,
                    marginTop: -2,
                    paddingBottom: 14,
                },
                actions: {
                    position: 'absolute',
                    top: 2,
                    right: 2,
                    flexDirection: 'row',
                },
                iconButton: {
                    width: 40,
                    height: 40,
                    alignItems: 'center',
                    justifyContent: 'center',
                },
                deleteStrip: {
                    flexDirection: 'row',
                    justifyContent: 'flex-end',
                    alignItems: 'center',
                    gap: 8,
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderTopColor: colors.border,
                },
                stripButton: {
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    minHeight: 40,
                    paddingHorizontal: 12,
                    borderRadius: 10,
                },
                stripCancelText: {
                    color: colors.textSecondary,
                    fontSize: 14,
                    fontWeight: '600',
                },
                stripDeleteText: {
                    color: dangerColor(colors),
                    fontSize: 14,
                    fontWeight: '700',
                },
            }),
        [colors]
    );

/**
 * One Timeline entry: a mood NODE on the day's rail, and a calm card beside it.
 *
 * The rail makes a day's entries read as one connected run: the line enters a
 * node from above unless the entry is the first of its day, and leaves below
 * unless it is the last. The node carries the mood (number + a ring tinted with
 * the app's one mood ramp, `moodColor`), so the card itself needs no accent bar
 * and no "7/10" block and can spend its space on the time, activities, notes and
 * photos.
 *
 * Interaction: the card body IS the edit button ("Edit entry"). Star stays one
 * tap (it is state the user wants to see and flip). Delete is one step further
 * away, behind "More actions" — it is recoverable from the undo snackbar and the
 * bin, but a trash can on every card was the loudest thing on the screen and the
 * easiest to hit by accident. Action buttons are SIBLINGS of the body pressable,
 * never children: a Pressable is an accessibility container, and a button nested
 * inside one is unreachable to TalkBack.
 *
 * RECYCLED: FlashList re-uses this component's instance for a different entry
 * as the user scrolls, so the local "delete strip open" flag is
 * `useRecyclingState` keyed on the entry id — a plain useState would open the
 * strip on whatever entry recycled into a cell the user had opened.
 *
 * MEMOIZED (see the wrapper at the bottom): a parent re-render (a page append, a
 * spinner, a refresh) must not re-render every mounted card while the user is
 * flinging. Keep the props value-comparable.
 */
const EntryCardImpl: React.FC<EntryCardProps> = ({
    entry,
    isFirstOfDay = true,
    isLastOfDay = true,
    onEdit,
    onDelete,
    onToggleStar,
    colors,
}) => {
    const styles = useStyles(colors);
    const [actionsOpen, setActionsOpen] = useRecyclingState(false, [entry.id]);
    const ring = moodColor(entry.mood, colors.accent, colors.overlays.tagBorder);
    const time = formatTime(entry.date);
    // NULL/absent = not starred; any instant = starred. Filled star (accent)
    // vs outline (muted) — Feather has no filled star, so the star glyph comes
    // from MaterialCommunityIcons ('star' / 'star-outline').
    const starred = entry.starred_at != null;
    const hasPhotos = !!entry.photos && entry.photos.length > 0;
    const nodeCentre = NODE_TOP + NODE_SIZE / 2;

    return (
        <View style={styles.cell} testID={`entry-${entry.id}`}>
            <View style={styles.rail}>
                {!isFirstOfDay ? (
                    <View style={[styles.railLine, { top: 0, height: nodeCentre }]} />
                ) : null}
                {!isLastOfDay ? (
                    <View style={[styles.railLine, { top: nodeCentre, bottom: 0 }]} />
                ) : null}
                <View
                    testID="entry-mood-node"
                    style={[styles.node, { borderColor: ring }]}
                    accessibilityLabel={`Mood ${formatMood(entry.mood)} out of 10`}
                >
                    <View
                        style={[
                            StyleSheet.absoluteFill,
                            { borderRadius: NODE_SIZE / 2, backgroundColor: nodeFill(entry.mood, colors.accent) },
                        ]}
                    />
                    <Text style={styles.nodeText}>{formatMood(entry.mood)}</Text>
                </View>
            </View>

            <View style={styles.card}>
                <Pressable
                    style={({ pressed }) => [styles.body, pressed && styles.bodyPressed]}
                    onPress={() => onEdit(entry)}
                    accessibilityRole="button"
                    accessibilityLabel="Edit entry"
                    accessibilityHint={`Mood ${formatMood(entry.mood)} of 10${time ? `, ${time}` : ''}`}
                >
                    <View style={styles.timeRow}>
                        {time ? <Text style={styles.time}>{time}</Text> : null}
                    </View>
                    <ActivityRow activities={entry.activities} colors={colors} />
                    {entry.notes ? (
                        <Text style={styles.notes} numberOfLines={4}>
                            {entry.notes}
                        </Text>
                    ) : null}
                </Pressable>

                {hasPhotos ? (
                    <View style={styles.photos}>
                        <EntryPhotos photos={entry.photos!} colors={colors} />
                    </View>
                ) : null}

                {actionsOpen ? (
                    <View style={styles.deleteStrip}>
                        <Pressable
                            style={styles.stripButton}
                            onPress={() => setActionsOpen(false)}
                            accessibilityRole="button"
                            accessibilityLabel="Cancel"
                        >
                            <Text style={styles.stripCancelText}>Cancel</Text>
                        </Pressable>
                        <Pressable
                            testID="entry-delete"
                            style={styles.stripButton}
                            onPress={() => {
                                setActionsOpen(false);
                                onDelete(entry.id);
                            }}
                            accessibilityRole="button"
                            accessibilityLabel="Delete entry"
                        >
                            <Feather name="trash-2" color={dangerColor(colors)} size={16} />
                            <Text style={styles.stripDeleteText}>Delete</Text>
                        </Pressable>
                    </View>
                ) : null}

                <View style={styles.actions}>
                    <Pressable
                        testID="entry-star-toggle"
                        style={styles.iconButton}
                        onPress={() => onToggleStar(entry)}
                        accessibilityRole="button"
                        accessibilityLabel={starred ? 'Unstar entry' : 'Star entry'}
                        accessibilityState={{ selected: starred }}
                    >
                        <MaterialCommunityIcons
                            name={starred ? 'star' : 'star-outline'}
                            color={starred ? colors.accent : colors.textSecondary}
                            size={19}
                        />
                    </Pressable>
                    <Pressable
                        testID="entry-more"
                        style={styles.iconButton}
                        onPress={() => setActionsOpen((open) => !open)}
                        accessibilityRole="button"
                        accessibilityLabel="More actions"
                        accessibilityState={{ expanded: actionsOpen }}
                    >
                        <Feather name="more-horizontal" color={colors.textSecondary} size={19} />
                    </Pressable>
                </View>
            </View>
        </View>
    );
};

/**
 * Default shallow comparison is exactly right here: `entry` objects are replaced
 * wholesale when their row changes (the list never mutates one in place — an edit
 * or a star toggle maps to a NEW object, and a refresh re-uses the previous
 * object for every entry whose content did not change), `colors` is a
 * module-level constant per theme, the rail flags are booleans, and the three
 * callbacks are entry-agnostic so the Timeline can memoize them once. Guarded by
 * __tests__/timelineListPerf.test.tsx and entryCardMemo.test.tsx.
 */
export const EntryCard = React.memo(EntryCardImpl);
EntryCard.displayName = 'EntryCard';
