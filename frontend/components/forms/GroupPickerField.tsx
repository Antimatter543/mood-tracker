import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import Ionicons from '@expo/vector-icons/Ionicons';

import { ThemeColors, useThemeColors } from '@/styles/global';
import { ActivityGroup } from '../types';
import { OverlayModal } from '../OverlayModal';

/**
 * The "Group" field of the Add and Edit activity dialogs: a row showing the
 * chosen group that opens a small picker dialog listing every group.
 *
 * Local state only. Picking a group calls `onSelect`; nothing is written until
 * the parent dialog's Add / Update button is pressed.
 */
export const GroupPickerField: React.FC<{
    groups: ActivityGroup[];
    selectedGroupId: number | null;
    onSelect: (groupId: number) => void;
    /** Accessibility label of the row that opens the picker. */
    triggerLabel: string;
    /** Accessibility label of one group's row in the picker. */
    optionLabel: (group: ActivityGroup) => string;
}> = ({ groups, selectedGroupId, onSelect, triggerLabel, optionLabel }) => {
    const colors = useThemeColors();
    const styles = useMemo(() => makeStyles(colors), [colors]);
    const [pickerVisible, setPickerVisible] = useState(false);
    const selectedName = groups.find((g) => g.id === selectedGroupId)?.name;

    return (
        <View>
            <Text style={styles.label}>Group</Text>
            <Pressable
                style={styles.trigger}
                onPress={() => setPickerVisible(true)}
                accessibilityRole="button"
                accessibilityLabel={triggerLabel}
            >
                {/* Leading folder + trailing chevron so this row reads as an
                    opens-a-picker control, like the Icon row above it. */}
                <Feather name="folder" size={20} color={colors.text} />
                <Text style={styles.triggerText} numberOfLines={1}>
                    {selectedName ?? 'Select a group'}
                </Text>
                <Feather name="chevron-down" size={20} color={colors.textSecondary} />
            </Pressable>

            <OverlayModal visible={pickerVisible} onClose={() => setPickerVisible(false)}>
                <View style={styles.pickerCard}>
                    <View style={styles.pickerHeader}>
                        <Text style={styles.pickerTitle}>Select Group</Text>
                        <Pressable
                            style={styles.closeButton}
                            onPress={() => setPickerVisible(false)}
                            hitSlop={8}
                            accessibilityRole="button"
                            accessibilityLabel="Close group list"
                        >
                            <Ionicons name="close" color={colors.text} size={24} />
                        </Pressable>
                    </View>
                    <ScrollView
                        style={styles.list}
                        contentContainerStyle={styles.listContent}
                        keyboardShouldPersistTaps="handled"
                    >
                        {groups.map((group) => (
                            <Pressable
                                key={group.id}
                                style={styles.row}
                                onPress={() => {
                                    onSelect(group.id);
                                    setPickerVisible(false);
                                }}
                                accessibilityRole="button"
                                accessibilityLabel={optionLabel(group)}
                                accessibilityState={{ selected: group.id === selectedGroupId }}
                            >
                                <Text style={styles.rowText} numberOfLines={1}>
                                    {group.name}
                                </Text>
                                {group.id === selectedGroupId && (
                                    <Feather name="check" size={20} color={colors.accent} />
                                )}
                            </Pressable>
                        ))}
                    </ScrollView>
                </View>
            </OverlayModal>
        </View>
    );
};

const makeStyles = (colors: ThemeColors) =>
    StyleSheet.create({
        label: {
            color: colors.text,
            fontSize: 16,
            fontWeight: '500',
            marginBottom: 8,
        },
        trigger: {
            flexDirection: 'row',
            alignItems: 'center',
            minHeight: 48,
            backgroundColor: colors.overlays.tag,
            paddingHorizontal: 12,
            paddingVertical: 12,
            borderRadius: 8,
            gap: 8,
        },
        // The group name takes the slack and ellipsizes, so the chevron always
        // stays on the row.
        triggerText: {
            flex: 1,
            color: colors.text,
            fontSize: 16,
        },
        // Smaller than the parent dialog: it is just a list of group names.
        pickerCard: {
            backgroundColor: colors.cardBackground,
            width: '90%',
            maxWidth: 480,
            borderRadius: 16,
            padding: 24,
            gap: 12,
        },
        pickerHeader: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
        },
        pickerTitle: {
            color: colors.text,
            fontSize: 20,
            fontWeight: 'bold',
        },
        closeButton: {
            padding: 4,
        },
        // Capped so a long group list scrolls inside the card. flexGrow 0 lets a
        // short list hug its rows instead of reserving the full cap.
        list: {
            flexGrow: 0,
            maxHeight: 360,
        },
        listContent: {
            flexGrow: 1,
        },
        row: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            minHeight: 48,
            backgroundColor: colors.overlays.tag,
            paddingHorizontal: 12,
            paddingVertical: 12,
            borderRadius: 8,
            marginBottom: 8,
        },
        rowText: {
            flex: 1,
            color: colors.text,
            fontSize: 16,
        },
    });
