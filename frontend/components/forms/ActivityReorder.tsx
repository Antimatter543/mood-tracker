import React, { useState, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Activity } from '../types';
import { useThemeColors } from '@/styles/global';
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import Feather from "@expo/vector-icons/Feather";
import { ICON_FAMILIES } from '../IconPicker';

type ReorderActivitiesProps = {
    activities: Activity[];
    onReorder: (activities: Activity[]) => void;
    onClose: () => void;
    /**
     * Open the big edit-activity modal for one activity. This screen is the
     * group's activity-management hub: tapping a row (or its pencil) edits that
     * activity, while the up/down arrows remain an accessible reorder fallback.
     * Editing now lives ONLY here because the drag-to-reorder gesture on the main
     * grid swallows the chip long-press that used to open the editor.
     */
    onEditActivity: (activity: Activity) => void;
};

// Helper function to render activity icons consistently
const renderActivityIcon = (activity: Activity, colors: any) => {
    const IconComponent = ICON_FAMILIES[activity.icon_family]?.component;
    
    if (!IconComponent) {
        // Fallback if no valid icon family
        return <Feather name="circle" size={24} color={colors.text} />;
    }

    return (
        <IconComponent.default 
            name={activity.icon_name as any} 
            size={24} 
            color={colors.text} 
        />
    );
};

export const ActivityReorder = ({ activities, onReorder, onClose, onEditActivity }: ReorderActivitiesProps) => {
    const colors = useThemeColors();
    const styles = useStyles(colors);
    const [reorderedActivities, setReorderedActivities] = useState<Activity[]>([...activities]);

    const moveActivity = (index: number, direction: 'up' | 'down') => {
        if (
            (direction === 'up' && index === 0) || 
            (direction === 'down' && index === reorderedActivities.length - 1)
        ) {
            return; // Can't move further in this direction
        }

        const newActivities = [...reorderedActivities];
        const targetIndex = direction === 'up' ? index - 1 : index + 1;
        
        // Swap the activities
        [newActivities[index], newActivities[targetIndex]] = 
        [newActivities[targetIndex], newActivities[index]];
        
        setReorderedActivities(newActivities);
    };

    const handleSave = () => {
        onReorder(reorderedActivities);
        onClose();
    };

    return (
        <View style={styles.reorderContainer}>
            <View style={styles.reorderHeader}>
                <Text style={styles.reorderTitle}>Edit Activities</Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Pressable
                        onPress={onClose}
                        accessibilityRole="button"
                        accessibilityLabel="Close activity editor"
                    >
                        <MaterialIcons name="close" size={24} color={colors.text} />
                    </Pressable>
                    <Pressable
                        onPress={handleSave}
                        accessibilityRole="button"
                        accessibilityLabel="Save activity order"
                    >
                        <MaterialIcons name="check" size={24} color={colors.accent} />
                    </Pressable>
                </View>
            </View>
            
            {reorderedActivities.map((activity, index) => (
                <View key={activity.id} style={styles.reorderItem}>
                    {/* Tapping the icon+name (or its pencil) opens the big edit
                        modal for this activity. The arrows reorder; this edits. */}
                    <Pressable
                        style={styles.reorderItemContent}
                        onPress={() => onEditActivity(activity)}
                        accessibilityRole="button"
                        accessibilityLabel={`Edit ${activity.name}`}
                    >
                        {renderActivityIcon(activity, colors)}
                        <Text style={styles.reorderItemText} numberOfLines={1}>{activity.name}</Text>
                        <MaterialIcons name="edit" size={18} color={colors.text + '99'} style={styles.editAffordance} />
                    </Pressable>
                    <View style={styles.reorderButtons}>
                        <Pressable
                            style={styles.reorderButton}
                            onPress={() => moveActivity(index, 'up')}
                            disabled={index === 0}
                            accessibilityRole="button"
                            accessibilityLabel={`Move ${activity.name} up`}
                        >
                            <MaterialIcons
                                name="arrow-upward"
                                size={20}
                                color={index === 0 ? colors.text + '50' : colors.text}
                            />
                        </Pressable>
                        <Pressable
                            style={styles.reorderButton}
                            onPress={() => moveActivity(index, 'down')}
                            disabled={index === reorderedActivities.length - 1}
                            accessibilityRole="button"
                            accessibilityLabel={`Move ${activity.name} down`}
                        >
                            <MaterialIcons
                                name="arrow-downward"
                                size={20}
                                color={index === reorderedActivities.length - 1 ? colors.text + '50' : colors.text}
                            />
                        </Pressable>
                    </View>
                </View>
            ))}
        </View>
    );
};

const useStyles = (colors: any) => useMemo(() => StyleSheet.create({
    reorderContainer: {
        marginTop: 8,
        marginBottom: 16,
        backgroundColor: colors.overlays.tag,
        borderRadius: 8,
        padding: 12,
    },
    reorderHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
    },
    reorderTitle: {
        color: colors.text,
        fontSize: 16,
        fontWeight: '600',
    },
    reorderItem: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: colors.overlays.tagBorder,
    },
    reorderItemContent: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
        paddingVertical: 4,
    },
    reorderItemText: {
        color: colors.text,
        marginLeft: 12,
        fontSize: 14,
        flexShrink: 1,
    },
    // Pencil hint that the row opens the editor; pushed to the right edge of the
    // tappable content area (just left of the reorder arrows).
    editAffordance: {
        marginLeft: 'auto',
        paddingLeft: 8,
    },
    reorderButtons: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    reorderButton: {
        padding: 8,
    },
}), [colors]);

export default ActivityReorder; 