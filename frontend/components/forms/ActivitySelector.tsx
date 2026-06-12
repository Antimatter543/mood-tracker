import { ThemeColors, useThemeColors } from "@/styles/global";
import * as SQLite from "expo-sqlite";

import Ionicons from '@expo/vector-icons/Ionicons';
import Feather from "@expo/vector-icons/Feather";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";

import React, { useMemo, useState, useRef, useCallback } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { AnimatedRef } from "react-native-reanimated";
import type Animated from "react-native-reanimated";
import Sortable, { type SortableGridDragEndParams } from "react-native-sortables";
import { Activity, ActivityGroup } from "../types";
import { ActivityEditModal } from "./ActivityEditModal";
import { ICON_FAMILIES, IconFamilyType, IconPicker } from "../IconPicker";
import { OverlayModal } from "../OverlayModal";
import { OverlayPopover, PopoverAnchor } from "../OverlayPopover";
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
    /**
     * Animated ref to the enclosing scroll container (the entry form's
     * ScrollView). When provided, the drag-to-reorder grid auto-scrolls the form
     * while a chip is dragged near an edge. Optional so the selector still works
     * standalone (no scroll integration).
     */
    scrollableRef?: AnimatedRef<Animated.ScrollView>;
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
};

type ActivityGroupSectionProps = {
    group: ActivityGroup;
    activities: Activity[];
    selectedActivities: number[];
    onSelectActivity: (id: number) => void;
    onAddActivity: () => void;
    /** Open the edit-activity modal for one activity (from the "Edit Activities" hub). */
    onEditActivity: (activity: Activity) => void;
    onDeleteGroup: () => void;
    onReorderActivities: (activities: Activity[]) => void;
    /** Whether THIS group's "..." menu is the one currently open. */
    menuOpen: boolean;
    /** Open this group's menu, anchored to the measured "..." button. */
    onOpenMenu: (anchor: PopoverAnchor) => void;
    /** Close any open menu. */
    onCloseMenu: () => void;
    /** Enclosing scroll container for the drag grid's auto-scroll (optional). */
    scrollableRef?: AnimatedRef<Animated.ScrollView>;
};

// Action menu rendered as the CONTENT of an anchored OverlayPopover (the popover
// owns positioning + dismiss-on-outside-tap, so this is just the card body).
type GroupActionMenuProps = {
    onAddActivity: () => void;
    onDeleteGroup: () => void;
    onReorderActivities: () => void;
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

    groupContainer: {
        gap: 12,
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
    // Drag-reorder grid container (react-native-sortables lays out the 5-column
    // grid itself; this just adds the horizontal inset the old wrap-list had).
    sortableGrid: {
        paddingHorizontal: 12,
    },
    activityWrapper: {
        // The chip fills its grid cell; the grid's `columns={5}` sizes the cell.
        width: '100%',
        alignItems: 'center',
        gap: 4,
        marginBottom: 4,
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
    // Dropdown menu card body (positioning is handled by OverlayPopover).
    menuContainer: {
        backgroundColor: colors.cardBackground,
        borderRadius: 8,
        padding: 4,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 3.84,
        elevation: 5,
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


export const renderActivityIcon = (
    activity: Activity,
    colors: ThemeColors,
    size = 24,
    selectedColor = '#fff'
) => {
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
    const IconComponent = ICON_FAMILIES[activity.icon_family as IconFamilyType]?.component;
    
    if (!IconComponent) {
        // Fallback if no valid icon family
        return <Feather name="circle" size={size} color={selectedColor} />;
    }

    return (
        <IconComponent.default
            name={activity.icon_name as any}
            size={size}
            color={selectedColor}
        />
    );
};

const ActivityItem = ({ activity, isSelected, onPress }: ActivityItemProps) => {
    const colors = useThemeColors();
    const styles = useStyles(colors);

    // A plain tap toggles selection. A hold-and-drag is consumed by the
    // enclosing Sortable.Grid to reorder (its drag long-press at 300ms would
    // race and cancel any chip-level long-press), so editing now lives in the
    // group "..." -> "Edit Activities" hub, NOT on a chip long-press. No
    // onLongPress here: it could never fire under the drag gesture anyway.
    return (
        <Pressable
            onPress={onPress}
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
        <OverlayModal visible={visible} onClose={onClose}>
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
                            setSelectedIconFamily(family as IconFamilyType);
                            setSelectedIconName(name);
                        }}
                        currentFamily={selectedIconFamily}
                        currentIcon={selectedIconName}
                    />
                </View>
        </OverlayModal>
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
        <OverlayModal visible={visible} onClose={onClose}>
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
                        placeholderTextColor={colors.textSecondary}
                        value={newGroupName}
                        onChangeText={setNewGroupName}
                        autoFocus
                    />
                    {error ? <Text style={styles.errorText}>{error}</Text> : null}
                    <Pressable style={styles.submitButton} onPress={handleSubmit}>
                        <Text style={styles.submitButtonText}>Create Group</Text>
                    </Pressable>
                </View>
        </OverlayModal>
    );
};


// Update the ActivityGroupSection component
const ActivityGroupSection = ({
    group,
    activities,
    selectedActivities,
    onSelectActivity,
    onAddActivity,
    onEditActivity,
    onDeleteGroup,
    onReorderActivities,
    menuOpen,
    onOpenMenu,
    onCloseMenu,
    scrollableRef,
}: ActivityGroupSectionProps) => {
    const colors = useThemeColors();
    const styles = useStyles(colors);
    const [isReordering, setIsReordering] = useState(false);
    const [anchor, setAnchor] = useState<PopoverAnchor>({ x: 0, y: 0, width: 0, height: 0 });
    const menuButtonRef = useRef<View>(null);

    // Persist a drag-reorder. react-native-sortables hands back the fully
    // reordered `data` array; the existing bulk-position helper (via
    // onReorderActivities -> updateActivityPositions) reassigns contiguous
    // 1-indexed positions and reloads, so the new order sticks.
    const handleDragEnd = useCallback(
        ({ data }: SortableGridDragEndParams<Activity>) => {
            onReorderActivities(data);
        },
        [onReorderActivities]
    );

    const renderActivity = useCallback(
        ({ item }: { item: Activity }) => (
            <ActivityItem
                activity={item}
                isSelected={selectedActivities.includes(item.id)}
                onPress={() => onSelectActivity(item.id)}
            />
        ),
        [selectedActivities, onSelectActivity]
    );

    const keyExtractor = useCallback((item: Activity) => String(item.id), []);

    const handleMenuPress = () => {
        // Measure the "..." button in window coords so the popover can anchor to
        // it, then ask the parent to open THIS group's menu (closing any other).
        const node = menuButtonRef.current;
        if (!node) {
            onOpenMenu({ x: 0, y: 0, width: 0, height: 0 });
            return;
        }
        node.measureInWindow((x, y, width, height) => {
            const a = { x, y, width, height };
            setAnchor(a);
            onOpenMenu(a);
        });
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
            <View style={styles.groupHeader}>
                <Text style={styles.groupTitle}>{group.name}</Text>
                <Pressable
                    ref={menuButtonRef}
                    style={styles.groupActionButton}
                    onPress={handleMenuPress}
                    accessibilityRole="button"
                    accessibilityLabel={`${group.name} group options`}
                >
                    <MaterialIcons name="more-vert" color={colors.text} size={20} />
                </Pressable>
            </View>

            {/* Anchored popover: a tap anywhere outside the card dismisses it. */}
            <OverlayPopover
                visible={menuOpen}
                onClose={onCloseMenu}
                anchor={anchor}
                width={200}
            >
                <GroupActionMenu
                    onAddActivity={() => {
                        onCloseMenu();
                        onAddActivity();
                    }}
                    onReorderActivities={() => {
                        onCloseMenu();
                        handleReorderActivities();
                    }}
                    onDeleteGroup={() => {
                        onCloseMenu();
                        onDeleteGroup();
                    }}
                />
            </OverlayPopover>

            {isReordering ? (
                <ActivityReorder
                    activities={activities}
                    onReorder={handleReorderComplete}
                    onClose={() => setIsReordering(false)}
                    onEditActivity={onEditActivity}
                />
            ) : (
                // Hold-and-drag to reorder WITHIN the group. A normal tap still
                // toggles selection (drag only activates after the long-press
                // delay; a tap or a scroll-intent move under the fail-offset
                // never starts a drag). On drop, onDragEnd persists the new
                // order. Cross-group drag is out of scope (each group is its own
                // independent grid). The grid auto-scrolls the enclosing form
                // ScrollView (scrollableRef) when a chip nears an edge.
                <View style={styles.sortableGrid}>
                    <Sortable.Grid
                        data={activities}
                        renderItem={renderActivity}
                        keyExtractor={keyExtractor}
                        columns={5}
                        rowGap={8}
                        columnGap={8}
                        onDragEnd={handleDragEnd}
                        dragActivationDelay={300}
                        scrollableRef={scrollableRef}
                        autoScrollEnabled={!!scrollableRef}
                    />
                </View>
            )}
        </View>
    );
};

// GroupActionMenu — the card body of the anchored popover. The popover owns
// positioning + dismiss-on-outside-tap; each handler here is pre-wired by the
// caller to close the menu before running the action.
const GroupActionMenu = ({
    onAddActivity,
    onDeleteGroup,
    onReorderActivities,
}: GroupActionMenuProps) => {
    const colors = useThemeColors();
    const styles = useStyles(colors);

    return (
        <View style={styles.menuContainer}>
            <Pressable style={styles.menuItem} onPress={onAddActivity}>
                <MaterialIcons name="add" size={18} color={colors.text} />
                <Text style={styles.menuItemText}>Add Activity</Text>
            </Pressable>

            {/* Opens the per-group activity-management hub (edit any activity +
                reorder via arrows). Drag-to-reorder is on the main grid; this is
                the door to EDITING, which the drag gesture would otherwise hide. */}
            <Pressable style={styles.menuItem} onPress={onReorderActivities}>
                <MaterialIcons name="edit" size={18} color={colors.text} />
                <Text style={styles.menuItemText}>Edit Activities</Text>
            </Pressable>

            <Pressable style={styles.menuItem} onPress={onDeleteGroup}>
                <MaterialIcons name="delete" size={18} color="#ff6b6b" />
                <Text style={[styles.menuItemText, styles.menuItemDanger]}>Delete Group</Text>
            </Pressable>
        </View>
    );
};

export function ActivitySelector({ onSelectActivity, selectedActivities, scrollableRef }: ActivitySelectorProps) {
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
    // Which group's "..." menu is open (only one at a time — opening another
    // group's menu replaces it). null = none open.
    const [openMenuGroupId, setOpenMenuGroupId] = useState<number | null>(null);

    const closeMenu = useCallback(() => setOpenMenuGroupId(null), []);

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

    // Load both activities and groups on mount. Declared after loadActivities so
    // the reference is not a temporal-dead-zone access (react-hooks 7.x flags
    // use-before-declaration even though the effect runs post-render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    React.useEffect(() => {
        loadActivities();
    }, []);

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
                        onEditActivity={(activity) => {
                            setSelectedActivity(activity);
                            setModals({ ...modals, edit: true });
                        }}
                        onDeleteGroup={() => {
                            handleDeleteGroup(group.id, group.name);
                        }}
                        onReorderActivities={(activities) => {
                            handleReorderActivities(activities);
                        }}
                        menuOpen={openMenuGroupId === group.id}
                        onOpenMenu={() => setOpenMenuGroupId(group.id)}
                        onCloseMenu={closeMenu}
                        scrollableRef={scrollableRef}
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