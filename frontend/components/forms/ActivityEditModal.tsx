// ActivityEditModal.tsx
import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Alert, ScrollView } from 'react-native';
import { useThemeColors } from '@/styles/global';
import { SQLiteDatabase } from 'expo-sqlite';
import Ionicons from '@expo/vector-icons/Ionicons';
import { updateActivity, deleteActivity, moveActivityToGroup } from "@/databases/database";
import { Activity, ActivityGroup } from '../types';
import { useDataContext } from '@/context/DataContext';
import { IconPicker } from '../IconPicker';
import { IconFamilyType } from '../iconRegistry';
import { OverlayModal } from '../OverlayModal';
import { ActivityIcon } from '../activityIcon';
import { GroupPickerField } from './GroupPickerField';
import { useDialogFit } from './dialogFit';

type ActivityEditModalProps = {
    visible: boolean;
    activity: Activity | null;
    onClose: () => void;
    onUpdate: () => void;
    db: SQLiteDatabase;
    /**
     * All activity groups, already in display order (from getActivityGroups).
     * Powers the "move to another group" picker.
     */
    groups: ActivityGroup[];
};

export const ActivityEditModal: React.FC<ActivityEditModalProps> = ({
    visible,
    activity,
    onClose,
    onUpdate,
    db,
    groups
}) => {
    const colors = useThemeColors();
    const { keyboardOpen, cardStyle } = useDialogFit();
    const [activityName, setActivityName] = useState(activity?.name || '');
    const [error, setError] = useState('');
    const { refetchEntries } = useDataContext();  // Get refetchEntries from context

    const [iconPickerVisible, setIconPickerVisible] = useState(false);
    const [selectedIconFamily, setSelectedIconFamily] = useState<IconFamilyType>(
        (activity?.icon_family as IconFamilyType) || 'Feather'
    );
    const [selectedIconName, setSelectedIconName] = useState(activity?.icon_name || 'circle');

    const [selectedGroupId, setSelectedGroupId] = useState<number | null>(
        activity?.group_id ?? null
    );

    // Update state when activity changes or modal becomes visible. Deliberate
    // prop-to-state sync (re-seed the editable fields when a different activity
    // is opened); guarded, runs only on prop change. (react-hooks 7.x's
    // set-state-in-effect rule is downgraded to a warning project-wide.)
    useEffect(() => {
        if (activity && visible) {
            setActivityName(activity.name);
            setSelectedIconFamily(activity.icon_family as IconFamilyType);
            setSelectedIconName(activity.icon_name);
            setSelectedGroupId(activity.group_id);
        }
    }, [activity, visible]);

    // Reset error when modal closes (prop-to-state sync; see note above).
    useEffect(() => {
        if (!visible) {
            setError('');
        }
    }, [visible]);

    const handleUpdate = async () => {
        if (!activity) return;

        const result = await updateActivity(
            db, activity.id, activityName, selectedIconFamily, selectedIconName
        );

        if (!result.success) {
            setError(result.message);
            return;
        }

        // The move (if any) happens AFTER the rename, never before: updateActivity
        // validates the new name against the activity's CURRENT group, while
        // moveActivityToGroup re-reads the name from the DB and validates it
        // against the TARGET group. Moving first would validate the stale
        // (pre-rename) name against the target group instead of the name the user
        // actually just saved.
        if (selectedGroupId !== null && selectedGroupId !== activity.group_id) {
            const moveResult = await moveActivityToGroup(db, activity.id, selectedGroupId);
            if (!moveResult.success) {
                // The rename DID land, so the caller must still refresh — but leave
                // the dialog open (don't call onClose) so the user sees the group
                // did not change and can retry or pick a different one.
                onUpdate();
                setError(moveResult.message);
                return;
            }
        }

        onUpdate();
        onClose();
        refetchEntries();
    };

    const checkUsageAndConfirmDelete = async () => {
        if (!activity) return;

        try {
            // Get usage count. Scoped to LIVE entries (`e.deleted_at IS NULL`):
            // the number in the confirm dialog has to match what the user can
            // actually SEE, so counting recycle-bin entries here would read as a
            // bug ("used in 5 entries" over a timeline showing 3). Deleting the
            // activity does also strip the links off binned entries — a minor,
            // accepted effect of an already-destructive action.
            const usage = await db.getFirstAsync<{ count: number }>(
                `SELECT COUNT(*) as count
                 FROM entry_activities ea
                 JOIN entries e ON e.id = ea.entry_id
                 WHERE e.deleted_at IS NULL AND ea.activity_id = ?`,
                [activity.id]
            );

            const usageCount = usage?.count || 0;
            const usageMessage = usageCount > 0
                ? `This activity is used in ${usageCount} entries. These references will be removed.`
                : 'This activity is not used in any entries.';

            Alert.alert(
                'Delete Activity',
                `Are you sure you want to delete "${activity.name}"?\n\n${usageMessage}`,
                [
                    {
                        text: 'Cancel',
                        style: 'cancel'
                    },
                    {
                        text: 'Delete',
                        style: 'destructive',
                        onPress: async () => {
                            const result = await deleteActivity(db, activity.id);
                            if (result.success) {
                                onUpdate();
                                onClose();
                                refetchEntries();
                            } else {
                                setError(result.message);
                            }
                        }
                    }
                ]
            );
        } catch (error) {
            console.error('Error checking activity usage:', error);
            setError('Error checking activity usage');
        }
    };

    const styles = StyleSheet.create({
        modalContent: {
            backgroundColor: colors.cardBackground,
            width: '94%',
            maxWidth: 560,
            borderRadius: 16,
            padding: 24,
            gap: 20,
        },
        modalHeader: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
        },
        title: {
            color: colors.text,
            fontSize: 20,
            fontWeight: 'bold',
        },
        closeButton: {
            padding: 4,
        },
        // Hugs its fields when they fit, shrinks (and scrolls) when the card runs
        // out of room above the keyboard.
        body: {
            flexGrow: 0,
            flexShrink: 1,
        },
        bodyContent: {
            gap: 20,
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
        actions: {
            gap: 12,
        },
        errorText: {
            color: '#ff4444',
            fontSize: 14,
        },
        buttonContainer: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            gap: 8,
        },
        button: {
            flex: 1,
            // A floor so each action button never collapses narrower than its
            // label, even if the row were ever cramped (the two labels are short;
            // 96px comfortably fits "Delete"/"Update" at large font scale). Pairs
            // with flex:1 to split the row evenly when there's room.
            minWidth: 96,
            minHeight: 48,
            padding: 12,
            borderRadius: 8,
            alignItems: 'center',
            justifyContent: 'center',
        },
        updateButton: {
            backgroundColor: colors.accent,
        },
        deleteButton: {
            backgroundColor: 'rgba(255, 68, 68, 0.2)',
        },
        buttonText: {
            color: colors.text,
            fontSize: 16,
            fontWeight: '600',
        },
        deleteButtonText: {
            color: '#ff4444',
        },
        iconSelector: {
            flexDirection: 'row',
            alignItems: 'center',
            minHeight: 48,
            backgroundColor: colors.overlays.tag,
            padding: 12,
            borderRadius: 8,
            gap: 8,
        },
        iconSelectorText: {
            color: colors.text,
            fontSize: 16,
        },
        label: {
            color: colors.text,
            fontSize: 16,
            fontWeight: '500',
            marginBottom: 8,
        },
    });

    // Error + Delete / Update. Pinned under the fields while the keyboard is
    // closed; at the end of the scrolling fields while it is open, so on a short
    // screen or a large font the fields get the whole card and the name being
    // typed is never cropped (#51 device QA, 360x640 at font 1.3).
    const actions = (
        <View testID="activity-edit-actions" style={styles.actions}>
            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            <View style={styles.buttonContainer}>
                <Pressable
                    style={[styles.button, styles.deleteButton]}
                    onPress={checkUsageAndConfirmDelete}
                    accessibilityRole="button"
                >
                    <Text style={[styles.buttonText, styles.deleteButtonText]}>
                        Delete
                    </Text>
                </Pressable>

                <Pressable
                    style={[styles.button, styles.updateButton]}
                    onPress={handleUpdate}
                    accessibilityRole="button"
                >
                    <Text style={styles.buttonText}>Update</Text>
                </Pressable>
            </View>
        </View>
    );

    return (
        <OverlayModal visible={visible} onClose={onClose}>
            <View testID="activity-edit-dialog" style={[styles.modalContent, cardStyle]}>
                <View style={styles.modalHeader}>
                    <Text style={styles.title}>Edit Activity</Text>
                    <Pressable
                        style={styles.closeButton}
                        onPress={onClose}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel="Close without saving"
                    >
                        <Ionicons name="close" color={colors.text} size={24} />
                    </Pressable>
                </View>

                {/* The card shrinks to the room the overlay gives it and the
                    fields scroll. The header always stays put; the actions stay
                    put only while the keyboard is closed (see useDialogFit). */}
                <ScrollView
                    testID="activity-edit-fields"
                    style={styles.body}
                    contentContainerStyle={styles.bodyContent}
                    keyboardShouldPersistTaps="handled"
                >
                    <TextInput
                        style={styles.input}
                        placeholder="Activity Name"
                        placeholderTextColor={colors.textSecondary}
                        value={activityName}
                        onChangeText={(text) => {
                            setActivityName(text);
                            setError('');
                        }}
                        accessibilityLabel="Activity name"
                        autoFocus={true}
                    />

                    <View>
                        <Text style={styles.label}>Icon</Text>
                        <Pressable
                            style={styles.iconSelector}
                            onPress={() => setIconPickerVisible(true)}
                            accessibilityRole="button"
                            accessibilityLabel="Change icon"
                        >
                            <ActivityIcon
                                iconName={selectedIconName}
                                iconFamily={selectedIconFamily}
                                color={colors.text}
                                size={24}
                            />
                            <Text style={styles.iconSelectorText}>Change Icon</Text>
                        </Pressable>
                    </View>

                    {/* Move this activity into another group. Local state only;
                        nothing is written until Update is pressed (see
                        handleUpdate for the write ordering). */}
                    <GroupPickerField
                        groups={groups}
                        selectedGroupId={selectedGroupId}
                        onSelect={setSelectedGroupId}
                        triggerLabel="Move activity to another group"
                        optionLabel={(group) => `Move to ${group.name}`}
                    />

                    {keyboardOpen && actions}
                </ScrollView>

                {!keyboardOpen && actions}
            </View>

            <IconPicker
                visible={iconPickerVisible}
                onClose={() => setIconPickerVisible(false)}
                onSelect={(family, name) => {
                    setSelectedIconFamily(family as IconFamilyType);
                    setSelectedIconName(name);
                }}
                currentFamily={selectedIconFamily}
                currentIcon={selectedIconName}
            />
        </OverlayModal>
    );
};
