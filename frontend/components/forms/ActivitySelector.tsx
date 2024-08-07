import { colors, useThemeColors } from "@/styles/global";
import * as SQLite from "expo-sqlite";

import Ionicons from '@expo/vector-icons/Ionicons';
import Feather from "@expo/vector-icons/Feather";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";

import React, { useMemo, useState, useRef } from "react";
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Activity, ActivityGroup } from "../types";
import { ActivityEditModal } from "./ActivityEditModal";
import { ICON_FAMILIES, IconFamilyType, IconPicker } from "../IconPicker";
import ActivityReorder from "./ActivityReorder";

import { 
    getActivities, 
    addActivity, 
    addActivityGroup, 
    deleteActivityGroup, 
    updateActivityPositions,
    checkGroupHasEntries
} from "@/databases/database";

type ActivitySelectorProps = {
    onSelectActivity: (activityId: number) => void;
    selectedActivities: number[];
};

type AddActivityModalProps = {
    visible: boolean;
    onClose: () => void;
    onAdd: (name: string, iconFamily: string, iconName: string) => void;
    groupName: string;
};

type AddGroupModalProps = {
    visible: boolean;
    onClose: () => void;
    onAdd: (name: string) => void;
    error: string;
};

type ActivityItemProps = {
    activity: Activity;
    isSelected: boolean;
    onPress: () => void;
    onLongPress: () => void;
};

type ActivityGroupSectionProps = {
    group: ActivityGroup;
    activities: Activity[];
    selectedActivities: number[];
    onSelectActivity: (id: number) => void;
    onAddActivity: () => void;
    onLongPressActivity: (activity: Activity) => void;
    onDeleteGroup: () => void;
    onReorderActivities: (activities: Activity[]) => void;
};

// Add a new type for the dropdown menu
type GroupActionMenuProps = {
    visible: boolean;
    onClose: () => void;
    onAddActivity: () => void;
    onDeleteGroup: () => void;
    onReorderActivities: () => void;
    position: { x: number, y: number };
};

const useStyles = (colors: any) => useMemo(() => StyleSheet.create({
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

    menuOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'transparent',
        zIndex: 1,
    },

    groupContainer: {
        gap: 12,
        position:'relative',
    },
    groupHeader: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        paddingHorizontal: 16,
    },
    groupTitle: {
        color: colors.text,
        fontSize: 16,
        fontWeight: "600",
        opacity: 0.8,
    },
    groupActionButton: {
        padding: 8,
        borderRadius: 20,
        backgroundColor: colors.overlays.tag,
    },
    // Styles for the circular activity layout
    activitiesList: {
        flexDirection: "row",
        flexWrap: "wrap",
        paddingHorizontal: 12,
        gap: 8,
        justifyContent: 'center', // Center the activities horizontally
    },
    activityWrapper: {
        width: '18%',  // Changed from 70 to 20% to fit 5 items per row
        alignItems: 'center',
        gap: 4,
        marginBottom: 4,
        // paddingHorizontal: 2,  // Added small padding to prevent text overlap
    },

    circleButton: {
        width: 52,  
        height: 52,  
        borderRadius: 24,  // Half of width/height
        backgroundColor: colors.overlays.tag,
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: colors.overlays.tagBorder,
    },
    activityLabel: {
        color: colors.text,
        fontSize: 11,  // Slightly reduced from 12
        textAlign: 'center',
        marginTop: 2,  // Reduced from 4
        width: '100%',  // Ensure text takes full width of wrapper
    },
    selectedCircle: {
        backgroundColor: colors.accent,
        borderColor: colors.accent,
    },
    // Dropdown menu styles
    menuContainer: {
        position: 'absolute',
        backgroundColor: colors.cardBackground,
        borderRadius: 8,
        padding: 4,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 3.84,
        elevation: 5,
        zIndex: 2,
        borderWidth: 1,
        borderColor: colors.border,
    },
    menuItem: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        borderRadius: 4,
    },
    menuItemText: {
        color: colors.text,
        marginLeft: 8,
        fontSize: 14,
    },
    menuItemDanger: {
        color: '#ff6b6b',
    },
    // Keep other modal and input styles the same
    modalContainer: {
        flex: 1,
        backgroundColor: "rgba(0, 0, 0, 0.5)",
        justifyContent: "center",
        alignItems: "center",
    },
    modalContent: {
        backgroundColor: colors.cardBackground,
        width: "90%",
        maxWidth: 400,
        borderRadius: 16,
        padding: 20,
        gap: 16,
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
        padding: 12,
        borderRadius: 8,
        alignItems: "center",
    },
    submitButtonText: {
        color: "#fff",
        fontSize: 16,
        fontWeight: "600",
    },
    addNewGroupButton: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.overlays.tag,
        padding: 16,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.overlays.tagBorder,
        marginTop: 24,
        marginHorizontal: 16,
        gap: 8,
    },
    addNewGroupText: {
        color: colors.text,
        fontSize: 16,
        fontWeight: '500',
    },
    errorText: {
        color: '#ff6b6b',
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
}), [colors]);


export const renderActivityIcon = (activity, colors, size = 24, selectedColor = '#fff') => {
    // Check if this is an emoji icon
    if (activity.icon_family === 'Emoji') {
        return (
            <Text style={{
                fontSize: size,
                textAlign: 'center',
                lineHeight: size
            }}>
                {activity.icon_name}
            </Text>
        );
    }
    
    // For regular icon families
    const IconComponent = ICON_FAMILIES[activity.icon_family]?.component;
    
    if (!IconComponent) {
        // Fallback if no valid icon family
        return <Feather name="circle" size={size} color={selectedColor} />;
    }

    return (
        <IconComponent.default 
            name={activity.icon_name} 
            size={size} 
            color={selectedColor} 
        />
    );
};

const ActivityItem = ({ activity, isSelected, onPress, onLongPress }: ActivityItemProps) => {
    const colors = useThemeColors();
    const styles = useStyles(colors);

    return (
        <Pressable
            onPress={onPress}
            onLongPress={onLongPress}
            delayLongPress={500}
            style={styles.activityWrapper}
        >
            <View style={[styles.circleButton, isSelected && styles.selectedCircle]}>
                {activity.icon_family === 'Emoji' ? (
                    <Text style={{
                        fontSize: 24,
                        textAlign: 'center',
                    }}>
                        {activity.icon_name}
                    </Text>
                ) : (
                    renderActivityIcon(activity, colors, 24, isSelected ? '#fff' : colors.text)
                )}
            </View>
            <Text style={styles.activityLabel} numberOfLines={2}>{activity.name}</Text>
        </Pressable>
    );
};

const AddActivityModal = ({ visible, onClose, onAdd, groupName }: AddActivityModalProps) => {
    const colors = useThemeColors();
    const styles = useStyles(colors);
    const [newActivityName, setNewActivityName] = useState("");
    const [iconPickerVisible, setIconPickerVisible] = useState(false);
    const [selectedIconFamily, setSelectedIconFamily] = useState<IconFamilyType>('Feather');
    const [selectedIconName, setSelectedIconName] = useState('circle');

    const handleSubmit = () => {
        onAdd(newActivityName, selectedIconFamily, selectedIconName);
        setNewActivityName("");
        setSelectedIconFamily('Feather');
        setSelectedIconName('circle');
    };

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
        <Modal animationType="fade" transparent visible={visible} onRequestClose={onClose}>
            <View style={styles.modalContainer}>
                <View style={styles.modalContent}>
                    <View style={styles.modalHeader}>
                        <Text style={styles.modalTitle}>Add New {groupName} Activity</Text>
                        <Pressable style={styles.closeButton} onPress={onClose}>
                            <Ionicons name="close" color={colors.text} size={24} />
                        </Pressable>
                    </View>
                    
                    <TextInput
                        style={styles.input}
                        placeholder="Activity Name"
                        placeholderTextColor="#666"
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
                            <Text style={styles.iconSelectorText}>Change Icon</Text>
                        </Pressable>
                    </View>

                    <Pressable style={styles.submitButton} onPress={handleSubmit}>
                        <Text style={styles.submitButtonText}>Add Activity</Text>
                    </Pressable>

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
                </View>
            </View>
        </Modal>
    );
};

const AddGroupModal = ({ visible, onClose, onAdd, error }: AddGroupModalProps) => {
    const colors = useThemeColors();
    const styles = useStyles(colors);
    const [newGroupName, setNewGroupName] = useState("");

    const handleSubmit = () => {
        onAdd(newGroupName);
        setNewGroupName("");
    };

    return (
        <Modal animationType="fade" transparent visible={visible} onRequestClose={onClose}>
            <View style={styles.modalContainer}>
                <View style={styles.modalContent}>
                    <View style={styles.modalHeader}>
                        <Text style={styles.modalTitle}>Create New Activity Group</Text>
                        <Pressable style={styles.closeButton} onPress={onClose}>
                            <Ionicons name="close" color={colors.text} size={24} />
                        </Pressable>
                    </View>
                    <TextInput
                        style={styles.input}
                        placeholder="Group Name"
                        placeholderTextColor="#666"
                        value={newGroupName}
                        onChangeText={setNewGroupName}
                        autoFocus
                    />
                    {error ? <Text style={styles.errorText}>{error}</Text> : null}
                    <Pressable style={styles.submitButton} onPress={handleSubmit}>
                        <Text style={styles.submitButtonText}>Create Group</Text>
                    </Pressable>
                </View>
            </View>
        </Modal>
    );
};


// Update the ActivityGroupSection component
const ActivityGroupSection = ({ 
    group, 
    activities, 
    selectedActivities, 
    onSelectActivity, 
    onAddActivity,
    onLongPressActivity,
    onDeleteGroup,
    onReorderActivities
}: ActivityGroupSectionProps) => {
    const colors = useThemeColors();
    const styles = useStyles(colors);
    const [menuVisible, setMenuVisible] = useState(false);
    const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
    const [isReordering, setIsReordering] = useState(false);
    const menuButtonRef = useRef<View>(null);

    const handleMenuPress = () => {
        // Simplified approach - just show the menu without trying to position it precisely
        setMenuVisible(true);
    };

    const handleReorderActivities = () => {
        setIsReordering(true);
    };

    const handleReorderComplete = (reorderedActivities: Activity[]) => {
        onReorderActivities(reorderedActivities);
        setIsReordering(false);
    };

    return (
        <View style={styles.groupContainer}>
            {/* Overlay to capture clicks outside the menu */}
            {menuVisible && (
                <Pressable 
                    style={styles.menuOverlay}
                    onPress={() => setMenuVisible(false)}
                />
            )}
            
            <View style={styles.groupHeader}>
                <Text style={styles.groupTitle}>{group.name}</Text>
                <View style={{ position: 'relative', zIndex: menuVisible ? 2 : 1 }}>
                    <Pressable 
                        ref={menuButtonRef}
                        style={styles.groupActionButton} 
                        onPress={handleMenuPress}
                    >
                        <MaterialIcons name="more-vert" color={colors.text} size={20} />
                    </Pressable>
                    
                    {menuVisible && (
                        <GroupActionMenu 
                            visible={menuVisible}
                            onClose={() => setMenuVisible(false)}
                            onAddActivity={onAddActivity}
                            onDeleteGroup={onDeleteGroup}
                            onReorderActivities={handleReorderActivities}
                            position={menuPosition}
                        />
                    )}
                </View>
            </View>
            
            {isReordering ? (
                <ActivityReorder 
                    activities={activities}
                    onReorder={handleReorderComplete}
                    onClose={() => setIsReordering(false)}
                />
            ) : (
                <View style={styles.activitiesList}>
                    {activities.map((activity) => (
                        <ActivityItem
                            key={activity.id}
                            activity={activity}
                            isSelected={selectedActivities.includes(activity.id)}
                            onPress={() => onSelectActivity(activity.id)}
                            onLongPress={() => onLongPressActivity(activity)}
                        />
                    ))}
                </View>
            )}
        </View>
    );
};

// Update the GroupActionMenu component
const GroupActionMenu = ({ 
    visible, 
    onClose, 
    onAddActivity, 
    onDeleteGroup, 
    onReorderActivities,
    position 
}: GroupActionMenuProps) => {
    const colors = useThemeColors();
    const styles = useStyles(colors);

    if (!visible) return null;

    return (
        <View 
            style={[
                styles.menuContainer, 
                { 
                    position: 'absolute',
                    top: 40,
                    right: 0,
                    zIndex: 2,
                    width: 200,
                    elevation: 5, // Android elevation
                }
            ]}
        >
            <Pressable 
                style={styles.menuItem} 
                onPress={() => {
                    onClose();
                    onAddActivity();
                }}
            >
                <MaterialIcons name="add" size={18} color={colors.text} />
                <Text style={styles.menuItemText}>Add Activity</Text>
            </Pressable>
            
            <Pressable 
                style={styles.menuItem} 
                onPress={() => {
                    onClose();
                    onReorderActivities();
                }}
            >
                <MaterialIcons name="reorder" size={18} color={colors.text} />
                <Text style={styles.menuItemText}>Reorder Activities</Text>
            </Pressable>
            
            <Pressable 
                style={styles.menuItem} 
                onPress={() => {
                    onClose();
                    onDeleteGroup();
                }}
            >
                <MaterialIcons name="delete" size={18} color="#ff6b6b" />
                <Text style={[styles.menuItemText, styles.menuItemDanger]}>Delete Group</Text>
            </Pressable>
        </View>
    );
};

export function ActivitySelector({ onSelectActivity, selectedActivities }: ActivitySelectorProps) {
    const colors = useThemeColors();
    const styles = useStyles(colors);
    const db = SQLite.useSQLiteContext();

    const [activities, setActivities] = useState<Activity[]>([]);
    const [groups, setGroups] = useState<ActivityGroup[]>([]);
    const [currentGroupId, setCurrentGroupId] = useState<number>(0);
    const [error, setError] = useState("");
    const [modals, setModals] = useState({
        addActivity: false,
        addGroup: false,
        edit: false
    });
    const [selectedActivity, setSelectedActivity] = useState<Activity | null>(null);
    const [newActivityName, setNewActivityName] = useState("");
    const [newGroupName, setNewGroupName] = useState("");

    // Load both activities and groups on mount
    React.useEffect(() => {
        loadActivities();
    }, []);

    const loadActivities = async () => {
        try {
            // Load groups first
            const groupsResult = await db.getAllAsync<ActivityGroup>(
                'SELECT * FROM activity_groups ORDER BY id'
            );
            setGroups(groupsResult);

            // Use the centralized getActivities function
            const activitiesResult = await getActivities(db);
            setActivities(activitiesResult);
        } catch (error) {
            console.error('Error loading activities and groups:', error);
        }
    };

    const handleAddActivity = async (name: string, iconFamily: string, iconName: string) => {
        if (!name.trim() || !currentGroupId) return;

        try {
            const result = await addActivity(
                db,
                name.trim(),
                currentGroupId,
                iconFamily,
                iconName
            );

            if (result.success) {
                await loadActivities();
                setNewActivityName("");
                setModals({ ...modals, addActivity: false });
            } else {
                // Display error message
                if (result.message.includes('UNIQUE constraint failed')) {
                  Alert.alert("Activity Already Exists", 
                    "An activity with this name already exists in this group.");
                } else {
                  Alert.alert("Error", result.message);
                }
              }
            } catch (error) {
              console.error('Error adding activity:', error);
              Alert.alert("Error", "Failed to add activity. Please try again.");
            }
          };

    const handleAddGroup = async (name: string) => {
        if (!name.trim()) {
            setError("Please enter a group name");
            return;
        }

        const result = await addActivityGroup(db, name.trim());

        if (result.success) {
            await loadActivities();
            setNewGroupName("");
            setModals({ ...modals, addGroup: false });
            setError("");
        } else {
            setError(result.message);
        }
    };

    const handleDeleteGroup = async (groupId: number, groupName: string) => {
        try {
            // First check if the group has associated entries
            const checkResult = await checkGroupHasEntries(db, groupId);
            
            if (!checkResult.exists) {
                Alert.alert("Error", "Activity group not found");
                return;
            }
            
            // Show a confirmation dialog with appropriate warning
            const warningMessage = checkResult.hasEntries
                ? `Are you sure you want to delete "${groupName}" and all its activities? This group has activities that are used in your mood entries. The activities will be removed from those entries.`
                : `Are you sure you want to delete "${groupName}" and all its activities? This action cannot be undone.`;
                
            Alert.alert(
                "Delete Activity Group",
                warningMessage,
                [
                    {
                        text: "Cancel",
                        style: "cancel"
                    },
                    {
                        text: "Delete",
                        style: "destructive",
                        onPress: async () => {
                            try {
                                const result = await deleteActivityGroup(db, groupId);
                                
                                if (result.success) {
                                    await loadActivities();
                                } else {
                                    console.error(result.message);
                                    Alert.alert("Error", result.message);
                                }
                            } catch (error) {
                                console.error('Error deleting group:', error);
                                Alert.alert("Error", "Failed to delete activity group");
                            }
                        }
                    }
                ]
            );
        } catch (error) {
            console.error('Error checking group:', error);
            Alert.alert("Error", "Failed to check activity group");
        }
    };

    const handleReorderActivities = async (activities: Activity[]) => {
        try {
            const result = await updateActivityPositions(db, activities);
            
            if (result.success) {
                await loadActivities();
            } else {
                console.error(result.message);
                Alert.alert("Error", result.message);
            }
        } catch (error) {
            console.error('Error reordering activities:', error);
            Alert.alert("Error", "Failed to reorder activities");
        }
    };

    const groupedActivities = activities.reduce((groups, activity) => {
        const group = groups[activity.group_id] || [];
        group.push(activity);
        groups[activity.group_id] = group;
        return groups;
    }, {} as Record<number, Activity[]>);

    return (
        <ScrollView style={styles.scrollContainer} contentContainerStyle={styles.scrollContent}>
            <View style={styles.container}>
                {groups.map((group) => (
                    <ActivityGroupSection
                        key={group.id}
                        group={group}
                        activities={groupedActivities[group.id] || []}
                        selectedActivities={selectedActivities}
                        onSelectActivity={onSelectActivity}
                        onAddActivity={() => {
                            setCurrentGroupId(group.id);
                            setModals({ ...modals, addActivity: true });
                        }}
                        onLongPressActivity={(activity) => {
                            setSelectedActivity(activity);
                            setModals({ ...modals, edit: true });
                        }}
                        onDeleteGroup={() => {
                            handleDeleteGroup(group.id, group.name);
                        }}
                        onReorderActivities={(activities) => {
                            handleReorderActivities(activities);
                        }}
                    />
                ))}

                <Pressable
                    style={styles.addNewGroupButton}
                    onPress={() => setModals({ ...modals, addGroup: true })}
                >
                    <Feather name="folder-plus" color={colors.text} size={20} />
                    <Text style={styles.addNewGroupText}>Add New Activity Group</Text>
                </Pressable>
            </View>

            <AddActivityModal
                visible={modals.addActivity}
                onClose={() => setModals({ ...modals, addActivity: false })}
                onAdd={handleAddActivity}
                groupName={groups.find(g => g.id === currentGroupId)?.name || ""}
            />

            <AddGroupModal
                visible={modals.addGroup}
                onClose={() => {
                    setModals({ ...modals, addGroup: false });
                    setError("");
                }}
                onAdd={handleAddGroup}
                error={error}
            />

            {modals.edit && selectedActivity && ( // Making activityedit only exist when it's required to.
                <ActivityEditModal
                    visible={modals.edit}
                    activity={selectedActivity}
                    onClose={() => {
                        setModals({ ...modals, edit: false });
                        setSelectedActivity(null);
                    }}
                    onUpdate={loadActivities}
                    db={db}
                />
            )}
        </ScrollView>
    );
}