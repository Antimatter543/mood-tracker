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

export const ActivityReorder = ({ activities, onReorder, onClose }: ReorderActivitiesProps) => {
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
                <Text style={styles.reorderTitle}>Reorder Activities</Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Pressable onPress={onClose}>
                        <MaterialIcons name="close" size={24} color={colors.text} />
                    </Pressable>
                    <Pressable onPress={handleSave}>
                        <MaterialIcons name="check" size={24} color={colors.accent} />
                    </Pressable>
                </View>
            </View>
            
            {reorderedActivities.map((activity, index) => (
                <View key={activity.id} style={styles.reorderItem}>
                    <View style={styles.reorderItemContent}>
                        {renderActivityIcon(activity, colors)}
                        <Text style={styles.reorderItemText}>{activity.name}</Text>
                    </View>
                    <View style={styles.reorderButtons}>
                        <Pressable 
                            style={styles.reorderButton}
                            onPress={() => moveActivity(index, 'up')}
                            disabled={index === 0}
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
    },
    reorderItemText: {
        color: colors.text,
        marginLeft: 12,
        fontSize: 14,
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