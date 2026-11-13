// ActivityAddModal.tsx
import { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Alert, ScrollView } from 'react-native';
import { ThemeColors, useThemeColors } from '@/styles/global';
import { SQLiteDatabase } from 'expo-sqlite';
import Ionicons from '@expo/vector-icons/Ionicons';
import { addActivity } from "@/databases/database";
import { ACTIVITY_NAME_TAKEN } from '@/databases/activities';
import { ActivityGroup } from '../types';
import { useDataContext } from '@/context/DataContext';
import { IconPicker } from '../IconPicker';
import { IconFamilyType } from '../iconRegistry';
import { OverlayModal } from '../OverlayModal';
import { ActivityIcon } from '../activityIcon';
import { GroupPickerField } from './GroupPickerField';
import { useDialogFit } from './dialogFit';

type AddActivityModalProps = {
    visible: boolean;
    /** Group the dialog starts on (null = the user picks one). */
    groupId: number | null;
    onClose: () => void;
    onAdd: () => void;
    db: SQLiteDatabase;
    /**
     * All activity groups, already in display order (from getActivityGroups).
     * Powers the group picker.
     */
    groups: ActivityGroup[];
};

export const AddActivityModal = ({ visible, groupId, onClose, onAdd, db, groups }: AddActivityModalProps) => {
    const colors = useThemeColors();
    const styles = useStyles(colors);
    const { keyboardOpen, cardStyle } = useDialogFit();
    const [error, setError] = useState('');
    const { refetchEntries } = useDataContext();

    const [newActivityName, setNewActivityName] = useState("");
    const [iconPickerVisible, setIconPickerVisible] = useState(false);
    const [selectedIconFamily, setSelectedIconFamily] = useState<IconFamilyType>('Feather');
    const [selectedIconName, setSelectedIconName] = useState('circle');
    const [selectedGroupId, setSelectedGroupId] = useState(groupId);
    const selectedGroupName = groups.find((g) => g.id === selectedGroupId)?.name;

    // Reset error when modal closes.
    useEffect(() => {
        if (!visible) {
            setError('');
        }
    }, [visible]);

    const handleAdd = async () => {
        if (!newActivityName.trim()) {
            Alert.alert("Activity Not Complete", "Activity name is missing.")
            return;
        } else if (!selectedGroupId) {
            Alert.alert("Activity Not Complete", "Activity group is missing.")
            return;
        }

        try {
            const result = await addActivity(
                db,
                newActivityName.trim(),
                selectedGroupId,
                selectedIconFamily,
                selectedIconName
            );

            if (!result.success) {
                if (result.code === ACTIVITY_NAME_TAKEN) {
                    setError('An activity with this name already exists in this group.');
                } else {
                    // The detail is for the log only; the user gets plain words.
                    console.error('addActivity failed:', result.message);
                    Alert.alert("Couldn't add activity", "Something went wrong. Please try again.");
                }
                return;
            }

            // Both callers unmount this dialog on close, so there is no form
            // state to reset here.
            onAdd();
            onClose();
            refetchEntries();
        } catch (error) {
            console.error('Error adding activity:', error);
            Alert.alert("Couldn't add activity", "Something went wrong. Please try again.");
        }
    }

    // Error + Add button. Pinned under the fields while the keyboard is closed;
    // at the end of the scrolling fields while it is open, so on a short screen
    // or a large font the fields get the whole card and the name being typed is
    // never cropped (#51 device QA, 360x640 at font 1.3).
    const actions = (
        <View testID="activity-add-actions" style={styles.actions}>
            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            <Pressable
                style={styles.submitButton}
                onPress={handleAdd}
                accessibilityRole="button"
            >
                <Text style={styles.submitButtonText}>Add Activity</Text>
            </Pressable>
        </View>
    );

    return (
        <OverlayModal visible={visible} onClose={onClose}>
            <View testID="activity-add-dialog" style={[styles.modalContent, cardStyle]}>
                <View style={styles.modalHeader}>
                    <Text style={styles.modalTitle} numberOfLines={2}>
                        Add New{selectedGroupName ? ` ${selectedGroupName}` : ''} Activity
                    </Text>
                    <Pressable
                        style={styles.closeButton}
                        onPress={onClose}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel="Close without adding"
                    >
                        <Ionicons name="close" color={colors.text} size={24} />
                    </Pressable>
                </View>

                {/* The card shrinks to the room the overlay gives it and the
                    fields scroll. The header always stays put; the Add button
                    stays put only while the keyboard is closed (useDialogFit). */}
                <ScrollView
                    testID="activity-add-fields"
                    style={styles.body}
                    contentContainerStyle={styles.bodyContent}
                    keyboardShouldPersistTaps="handled"
                >
                    <TextInput
                        style={styles.input}
                        placeholder="Activity Name"
                        placeholderTextColor={colors.textSecondary}
                        value={newActivityName}
                        onChangeText={(text) => {
                            setNewActivityName(text);
                            setError('');
                        }}
                        accessibilityLabel="Activity name"
                        autoFocus
                    />

                    <View>
                        <Text style={styles.label}>Icon</Text>
                        <Pressable
                            style={styles.iconSelector}
                            onPress={() => setIconPickerVisible(true)}
                            accessibilityRole="button"
                            accessibilityLabel="Select icon"
                        >
                            <ActivityIcon
                                iconName={selectedIconName}
                                iconFamily={selectedIconFamily}
                                color={colors.text}
                                size={24}
                            />
                            <Text style={styles.iconSelectorText}>Select Icon</Text>
                        </Pressable>
                    </View>

                    {/* Group this activity is added to. */}
                    <GroupPickerField
                        groups={groups}
                        selectedGroupId={selectedGroupId}
                        onSelect={setSelectedGroupId}
                        triggerLabel="Select group"
                        optionLabel={(group) => `Add to ${group.name}`}
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

const useStyles = (colors: ThemeColors) => useMemo(() => StyleSheet.create({
    modalContent: {
        backgroundColor: colors.cardBackground,
        width: "94%",
        maxWidth: 560,
        borderRadius: 16,
        padding: 24,
        gap: 20,
    },
    modalHeader: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 12,
    },
    modalTitle: {
        flex: 1,
        color: colors.text,
        fontSize: 20,
        fontWeight: "bold",
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
    submitButton: {
        backgroundColor: colors.accent,
        minHeight: 48,
        padding: 12,
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
    },
    submitButtonText: {
        color: colors.text,
        fontSize: 16,
        fontWeight: "600",
    },
    errorText: {
        color: '#ff4444',
        fontSize: 14,
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
}), [colors]);
