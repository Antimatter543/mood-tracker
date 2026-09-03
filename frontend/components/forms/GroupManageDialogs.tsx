import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

import { ThemeColors, useThemeColors } from '@/styles/global';
import type { GroupDeletionImpact } from '@/databases/groups';
import { ActivityGroup } from '../types';
import { OverlayModal } from '../OverlayModal';

/**
 * The two destructive-ish group dialogs: RENAME and DELETE.
 *
 * Both render through `OverlayModal` — react-native's `<Modal>` is banned in
 * this app (broken touch dispatch on Fabric; see the project CLAUDE.md).
 *
 * Both are CONTROLLED: the parent owns the async DB call and feeds `error` /
 * `busy` back down, so the dialogs stay pure presentation and the parent keeps
 * one place that knows how to reload after a write.
 */

/** Shared danger red — the one colour the theme deliberately does not own. */
const DANGER = '#ff6b6b';

type GroupRenameDialogProps = {
    visible: boolean;
    /** The group being renamed (null while closed). */
    group: ActivityGroup | null;
    onClose: () => void;
    /** Submit the trimmed-on-the-DB-side name. Parent handles the write. */
    onSubmit: (name: string) => void;
    /** Validation/DB error from the parent's last submit ('' = none). */
    error: string;
};

export const GroupRenameDialog = ({
    visible,
    group,
    onClose,
    onSubmit,
    error,
}: GroupRenameDialogProps) => {
    const colors = useThemeColors();
    const styles = useStyles(colors);
    const [name, setName] = useState(group?.name ?? '');

    // Prop-to-state sync: re-seed the field whenever a DIFFERENT group is opened
    // (or the dialog is re-opened), so it never shows the previous group's name.
    // Deliberate and guarded — react-hooks 7.x's set-state-in-effect rule is
    // downgraded to a warning project-wide, same as ActivityEditModal.
    useEffect(() => {
        if (visible && group) {
            setName(group.name);
        }
    }, [visible, group]);

    return (
        <OverlayModal visible={visible} onClose={onClose}>
            <View style={styles.card}>
                <View style={styles.headerRow}>
                    <Text style={styles.title}>Rename group</Text>
                    <Pressable
                        style={styles.closeButton}
                        onPress={onClose}
                        accessibilityRole="button"
                        accessibilityLabel="Close rename group"
                    >
                        <Ionicons name="close" color={colors.text} size={24} />
                    </Pressable>
                </View>

                <TextInput
                    style={styles.input}
                    placeholder="Group name"
                    placeholderTextColor={colors.textSecondary}
                    value={name}
                    onChangeText={setName}
                    autoFocus
                    accessibilityLabel="Group name"
                />

                {error ? <Text style={styles.errorText}>{error}</Text> : null}

                <Pressable
                    style={styles.primaryButton}
                    onPress={() => onSubmit(name)}
                    accessibilityRole="button"
                    accessibilityLabel="Save group name"
                >
                    <Text style={styles.primaryButtonText}>Save</Text>
                </Pressable>
            </View>
        </OverlayModal>
    );
};

type GroupDeleteDialogProps = {
    visible: boolean;
    group: ActivityGroup | null;
    /** What the delete would destroy (null while still being measured). */
    impact: GroupDeletionImpact | null;
    /** Every OTHER group — the possible destinations for the safe alternative. */
    otherGroups: ActivityGroup[];
    /** Move all of this group's activities into `targetGroupId` instead of deleting. */
    onMoveActivities: (targetGroupId: number) => void;
    onConfirmDelete: () => void;
    onClose: () => void;
    /** Error from the parent's last move/delete attempt ('' = none). */
    error: string;
};

/**
 * Human-readable statement of exactly what a delete destroys.
 *
 * Exported and pure so the wording is unit-testable without mounting anything —
 * this copy is the ONLY thing standing between a user and irreversibly losing
 * activity history, so its edge cases (empty group, unused activities,
 * singular/plural) are worth pinning down in tests.
 */
export function describeGroupDeletion(impact: GroupDeletionImpact | null): string {
    if (!impact || !impact.exists) {
        return 'Checking what this would delete…';
    }

    const { activityCount, entryCount } = impact;

    if (activityCount === 0) {
        return 'This group is empty, so deleting it affects nothing else.';
    }

    const activities = `${activityCount} ${activityCount === 1 ? 'activity' : 'activities'}`;

    if (entryCount === 0) {
        return `This permanently deletes ${activities}. They aren't used in any entries yet.`;
    }

    const entries = `${entryCount} ${entryCount === 1 ? 'entry' : 'entries'}`;
    return `This permanently deletes ${activities} and removes their history from ${entries}. Your ${entryCount === 1 ? 'entry stays' : 'entries stay'}, but those activity tags are gone for good.`;
}

export const GroupDeleteDialog = ({
    visible,
    group,
    impact,
    otherGroups,
    onMoveActivities,
    onConfirmDelete,
    onClose,
    error,
}: GroupDeleteDialogProps) => {
    const colors = useThemeColors();
    const styles = useStyles(colors);

    // The safe alternative is only offered when it's actually possible: there
    // must be something to save AND somewhere to put it.
    const canOfferMove = !!impact?.exists && impact.activityCount > 0 && otherGroups.length > 0;

    return (
        <OverlayModal visible={visible} onClose={onClose}>
            <View style={styles.card}>
                <View style={styles.headerRow}>
                    <Text style={styles.title} numberOfLines={2}>
                        Delete &ldquo;{group?.name ?? ''}&rdquo;?
                    </Text>
                    <Pressable
                        style={styles.closeButton}
                        onPress={onClose}
                        accessibilityRole="button"
                        accessibilityLabel="Close delete group"
                    >
                        <Ionicons name="close" color={colors.text} size={24} />
                    </Pressable>
                </View>

                <Text style={styles.warningText}>{describeGroupDeletion(impact)}</Text>

                {canOfferMove ? (
                    <View style={styles.moveSection}>
                        <Text style={styles.moveHeading}>Keep them instead</Text>
                        <Text style={styles.moveHint}>
                            Move this group&rsquo;s activities into another group first — their
                            history comes with them.
                        </Text>
                        <ScrollView
                            style={styles.moveList}
                            contentContainerStyle={styles.moveListContent}
                        >
                            {otherGroups.map((target) => (
                                <Pressable
                                    key={target.id}
                                    style={styles.moveRow}
                                    onPress={() => onMoveActivities(target.id)}
                                    accessibilityRole="button"
                                    accessibilityLabel={`Move activities to ${target.name}`}
                                >
                                    <MaterialIcons
                                        name="drive-file-move"
                                        size={18}
                                        color={colors.text}
                                    />
                                    <Text style={styles.moveRowText} numberOfLines={1}>
                                        {target.name}
                                    </Text>
                                </Pressable>
                            ))}
                        </ScrollView>
                    </View>
                ) : null}

                {error ? <Text style={styles.errorText}>{error}</Text> : null}

                <View style={styles.buttonRow}>
                    <Pressable
                        style={[styles.button, styles.cancelButton]}
                        onPress={onClose}
                        accessibilityRole="button"
                        accessibilityLabel="Cancel deleting group"
                    >
                        <Text style={styles.buttonText}>Cancel</Text>
                    </Pressable>
                    <Pressable
                        style={[styles.button, styles.deleteButton]}
                        onPress={onConfirmDelete}
                        accessibilityRole="button"
                        accessibilityLabel="Delete group"
                    >
                        <Text style={[styles.buttonText, styles.deleteButtonText]}>
                            Delete group
                        </Text>
                    </Pressable>
                </View>
            </View>
        </OverlayModal>
    );
};

const useStyles = (colors: ThemeColors) =>
    useMemo(
        () =>
            StyleSheet.create({
                card: {
                    backgroundColor: colors.cardBackground,
                    width: '92%',
                    maxWidth: 480,
                    maxHeight: '85%',
                    borderRadius: 16,
                    padding: 20,
                    gap: 16,
                },
                headerRow: {
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 8,
                },
                title: {
                    color: colors.text,
                    fontSize: 20,
                    fontWeight: 'bold',
                    flexShrink: 1,
                },
                closeButton: {
                    padding: 4,
                },
                input: {
                    backgroundColor: colors.overlays.tag,
                    borderRadius: 8,
                    padding: 12,
                    color: colors.text,
                    fontSize: 16,
                    borderWidth: 1,
                    borderColor: colors.overlays.tagBorder,
                },
                errorText: {
                    color: DANGER,
                    fontSize: 14,
                },
                primaryButton: {
                    backgroundColor: colors.accent,
                    padding: 12,
                    borderRadius: 8,
                    alignItems: 'center',
                },
                primaryButtonText: {
                    color: '#fff',
                    fontSize: 16,
                    fontWeight: '600',
                },
                warningText: {
                    color: colors.text,
                    fontSize: 15,
                    lineHeight: 21,
                },
                moveSection: {
                    gap: 6,
                    padding: 12,
                    borderRadius: 12,
                    backgroundColor: colors.overlays.tag,
                    borderWidth: 1,
                    borderColor: colors.overlays.tagBorder,
                },
                moveHeading: {
                    color: colors.text,
                    fontSize: 15,
                    fontWeight: '600',
                },
                moveHint: {
                    color: colors.textSecondary,
                    fontSize: 13,
                    lineHeight: 18,
                },
                moveList: {
                    maxHeight: 180,
                    marginTop: 4,
                },
                moveListContent: {
                    gap: 4,
                },
                moveRow: {
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    paddingVertical: 12,
                    paddingHorizontal: 10,
                    borderRadius: 8,
                    backgroundColor: colors.cardBackground,
                },
                moveRowText: {
                    color: colors.text,
                    fontSize: 15,
                    flexShrink: 1,
                },
                buttonRow: {
                    flexDirection: 'row',
                    gap: 8,
                },
                button: {
                    flex: 1,
                    minWidth: 96,
                    padding: 12,
                    borderRadius: 8,
                    alignItems: 'center',
                },
                cancelButton: {
                    backgroundColor: colors.overlays.tag,
                },
                deleteButton: {
                    backgroundColor: 'rgba(255, 107, 107, 0.2)',
                },
                buttonText: {
                    color: colors.text,
                    fontSize: 16,
                    fontWeight: '600',
                },
                deleteButtonText: {
                    color: DANGER,
                },
            }),
        [colors]
    );
