import { ThemeColors, useThemeColors } from "@/styles/global";
import * as SQLite from "expo-sqlite";

import Ionicons from '@expo/vector-icons/Ionicons';
import Feather from "@expo/vector-icons/Feather";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";

import React, { useMemo, useState, useRef, useCallback } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import type { AnimatedRef } from "react-native-reanimated";
import type Animated from "react-native-reanimated";
import Sortable, { type SortableGridDragEndParams } from "react-native-sortables";
import { Activity, ActivityGroup } from "../types";
import { ActivityEditModal } from "./ActivityEditModal";
import { ICON_FAMILIES, IconFamilyType, IconPicker } from "../IconPicker";
import { OverlayModal } from "../OverlayModal";
import { OverlayPopover, PopoverAnchor } from "../OverlayPopover";
import ActivityReorder from "./ActivityReorder";
import GroupReorder from "./GroupReorder";
import { GroupDeleteDialog, GroupRenameDialog } from "./GroupManageDialogs";
import { hapticDragStart } from "@/lib/haptics";
import { useDataContext } from "@/context/DataContext";
import {
    ACTIVITY_CHIP_CIRCLE_SIZE,
    ACTIVITY_CHIP_LABEL_BLOCK,
    ACTIVITY_CHIP_LABEL_GAP,
    ACTIVITY_CHIP_LABEL_LINE_HEIGHT,
    ACTIVITY_CHIP_LABEL_FONT_SIZE,
    ACTIVITY_GRID_COLUMN_GAP,
    ACTIVITY_GRID_COLUMNS,
    ACTIVITY_GRID_ROW_GAP,
    activityChipCellWidth,
    activityChipLabelLayout,
    activityGridReservedHeight,
} from "./activityGridMetrics";

import {
    getActivities,
    addActivity,
    getActivityGroups,
    addActivityGroup,
    renameActivityGroup,
    reorderActivityGroups,
    deleteActivityGroup,
    updateActivityPositions,
    getGroupDeletionImpact,
    moveActivitiesToGroup,
    type GroupDeletionImpact,
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
    /** Width of one grid cell (dp), the label's shrink budget. */
    cellWidth: number;
    /** OS accessibility font scale; a bigger scale eats the same cell. */
    fontScale: number;
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
    /** Open the rename-group dialog for this group. */
    onRenameGroup: () => void;
    /**
     * Enter GROUP move mode (collapse to name rows + drag to reorder). Fired by
     * a LONG-PRESS on the group's name, and by the "..." menu's Reorder item.
     */
    onEnterGroupMoveMode: () => void;
    onReorderActivities: (activities: Activity[]) => void;
    /** Whether THIS group's "..." menu is the one currently open. */
    menuOpen: boolean;
    /**
     * Open this group's menu (closing any other). Takes no anchor: the anchor is
     * this section's own state, refined by an async measurement — see
     * `handleMenuPress`.
     */
    onOpenMenu: () => void;
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
    onRenameGroup: () => void;
    onReorderGroups: () => void;
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
    // Wraps the title so the hold-to-reorder gesture has a comfortably sized
    // target (a bare Text is a thin strip). flexShrink lets a long group name
    // ellipsize instead of pushing the "..." button off the row.
    groupTitlePressable: {
        flexShrink: 1,
        paddingVertical: 6,
        paddingRight: 8,
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
    // Its RESERVED HEIGHT is applied per-group at the call site — see
    // `activityGridMetrics.ts` for why the grid can't be trusted to reserve it.
    sortableGrid: {
        paddingHorizontal: 12,
    },
    activityWrapper: {
        // The chip fills its grid cell; the grid's `columns` sizes the cell.
        // Row spacing is owned solely by the grid's `rowGap` (no margin here, so
        // the chip's measured height is exactly the height we reserve for it).
        width: '100%',
        alignItems: 'center',
        gap: ACTIVITY_CHIP_LABEL_GAP,
    },

    circleButton: {
        width: ACTIVITY_CHIP_CIRCLE_SIZE,
        height: ACTIVITY_CHIP_CIRCLE_SIZE,
        borderRadius: ACTIVITY_CHIP_CIRCLE_SIZE / 2,
        backgroundColor: colors.overlays.tag,
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: colors.overlays.tagBorder,
    },
    activityLabel: {
        color: colors.text,
        // Base size. A label whose longest WORD is too wide for the cell is
        // rendered a step or two smaller (per chip, via activityChipLabelLayout)
        // so the word can never be sliced across two lines.
        fontSize: ACTIVITY_CHIP_LABEL_FONT_SIZE,
        // Explicit line height + a two-line floor: a one-word chip is exactly as
        // tall as a two-word one (and a SHRUNK one is exactly as tall as both),
        // so rows are uniform and the grid's height is derivable from the item
        // count instead of from an async measurement.
        lineHeight: ACTIVITY_CHIP_LABEL_LINE_HEIGHT,
        minHeight: ACTIVITY_CHIP_LABEL_BLOCK,
        textAlign: 'center',
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

const ActivityItem = ({ activity, isSelected, onPress, cellWidth, fontScale }: ActivityItemProps) => {
    const colors = useThemeColors();
    const styles = useStyles(colors);
    // A label may never break INSIDE a word ("Unmotivate / d", Pixel 3, 2026-09-04).
    // The size is computed, not measured: see activityGridMetrics.ts.
    const label = useMemo(
        () => activityChipLabelLayout(activity.name, cellWidth, fontScale),
        [activity.name, cellWidth, fontScale]
    );

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
            <View
                testID={`activity-chip-icon-${activity.id}`}
                style={[styles.circleButton, isSelected && styles.selectedCircle]}
            >
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
            <Text
                style={[styles.activityLabel, { fontSize: label.fontSize }]}
                numberOfLines={label.numberOfLines}
                ellipsizeMode="tail"
            >
                {activity.name}
            </Text>
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
    onRenameGroup,
    onEnterGroupMoveMode,
    onReorderActivities,
    menuOpen,
    onOpenMenu,
    onCloseMenu,
    scrollableRef,
}: ActivityGroupSectionProps) => {
    const colors = useThemeColors();
    const styles = useStyles(colors);
    // Reactive (unlike PixelRatio.getFontScale()) so bumping the OS font size
    // re-reserves the grid height without a remount.
    const { fontScale, width: windowWidth } = useWindowDimensions();
    // Chip cell width, derived from the window (the grid lays out 5 fixed
    // columns). Only the label's font size reads it, see activityGridMetrics.
    const cellWidth = activityChipCellWidth(windowWidth);
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
                cellWidth={cellWidth}
                fontScale={fontScale}
            />
        ),
        [selectedActivities, onSelectActivity, cellWidth, fontScale]
    );

    const keyExtractor = useCallback((item: Activity) => String(item.id), []);

    const handleMenuPress = () => {
        // Open FIRST, measure second. `measureInWindow` is asynchronous and is
        // not guaranteed to invoke its callback at all (an unmounted or
        // not-yet-laid-out node simply never fires it) — gating the open on that
        // callback means a tap can silently do nothing, which reads as a dead
        // button. So the menu opens immediately with the last-known anchor and
        // the fresh measurement refines the position in place.
        onOpenMenu();
        menuButtonRef.current?.measureInWindow((x, y, width, height) => {
            setAnchor({ x, y, width, height });
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
                {/* HOLD the group NAME to enter group move mode. Safe here (unlike
                    on an activity chip) because this header sits OUTSIDE every
                    Sortable.Grid, so no drag gesture competes for the hold — see
                    tasks/lessons.md 2026-06-12 and the GroupReorder header comment.
                    A plain tap opens the same "..." menu the button does, so the
                    whole header is one predictable target. */}
                <Pressable
                    style={styles.groupTitlePressable}
                    onPress={handleMenuPress}
                    onLongPress={onEnterGroupMoveMode}
                    delayLongPress={400}
                    accessibilityRole="button"
                    accessibilityLabel={`${group.name} group. Hold to reorder groups.`}
                >
                    <Text style={styles.groupTitle} numberOfLines={1}>{group.name}</Text>
                </Pressable>
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
                    onRenameGroup={() => {
                        onCloseMenu();
                        onRenameGroup();
                    }}
                    onReorderGroups={() => {
                        onCloseMenu();
                        onEnterGroupMoveMode();
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
                <View
                    testID={`activity-grid-${group.id}`}
                    style={[
                        styles.sortableGrid,
                        // RESERVE the grid's height ourselves. Sortable.Grid switches
                        // to an absolute layout whose height only exists once every
                        // chip has been measured; until then it occupies ~0dp while
                        // still painting its chips, which lands them on top of the
                        // NEXT group's header (the Pixel 3 QA bug). A floor computed
                        // from the item count is known on the first render, so the
                        // space is never unreserved. See activityGridMetrics.ts.
                        { minHeight: activityGridReservedHeight(activities.length, fontScale) },
                    ]}
                >
                    <Sortable.Grid
                        data={activities}
                        renderItem={renderActivity}
                        keyExtractor={keyExtractor}
                        columns={ACTIVITY_GRID_COLUMNS}
                        rowGap={ACTIVITY_GRID_ROW_GAP}
                        columnGap={ACTIVITY_GRID_COLUMN_GAP}
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
    onRenameGroup,
    onReorderGroups,
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

            <Pressable
                style={styles.menuItem}
                onPress={onRenameGroup}
                accessibilityRole="button"
                accessibilityLabel="Rename group"
            >
                <MaterialIcons name="drive-file-rename-outline" size={18} color={colors.text} />
                <Text style={styles.menuItemText}>Rename Group</Text>
            </Pressable>

            {/* Discoverable twin of the hold-the-group-name gesture: the same
                move mode, reachable without knowing the gesture exists. */}
            <Pressable
                style={styles.menuItem}
                onPress={onReorderGroups}
                accessibilityRole="button"
                accessibilityLabel="Reorder groups"
            >
                <MaterialIcons name="swap-vert" size={18} color={colors.text} />
                <Text style={styles.menuItemText}>Reorder Groups</Text>
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
    // Every write below changes the activity CATALOGUE, which other screens
    // render (Home's "Recent activities" and "Explore your activities",
    // Insights' per-activity views). Reloading only this component's own list
    // left those screens showing the old catalogue until the user navigated
    // away and back -- the same stale-until-refocus class as the entries path.
    // See reloadAfterWrite below.
    const { refetchEntries } = useDataContext();

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

    // GROUP MOVE MODE: the whole selector collapses to draggable group-name rows.
    // Entered by holding a group's name (or via the "..." menu).
    const [groupMoveMode, setGroupMoveMode] = useState(false);

    // Rename-group dialog: the target group + the last submit's error message.
    const [renameTarget, setRenameTarget] = useState<ActivityGroup | null>(null);
    const [renameError, setRenameError] = useState("");

    // Delete-group dialog: the target group, what deleting it would destroy
    // (measured on open), and the last attempt's error message.
    const [deleteTarget, setDeleteTarget] = useState<ActivityGroup | null>(null);
    const [deleteImpact, setDeleteImpact] = useState<GroupDeletionImpact | null>(null);
    const [deleteError, setDeleteError] = useState("");

    const closeMenu = useCallback(() => setOpenMenuGroupId(null), []);

    const loadActivities = async () => {
        try {
            // Read BOTH, then commit BOTH in the same tick. Awaiting the groups
            // and the activities separately published a render in which the
            // groups existed but their activities did not — every group mounted
            // an EMPTY Sortable.Grid, which primes the grid's container height at
            // 0 and flips it into absolute layout; the chips then arrived into a
            // zero-height container and painted over the next group's header.
            // React does not batch across an `await`, so the two setState calls
            // must share one continuation. (Groups still come from the ONE
            // canonical ordered read — see databases/groups.ts.)
            const [groupsResult, activitiesResult] = await Promise.all([
                getActivityGroups(db),
                getActivities(db),
            ]);
            setGroups(groupsResult);
            setActivities(activitiesResult);
        } catch (error) {
            console.error('Error loading activities and groups:', error);
        }
    };

    /**
     * Reload this component's list AND tell the rest of the app the activity
     * catalogue changed. Use this after every WRITE; use bare `loadActivities`
     * only when re-reading state that did not change here (mount, or a
     * "reality diverged, resync" read). `refetchEntries` bumps the external
     * data-version store, which is the only signal that reaches the tab screens
     * (see context/dataRefreshStore.ts for why a context value does not).
     */
    const reloadAfterWrite = async () => {
        await loadActivities();
        refetchEntries();
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
                await reloadAfterWrite();
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
            await reloadAfterWrite();
            setNewGroupName("");
            setModals({ ...modals, addGroup: false });
            setError("");
        } else {
            setError(result.message);
        }
    };

    /**
     * Open the delete dialog, having first MEASURED what the delete would
     * destroy. The count is fetched before the dialog opens so the warning is
     * never a vague "this cannot be undone" — it names the activities and the
     * entries that lose their history (ON DELETE CASCADE reaches both).
     */
    const handleDeleteGroup = async (group: ActivityGroup) => {
        const impact = await getGroupDeletionImpact(db, group.id);

        if (!impact.exists) {
            // Either the group vanished (another surface deleted it) or the read
            // failed — both mean "don't offer a destructive action". Reload so
            // the list matches reality.
            Alert.alert("Error", "Activity group not found");
            await loadActivities();
            return;
        }

        setDeleteError("");
        setDeleteImpact(impact);
        setDeleteTarget(group);
    };

    const closeDeleteDialog = () => {
        setDeleteTarget(null);
        setDeleteImpact(null);
        setDeleteError("");
    };

    const handleConfirmDeleteGroup = async () => {
        if (!deleteTarget) return;

        const result = await deleteActivityGroup(db, deleteTarget.id);

        if (result.success) {
            closeDeleteDialog();
            await reloadAfterWrite();
        } else {
            setDeleteError(result.message);
        }
    };

    /**
     * The safe alternative offered inside the delete dialog: re-file this
     * group's activities into another group instead of destroying them. The
     * dialog stays OPEN afterwards with a freshly measured impact, so the user
     * can see the group is now empty (or what stayed behind) and decide about
     * the delete with current information rather than the pre-move numbers.
     */
    const handleMoveGroupActivities = async (targetGroupId: number) => {
        if (!deleteTarget) return;

        const result = await moveActivitiesToGroup(db, deleteTarget.id, targetGroupId);

        if (!result.success) {
            setDeleteError(result.message);
            return;
        }

        setDeleteError(
            result.skipped.length
                ? `${result.message}. Left behind (a same-named activity already exists there): ${result.skipped.join(', ')}`
                : ""
        );

        await reloadAfterWrite();
        setDeleteImpact(await getGroupDeletionImpact(db, deleteTarget.id));
    };

    const handleRenameGroup = async (name: string) => {
        if (!renameTarget) return;

        const result = await renameActivityGroup(db, renameTarget.id, name);

        if (result.success) {
            setRenameTarget(null);
            setRenameError("");
            await reloadAfterWrite();
        } else {
            setRenameError(result.message);
        }
    };

    /**
     * Persist a group drag-drop. Optimistic: the reordered array is pushed into
     * local state immediately so the rows stay where the finger dropped them,
     * then the write lands and `loadActivities` re-reads the canonical order. On
     * failure the reload snaps the list back to what is actually stored.
     */
    const handleReorderGroups = async (reordered: ActivityGroup[]) => {
        setGroups(reordered);

        const result = await reorderActivityGroups(db, reordered);

        if (!result.success) {
            Alert.alert("Error", result.message);
        }

        await reloadAfterWrite();
    };

    const enterGroupMoveMode = () => {
        // The buzz is the confirmation that the hold registered — without it a
        // long-press that changes the whole screen feels like a glitch.
        hapticDragStart();
        closeMenu();
        setGroupMoveMode(true);
    };

    const handleReorderActivities = async (activities: Activity[]) => {
        try {
            const result = await updateActivityPositions(db, activities);
            
            if (result.success) {
                await reloadAfterWrite();
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
            {/* MOVE MODE collapses the whole selector to draggable group-name
                rows — Anti's ask: hold a group name and the chips get out of the
                way so the order is one uninterrupted gesture. Everything else
                (chips, add-group) is unmounted rather than hidden, so no stray
                grid competes for the drag. */}
            {groupMoveMode ? (
                <GroupReorder
                    groups={groups}
                    onReorder={handleReorderGroups}
                    onDone={() => setGroupMoveMode(false)}
                    scrollableRef={scrollableRef}
                />
            ) : (
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
                                handleDeleteGroup(group);
                            }}
                            onRenameGroup={() => {
                                setRenameError("");
                                setRenameTarget(group);
                            }}
                            onEnterGroupMoveMode={enterGroupMoveMode}
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
            )}

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

            <GroupRenameDialog
                visible={!!renameTarget}
                group={renameTarget}
                onClose={() => {
                    setRenameTarget(null);
                    setRenameError("");
                }}
                onSubmit={handleRenameGroup}
                error={renameError}
            />

            <GroupDeleteDialog
                visible={!!deleteTarget}
                group={deleteTarget}
                impact={deleteImpact}
                otherGroups={groups.filter((g) => g.id !== deleteTarget?.id)}
                onMoveActivities={handleMoveGroupActivities}
                onConfirmDelete={handleConfirmDeleteGroup}
                onClose={closeDeleteDialog}
                error={deleteError}
            />

            {modals.edit && selectedActivity && ( // Making activityedit only exist when it's required to.
                <ActivityEditModal
                    visible={modals.edit}
                    activity={selectedActivity}
                    groups={groups}
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