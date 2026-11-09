// ActivityAddModal.tsx
import { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Alert } from 'react-native';
import { ThemeColors, useThemeColors } from '@/styles/global';
import { SQLiteDatabase } from 'expo-sqlite';
import Ionicons from '@expo/vector-icons/Ionicons';
import Feather from '@expo/vector-icons/Feather';
import { addActivity } from "@/databases/database";
import { ActivityGroup } from '../types';
import { useDataContext } from '@/context/DataContext';
import { IconPicker } from '../IconPicker';
import { ICON_FAMILIES, IconFamilyType } from '../iconRegistry';
import { OverlayModal } from '../OverlayModal';
import { ScrollView } from 'react-native-gesture-handler';

type AddActivityModalProps = {
    visible: boolean;
    groupName: string | null;
    groupId: number | null;
    onClose: () => void;
    onAdd: () => void;
    db: SQLiteDatabase;
    /**
     * All activity groups, already in display order (from getActivityGroups).
     * Powers the "move to another group" picker.
     */
    groups: ActivityGroup[];
};

export const AddActivityModal = ({ visible, groupName, groupId, onClose, onAdd, db, groups }: AddActivityModalProps) => {
    const colors = useThemeColors();
    const styles = useStyles(colors);
    const [error, setError] = useState('');
    const { refetchEntries } = useDataContext();

    const [newActivityName, setNewActivityName] = useState("");
    const [iconPickerVisible, setIconPickerVisible] = useState(false);
    const [selectedIconFamily, setSelectedIconFamily] = useState<IconFamilyType>('Feather');
    const [selectedIconName, setSelectedIconName] = useState('circle');
    const [selectedGroupName, setSelectedGroupName] = useState<string | null>(groupName);
    const [selectedGroupId, setSelectedGroupId] = useState(groupId);
    const [groupPickerVisible, setGroupPickerVisible] = useState(false);

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
                // Display error message
                if (result.message.includes('UNIQUE constraint failed')) {
                    setError('An activity with this name already exists in this group.');
                } else {
                    Alert.alert("Error Adding Activity", result.message)
                }
                return;
            }            

            setNewActivityName("");
            setSelectedIconFamily('Feather');
            setSelectedIconName('circle');
            setSelectedGroupId(null);

            onAdd();
            onClose();
            refetchEntries();
        } catch (error) {
            console.error('Error adding activity:', error);
            Alert.alert("Error", "Failed to add activity. Please try again.");
        }
    }
    
    const renderSelectedIcon = () => {
        // Special case for emojis
        if (selectedIconFamily === 'Emoji') {
            return <Text style={{ fontSize: 24 }}>{selectedIconName}</Text>;
        }
        
        // For regular icon libraries
        const IconComponent = ICON_FAMILIES[selectedIconFamily]?.component;
        
        if (!IconComponent) {
            // Fallback if no valid icon family
            return <Feather name="circle" size={24} color={colors.text} />;
        }
    
        return (
            <IconComponent.default 
                name={selectedIconName as any} 
                size={24} 
                color={colors.text} 
            />
        );
    };

    return (
        <OverlayModal visible={visible} onClose={onClose}>
            <View style={styles.modalContent}>
                <View style={styles.modalHeader}>
                    <Text style={styles.modalTitle}>Add New{selectedGroupName ? ` ${selectedGroupName}` : ''} Activity</Text>
                    <Pressable style={styles.closeButton} onPress={onClose}>
                        <Ionicons name="close" color={colors.text} size={24} />
                    </Pressable>
                </View>

                <TextInput
                    style={styles.input}
                    placeholder="Activity Name"
                    placeholderTextColor={colors.textSecondary}
                    value={newActivityName}
                    onChangeText={setNewActivityName}
                    autoFocus
                />

                <View style={styles.iconSelectorContainer}>
                    <Text style={styles.iconSelectorText}>Icon</Text>
                    <Pressable
                        style={styles.iconSelector}
                        onPress={() => setIconPickerVisible(true)}
                    >
                        {renderSelectedIcon()}
                        <Text style={styles.iconSelectorText}>Select Icon</Text>
                    </Pressable>
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

                {/* GROUP SELECTOR SECTION — move this activity into another
                    group. Local state only; nothing is written until Update
                    is pressed (see handleUpdate for the write ordering). */}
                <View style={styles.groupSelectorContainer}>
                    <Text style={styles.label}>Group</Text>
                    <Pressable
                        style={[styles.iconSelector, styles.groupSelectorRow]}
                        onPress={() => setGroupPickerVisible(true)}
                        accessibilityRole="button"
                        accessibilityLabel="Select group"
                    >
                        {/* Leading folder + trailing chevron so this row reads
                            as an opens-a-picker control, matching the Icon row
                            above it (which leads with the chosen icon). */}
                        <Feather name="folder" size={20} color={colors.text} />
                        <Text style={[styles.iconSelectorText, styles.groupSelectorLabel]} numberOfLines={1}>
                            {groups.find((g) => g.id === selectedGroupId)?.name ?? 'Select a group'}
                        </Text>
                        <Feather name="chevron-down" size={20} color={colors.textSecondary} />
                    </Pressable>
                </View>

                <OverlayModal
                    visible={groupPickerVisible}
                    onClose={() => setGroupPickerVisible(false)}
                >
                    <View style={styles.groupPickerContent}>
                        <View style={styles.modalHeader}>
                            <Text style={styles.title}>Select Group</Text>
                            <Pressable
                                style={styles.closeButton}
                                onPress={() => setGroupPickerVisible(false)}
                            >
                                <Ionicons name="close" color={colors.text} size={24} />
                            </Pressable>
                        </View>
                        <ScrollView style={styles.groupList} contentContainerStyle={styles.groupListContent}>
                            {groups.map((group) => {
                                const isSelected = group.id === selectedGroupId;
                                return (
                                    <Pressable
                                        key={group.id}
                                        style={styles.groupRow}
                                        onPress={() => {
                                            setSelectedGroupId(group.id);
                                            setSelectedGroupName(groups.find(g => g.id === group.id)?.name || "")
                                            setGroupPickerVisible(false);
                                        }}
                                        accessibilityRole="button"
                                        accessibilityLabel={`Add to ${group.name}`}
                                    >
                                        <Text style={styles.groupRowText}>{group.name}</Text>
                                        {isSelected && (
                                            <Feather name="check" size={20} color={colors.accent} />
                                        )}
                                    </Pressable>
                                );
                            })}
                        </ScrollView>
                    </View>
                </OverlayModal>

                {error ? <Text style={styles.errorText}>{error}</Text> : null}

                <Pressable style={styles.submitButton} onPress={handleAdd}>
                    <Text style={styles.submitButtonText}>Add Activity</Text>
                </Pressable>
            </View>
        </OverlayModal>
    );
};

const useStyles = (colors: ThemeColors) => useMemo(() => StyleSheet.create({
    // Keep the base container styles
    scrollContainer: {
        flex: 1,
        width: "100%",
    },
    scrollContent: {
        paddingBottom: 100,
    },
    container: {
        width: "100%",
        gap: 24,
    },
    // Keep other modal and input styles the same
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
    },
    modalTitle: {
        color: colors.text,
        fontSize: 20,
        fontWeight: "bold",
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
    submitButton: {
        backgroundColor: colors.accent,
        minWidth: 96,
        padding: 12,
        borderRadius: 8,
        alignItems: "center",
    },
    submitButtonText: {
        color: colors.text,
        fontSize: 16,
        fontWeight: "600",
    },
    title: {
        color: colors.text,
        fontSize: 20,
        fontWeight: 'bold',
    },
    errorText: {
        color: '#ff4444',
        fontSize: 14,
        marginTop: 8,
        marginBottom: 8,
    },
    iconSelectorContainer: {
        marginBottom: 16,
    },
    iconSelector: {
        flexDirection: 'row',
        alignItems: 'center',
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
    groupSelectorContainer: {
        marginBottom: 16,
    },
    // Pushes the chevron to the right edge while the group name takes the
    // slack (and ellipsizes rather than shoving the chevron off the row).
    groupSelectorRow: {
        justifyContent: 'space-between',
    },
    groupSelectorLabel: {
        flexShrink: 1,
        flexGrow: 1,
    },
    // Group picker: a smaller dialog than the edit card itself, since it's
    // just a scrollable list of group names.
    groupPickerContent: {
        backgroundColor: colors.cardBackground,
        width: '90%',
        maxWidth: 480,
        borderRadius: 16,
        padding: 24,
        gap: 12,
    },
    groupList: {
        flexGrow: 0,            
        // Cap the visible list height so a long group list scrolls inside the
        // dialog instead of pushing it off-screen.
        maxHeight: 360,
    },
    groupListContent: {
        flexGrow: 1,
    },
    groupRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: colors.overlays.tag,
        padding: 12,
        borderRadius: 8,
        marginBottom: 8,
    },
    groupRowText: {
        color: colors.text,
        fontSize: 16,
    },    
}), [colors]);