import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Pressable,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Feather from '@expo/vector-icons/Feather';
import { useSQLiteContext } from 'expo-sqlite';

import { OverlayModal } from '@/components/OverlayModal';
import { ThemeColors, useThemeColors } from '@/styles/global';
import {
    BIN_RETENTION_DAYS,
    BinnedEntry,
    getBinnedEntries,
    purgeMoodEntry,
    restoreMoodEntry,
} from '@/databases/entry-bin';
import { moodColor } from './moodColor';
import { describeBinRow } from './binCopy';

/**
 * "Recently deleted" — the recycle-bin view, reached from the bin button in the
 * Timeline's search bar.
 *
 * Rendered as a full-screen IN-TREE overlay (`OverlayModal fullScreen`), not a
 * route and never a react-native `<Modal>`: the app bans native modals (broken
 * touch dispatch on Fabric — see context/OverlayHost.tsx), and a full-screen
 * overlay keeps the bin a transient detour off the Timeline rather than a tab or
 * a back-stack entry. `OverlayModal` already wires Android hardware-back to
 * `onClose`, so back closes the panel instead of leaving the tab.
 *
 * Every mutation reloads from the DB (rather than patching local state) and tells
 * the Timeline to refetch via `onChanged`, so restoring an entry can never leave
 * the two lists disagreeing about what exists.
 */

type RecentlyDeletedPanelProps = {
    visible: boolean;
    onClose: () => void;
    /** Fired after a restore/purge so the Timeline (and its bin badge) refresh. */
    onChanged: () => void;
};

const useStyles = (colors: ThemeColors, insetTop: number, insetBottom: number) =>
    useMemo(
        () =>
            StyleSheet.create({
                // Opaque, full-window: this is a panel, not a dialog — nothing of
                // the Timeline should show through behind it.
                root: {
                    flex: 1,
                    backgroundColor: colors.background,
                    paddingTop: insetTop,
                },
                header: {
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                    paddingHorizontal: 8,
                    paddingRight: 16,
                    paddingVertical: 8,
                },
                closeButton: {
                    padding: 8,
                },
                headerTitle: {
                    flex: 1,
                    color: colors.text,
                    fontSize: 18,
                    fontWeight: '700',
                    letterSpacing: -0.3,
                },
                retentionNote: {
                    color: colors.textSecondary,
                    fontSize: 13,
                    lineHeight: 18,
                    paddingHorizontal: 16,
                    paddingBottom: 12,
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: colors.border,
                },
                listContent: {
                    padding: 16,
                    paddingBottom: insetBottom + 32,
                },
                centered: {
                    flex: 1,
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingHorizontal: 40,
                },
                emptyTitle: {
                    color: colors.text,
                    fontSize: 17,
                    fontWeight: '600',
                    marginTop: 16,
                    textAlign: 'center',
                },
                emptyBody: {
                    color: colors.textSecondary,
                    fontSize: 14,
                    lineHeight: 20,
                    marginTop: 8,
                    textAlign: 'center',
                },
                linkButton: {
                    marginTop: 16,
                    paddingVertical: 8,
                    paddingHorizontal: 16,
                },
                linkText: {
                    color: colors.accent,
                    fontSize: 15,
                    fontWeight: '600',
                },
                // Row card. The mood accent bar mirrors the Timeline's EntryCard so
                // a binned entry is recognisably the same object, just muted.
                row: {
                    backgroundColor: colors.cardBackground,
                    borderRadius: 16,
                    marginBottom: 12,
                    overflow: 'hidden',
                },
                accentBar: {
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: 4,
                },
                rowBody: {
                    padding: 14,
                    paddingLeft: 18,
                },
                rowTop: {
                    flexDirection: 'row',
                    alignItems: 'baseline',
                    gap: 8,
                },
                mood: {
                    color: colors.text,
                    fontSize: 20,
                    fontWeight: '700',
                },
                moodOutOf: {
                    color: colors.textSecondary,
                    fontSize: 12,
                    marginLeft: -6,
                },
                loggedAt: {
                    flex: 1,
                    color: colors.textSecondary,
                    fontSize: 13,
                    textAlign: 'right',
                },
                notes: {
                    color: colors.text,
                    fontSize: 14,
                    lineHeight: 20,
                    marginTop: 8,
                },
                activities: {
                    color: colors.textSecondary,
                    fontSize: 13,
                    marginTop: 6,
                },
                binMeta: {
                    color: colors.textSecondary,
                    fontSize: 12,
                    marginTop: 10,
                },
                actions: {
                    flexDirection: 'row',
                    gap: 8,
                    marginTop: 12,
                },
                actionButton: {
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    paddingVertical: 8,
                    paddingHorizontal: 14,
                    borderRadius: 999,
                    borderWidth: StyleSheet.hairlineWidth,
                },
                restoreButton: {
                    backgroundColor: colors.accentLight,
                    borderColor: colors.accent,
                },
                restoreText: {
                    color: colors.accent,
                    fontSize: 13,
                    fontWeight: '600',
                },
                purgeButton: {
                    backgroundColor: colors.overlays.tag,
                    borderColor: colors.overlays.tagBorder,
                },
                purgeText: {
                    color: colors.textSecondary,
                    fontSize: 13,
                    fontWeight: '600',
                },
            }),
        [colors, insetTop, insetBottom]
    );

/** "13 Jul 2026, 9:05 AM" — the entry's own timestamp, not the deletion's. */
const formatLoggedAt = (iso: string): string => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString(undefined, {
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
    });
};

export function RecentlyDeletedPanel({
    visible,
    onClose,
    onChanged,
}: RecentlyDeletedPanelProps) {
    return (
        <OverlayModal visible={visible} onClose={onClose} fullScreen>
            <RecentlyDeletedContent onClose={onClose} onChanged={onChanged} />
        </OverlayModal>
    );
}

/**
 * Split out so all the state + the DB read live in a component that only exists
 * WHILE the panel is open: closing it unmounts this, so the next open always
 * starts from a fresh load rather than showing a stale bin.
 */
function RecentlyDeletedContent({
    onClose,
    onChanged,
}: {
    onClose: () => void;
    onChanged: () => void;
}) {
    const colors = useThemeColors();
    const insets = useSafeAreaInsets();
    const styles = useStyles(colors, insets.top, insets.bottom);
    const db = useSQLiteContext();

    const [entries, setEntries] = useState<BinnedEntry[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    // A failed read must NOT render the reassuring "Your bin is empty" over a bin
    // that still holds the user's entries — same rule the Timeline follows.
    const [loadError, setLoadError] = useState(false);

    const load = useCallback(async () => {
        setIsLoading(true);
        try {
            setEntries(await getBinnedEntries(db));
            setLoadError(false);
        } catch (error) {
            console.error('Error loading the recycle bin:', error);
            setLoadError(true);
        } finally {
            setIsLoading(false);
        }
    }, [db]);

    useEffect(() => {
        load();
    }, [load]);

    const handleRestore = useCallback(
        async (entry: BinnedEntry) => {
            const result = await restoreMoodEntry(db, entry.id);
            if (!result.success) {
                Alert.alert("Couldn't restore entry", result.message);
                return;
            }
            await load();
            onChanged();
        },
        [db, load, onChanged]
    );

    const handlePurge = useCallback(
        (entry: BinnedEntry) => {
            // Irreversible AND it takes the photos off disk — always confirm.
            Alert.alert(
                'Delete forever?',
                'This entry and its photos will be permanently deleted. This cannot be undone.',
                [
                    { text: 'Cancel', style: 'cancel' },
                    {
                        text: 'Delete forever',
                        style: 'destructive',
                        onPress: async () => {
                            const result = await purgeMoodEntry(db, entry.id);
                            if (!result.success) {
                                Alert.alert("Couldn't delete entry", result.message);
                                return;
                            }
                            await load();
                            onChanged();
                        },
                    },
                ]
            );
        },
        [db, load, onChanged]
    );

    // ONE `now` for the whole list so every row's countdown is computed against
    // the same instant (rows rendering either side of a tick would otherwise
    // disagree), re-derived whenever the list reloads.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `entries` is the intended re-derive trigger, not an input to the factory
    const now = useMemo(() => new Date(), [entries]);

    const renderItem = useCallback(
        ({ item }: { item: BinnedEntry }) => {
            const accent = moodColor(item.mood, colors.accent, colors.overlays.tag);
            const loggedAt = formatLoggedAt(item.date);
            return (
                <View style={styles.row} testID={`bin-entry-${item.id}`}>
                    <View style={[styles.accentBar, { backgroundColor: accent }]} />
                    <View style={styles.rowBody}>
                        <View style={styles.rowTop}>
                            <Text style={styles.mood}>{item.mood}</Text>
                            <Text style={styles.moodOutOf}>/10</Text>
                            {loggedAt ? (
                                <Text style={styles.loggedAt}>{loggedAt}</Text>
                            ) : null}
                        </View>

                        {item.notes ? (
                            <Text style={styles.notes} numberOfLines={3}>
                                {item.notes}
                            </Text>
                        ) : null}

                        {item.activityNames.length > 0 ? (
                            <Text style={styles.activities} numberOfLines={1}>
                                {item.activityNames.join(' · ')}
                            </Text>
                        ) : null}

                        <Text style={styles.binMeta}>
                            {describeBinRow(item.deleted_at, now, BIN_RETENTION_DAYS)}
                        </Text>

                        <View style={styles.actions}>
                            <Pressable
                                testID={`bin-restore-${item.id}`}
                                onPress={() => handleRestore(item)}
                                accessibilityRole="button"
                                accessibilityLabel="Restore entry"
                                style={[styles.actionButton, styles.restoreButton]}
                            >
                                <Feather name="rotate-ccw" size={14} color={colors.accent} />
                                <Text style={styles.restoreText}>Restore</Text>
                            </Pressable>
                            <Pressable
                                testID={`bin-purge-${item.id}`}
                                onPress={() => handlePurge(item)}
                                accessibilityRole="button"
                                accessibilityLabel="Delete entry forever"
                                style={[styles.actionButton, styles.purgeButton]}
                            >
                                <Feather name="trash-2" size={14} color={colors.textSecondary} />
                                <Text style={styles.purgeText}>Delete forever</Text>
                            </Pressable>
                        </View>
                    </View>
                </View>
            );
        },
        [colors, styles, now, handleRestore, handlePurge]
    );

    return (
        <View style={styles.root}>
            <View style={styles.header}>
                <Pressable
                    testID="bin-close"
                    onPress={onClose}
                    accessibilityRole="button"
                    accessibilityLabel="Close recently deleted"
                    style={styles.closeButton}
                    hitSlop={8}
                >
                    <Feather name="arrow-left" size={22} color={colors.text} />
                </Pressable>
                <Text style={styles.headerTitle}>Recently deleted</Text>
            </View>
            {/* One interpolated string, not text + {expr} + text: React Native
                would otherwise split it into three Text children, which reads as
                three fragments to a screen reader. */}
            <Text style={styles.retentionNote}>
                {`Entries you delete stay here for ${BIN_RETENTION_DAYS} days, then they're deleted for good.`}
            </Text>

            {isLoading ? (
                <View style={styles.centered}>
                    <ActivityIndicator size="large" color={colors.accent} />
                </View>
            ) : loadError ? (
                <View style={styles.centered}>
                    <Feather name="alert-circle" size={32} color={colors.textSecondary} />
                    <Text style={styles.emptyTitle}>Couldn&apos;t load your bin</Text>
                    <Pressable
                        testID="bin-retry"
                        onPress={load}
                        accessibilityRole="button"
                        accessibilityLabel="Try again"
                        style={styles.linkButton}
                    >
                        <Text style={styles.linkText}>Try again</Text>
                    </Pressable>
                </View>
            ) : entries.length === 0 ? (
                <View style={styles.centered} testID="bin-empty">
                    <Feather name="trash-2" size={32} color={colors.textSecondary} />
                    <Text style={styles.emptyTitle}>Nothing here</Text>
                    <Text style={styles.emptyBody}>
                        {`Deleted entries land here for ${BIN_RETENTION_DAYS} days, so an accidental tap is never the end of the story.`}
                    </Text>
                </View>
            ) : (
                <FlatList
                    data={entries}
                    keyExtractor={(item) => String(item.id)}
                    renderItem={renderItem}
                    contentContainerStyle={styles.listContent}
                />
            )}
        </View>
    );
}
