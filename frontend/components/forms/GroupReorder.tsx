import { useCallback, useMemo } from 'react';
import { StyleSheet, Text, View, Pressable } from 'react-native';
import type { AnimatedRef } from 'react-native-reanimated';
import type Animated from 'react-native-reanimated';
import Sortable, { type SortableGridDragEndParams } from 'react-native-sortables';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

import { ThemeColors, useThemeColors } from '@/styles/global';
import { hapticDragEnd, hapticDragStart, hapticReorderTick } from '@/lib/haptics';
import { ActivityGroup } from '../types';

/**
 * GROUP MOVE MODE — the collapsed, drag-to-reorder view of activity groups.
 *
 * Entered by LONG-PRESSING a group's name in ActivitySelector. Everything else
 * (the activity chips, the add-group button) disappears and the screen collapses
 * to just the group name rows, so a whole reorder is one uninterrupted gesture
 * instead of scrolling past dozens of chips between drops. `Done` exits.
 *
 * WHY the long-press is safe HERE but not on an activity chip: the chips live
 * INSIDE a `Sortable.Grid`, whose 300ms drag activation cancels any Pressable
 * long-press on the same element (see tasks/lessons.md, 2026-06-12 — "A
 * Sortable.Grid chip can't ALSO host a long-press-to-edit"). A group's name row
 * sits in the group HEADER, outside every grid, so nothing competes for the
 * hold. In move mode the rows ARE inside a grid, but they host no long-press of
 * their own — drag owns the gesture outright.
 *
 * The new order PERSISTS ON DROP (not on `Done`), matching how the activity
 * chip grid already behaves: what you see after releasing is what's stored.
 * `Done` is therefore only an exit, never a save — so backing out of move mode
 * can never silently discard a move the user watched happen.
 *
 * Haptics come from our own guarded `lib/haptics` rather than the library's
 * `hapticsEnabled` prop: that adapter targets `react-native-haptic-feedback`,
 * which this app does not depend on, so it would silently do nothing.
 */
type GroupReorderProps = {
    /** Groups in their current display order. */
    groups: ActivityGroup[];
    /** Persist a new order (called on every drop, with the fully reordered array). */
    onReorder: (groups: ActivityGroup[]) => void;
    /** Leave move mode. */
    onDone: () => void;
    /** Enclosing scroll container, so a drag near an edge auto-scrolls the form. */
    scrollableRef?: AnimatedRef<Animated.ScrollView>;
};

export const GroupReorder = ({ groups, onReorder, onDone, scrollableRef }: GroupReorderProps) => {
    const colors = useThemeColors();
    const styles = useStyles(colors);

    const handleDragStart = useCallback(() => {
        hapticDragStart();
    }, []);

    const handleOrderChange = useCallback(() => {
        hapticReorderTick();
    }, []);

    const handleDragEnd = useCallback(
        ({ data }: SortableGridDragEndParams<ActivityGroup>) => {
            hapticDragEnd();
            onReorder(data);
        },
        [onReorder]
    );

    const keyExtractor = useCallback((item: ActivityGroup) => String(item.id), []);

    const renderGroup = useCallback(
        ({ item }: { item: ActivityGroup }) => (
            <View style={styles.row} accessibilityLabel={`Drag ${item.name} to reorder`}>
                <MaterialIcons name="drag-handle" size={22} color={colors.textSecondary} />
                <Text style={styles.rowText} numberOfLines={1}>
                    {item.name}
                </Text>
            </View>
        ),
        [styles, colors]
    );

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <View style={styles.headerText}>
                    <Text style={styles.title}>Reorder groups</Text>
                    <Text style={styles.hint}>Hold a group, then drag it up or down.</Text>
                </View>
                <Pressable
                    style={styles.doneButton}
                    onPress={onDone}
                    accessibilityRole="button"
                    accessibilityLabel="Done reordering groups"
                >
                    <Text style={styles.doneText}>Done</Text>
                </Pressable>
            </View>

            {groups.length === 0 ? (
                <Text style={styles.empty}>No groups to reorder yet.</Text>
            ) : (
                <Sortable.Grid
                    data={groups}
                    renderItem={renderGroup}
                    keyExtractor={keyExtractor}
                    columns={1}
                    rowGap={8}
                    onDragStart={handleDragStart}
                    onOrderChange={handleOrderChange}
                    onDragEnd={handleDragEnd}
                    // Shorter than the chip grid's 300ms: here dragging is the ONLY
                    // thing a row does, so there is no tap to protect and a snappier
                    // pickup feels responsive rather than accidental.
                    dragActivationDelay={150}
                    scrollableRef={scrollableRef}
                    autoScrollEnabled={!!scrollableRef}
                />
            )}
        </View>
    );
};

const useStyles = (colors: ThemeColors) =>
    useMemo(
        () =>
            StyleSheet.create({
                container: {
                    marginHorizontal: 16,
                    marginTop: 8,
                    gap: 12,
                },
                header: {
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                },
                headerText: {
                    flexShrink: 1,
                    gap: 2,
                },
                title: {
                    color: colors.text,
                    fontSize: 16,
                    fontWeight: '600',
                },
                hint: {
                    color: colors.textSecondary,
                    fontSize: 13,
                },
                doneButton: {
                    paddingVertical: 8,
                    paddingHorizontal: 16,
                    borderRadius: 20,
                    backgroundColor: colors.accent,
                },
                doneText: {
                    color: '#fff',
                    fontSize: 14,
                    fontWeight: '600',
                },
                row: {
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    paddingVertical: 16,
                    paddingHorizontal: 14,
                    borderRadius: 12,
                    backgroundColor: colors.overlays.tag,
                    borderWidth: 1,
                    borderColor: colors.overlays.tagBorder,
                },
                rowText: {
                    color: colors.text,
                    fontSize: 16,
                    fontWeight: '500',
                    flexShrink: 1,
                },
                empty: {
                    color: colors.textSecondary,
                    fontSize: 14,
                },
            }),
        [colors]
    );

export default GroupReorder;
