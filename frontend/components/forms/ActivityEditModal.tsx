// ActivityEditModal.tsx
import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TextInput, Pressable, StyleSheet, Alert } from 'react-native';
import { useThemeColors } from '@/styles/global';
import { SQLiteDatabase } from 'expo-sqlite';
import Ionicons from '@expo/vector-icons/Ionicons';
import { updateActivity, deleteActivity } from "@/databases/database";
import { Activity } from '../types';
import { useDataContext } from '@/context/DataContext';
import { ICON_FAMILIES, IconPicker } from '../IconPicker';

type ActivityEditModalProps = {
    visible: boolean;
    activity: Activity | null;
    onClose: () => void;
    onUpdate: () => void;
    db: SQLiteDatabase;
};

export const ActivityEditModal: React.FC<ActivityEditModalProps> = ({
    visible,
    activity,
    onClose,
    onUpdate,
    db
}) => {
    console.log("YOOOOO WE ARE IN ACTIVITYEDITMODAL", activity);
    const colors = useThemeColors();
    const [activityName, setActivityName] = useState(activity?.name || '');
    const [error, setError] = useState('');
    const { refetchEntries } = useDataContext();  // Get refetchEntries from context

    const [iconPickerVisible, setIconPickerVisible] = useState(false);
    const [selectedIconFamily, setSelectedIconFamily] = useState(activity?.icon_family || 'Feather');
    const [selectedIconName, setSelectedIconName] = useState(activity?.icon_name || 'circle');

    // Update state when activity changes or modal becomes visible
    useEffect(() => {
        if (activity && visible) {
            setActivityName(activity.name);
            setSelectedIconFamily(activity.icon_family);
            setSelectedIconName(activity.icon_name);
        }
    }, [activity, visible]);

    // Reset state when modal closes
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

        if (result.success) {
            onUpdate();
            onClose();
            refetchEntries();
        } else {
            setError(result.message);
        }
    };

    const checkUsageAndConfirmDelete = async () => {
        if (!activity) return;

        try {
            // Get usage count
            const usage = await db.getFirstAsync<{ count: number }>(
                'SELECT COUNT(*) as count FROM entry_activities WHERE activity_id = ?',
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

    const renderSelectedIcon = () => {
        // For emoji icons
        if (selectedIconFamily === 'Emoji') {
            return (
                <Text style={{ fontSize: 24, textAlign: 'center' }}>
                    {selectedIconName}
                </Text>
            );
        }
        
        // For regular icon families
        const IconComponent = ICON_FAMILIES[selectedIconFamily as keyof typeof ICON_FAMILIES]?.component;
        
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

    const styles = StyleSheet.create({
        modalContainer: {
            flex: 1,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            justifyContent: 'center',
            alignItems: 'center',
        },
        modalContent: {
            backgroundColor: colors.cardBackground,
            width: '90%',
            maxWidth: 400,
            borderRadius: 16,
            padding: 20,
            gap: 16,
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
            padding: 12,
            borderRadius: 8,
            alignItems: 'center',
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
    });

    return (
        <Modal
            animationType="fade"
            transparent={true}
            visible={visible}
            onRequestClose={onClose}
        >
            <View style={styles.modalContainer}>
                <View style={styles.modalContent}>
                    <View style={styles.modalHeader}>
                        <Text style={styles.title}>Edit Activity</Text>
                        <Pressable style={styles.closeButton} onPress={onClose}>
                            <Ionicons name="close" color={colors.text} size={24} />
                        </Pressable>
                    </View>

                    <TextInput
                        style={styles.input}
                        placeholder="Activity Name"
                        placeholderTextColor="#666"
                        value={activityName}
                        onChangeText={(text) => {
                            setActivityName(text);
                            setError('');
                        }}
                        autoFocus={true}
                    />

                    {/* ICON SELECTOR SECTION */}
                    <View style={styles.iconSelectorContainer}>
                        <Text style={styles.label}>Icon</Text>
                        <Pressable
                            style={styles.iconSelector}
                            onPress={() => setIconPickerVisible(true)}
                        >
                            {renderSelectedIcon()}
                            <Text style={styles.iconSelectorText}>Change Icon</Text>
                        </Pressable>
                    </View>

                    <IconPicker
                        visible={iconPickerVisible}
                        onClose={() => setIconPickerVisible(false)}
                        onSelect={(family, name) => {
                            setSelectedIconFamily(family);
                            setSelectedIconName(name);
                        }}
                        currentFamily={selectedIconFamily}
                        currentIcon={selectedIconName}
                    />

                    {error ? <Text style={styles.errorText}>{error}</Text> : null}

                    <View style={styles.buttonContainer}>
                        <Pressable
                            style={[styles.button, styles.deleteButton]}
                            onPress={checkUsageAndConfirmDelete}
                        >
                            <Text style={[styles.buttonText, styles.deleteButtonText]}>
                                Delete
                            </Text>
                        </Pressable>

                        <Pressable
                            style={[styles.button, styles.updateButton]}
                            onPress={handleUpdate}
                        >
                            <Text style={styles.buttonText}>Update</Text>
                        </Pressable>
                    </View>
                </View>
            </View>
        </Modal>
    );
};