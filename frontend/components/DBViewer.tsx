import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, SectionList, ActivityIndicator } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { colors, useThemeColors } from '@/styles/global';
import { useDataContext } from '@/context/DataContext';
import { MoodEntry, Activity } from './types';


import Feather from '@expo/vector-icons/Feather';

import { Card } from './Card';
import { EntryFormData, EntryFormModal } from './forms/EntryForm';
import { EmptyState } from './EmptyState';

const ITEMS_PER_PAGE = 20;

// Types
type Section = {
    title: string;
    data: MoodEntry[];
};


type EntryCardProps = {
    entry: MoodEntry;
    onEdit: () => void;
    onDelete: (id: number) => void;
    styles: any;
    colors: any;
};

const useThemedStyles = (colors: any) => {
    return useMemo(() => StyleSheet.create({
        container: {
            paddingHorizontal: 16,
        },
        loadingContainer: {
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
        },
        cardCustom: {
            padding: 16,  // Add padding back
            marginBottom: 8,  // Slightly more space between cards
        },
        loadingFooter: {
            paddingVertical: 20,
            alignItems: 'center',
        },
        sectionHeader: {
            backgroundColor: colors.secondaryBackground,
            paddingVertical: 8,
            paddingHorizontal: 16,
            marginTop: 16,
            marginBottom: 8,
            borderRadius: 8,
        },
        sectionHeaderText: {
            color: colors.text,
            fontSize: 16,
            fontWeight: '600',
        },
        cardHeader: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 12,  // A bit more space below header
            paddingHorizontal: 4,  // Small horizontal padding
        },
        editButton: {
            padding: 8,
            borderRadius: 20,
            backgroundColor: colors.overlays.tag,
        },
        moodValue: {
            color: colors.text,
            fontSize: 18,
            fontWeight: 'bold',
        },
        activitiesContainer: {
            marginTop: 8,
            marginBottom: 8,
            paddingHorizontal: 4,  // Consistent padding
        },
        sectionTitle: {
            color: colors.text,
            fontSize: 14,
            marginBottom: 4,
            opacity: 0.8,
        },
        activitiesList: {
            flexDirection: 'row',
            flexWrap: 'wrap',
            marginTop: 4,
            gap: 8,
        },
        activityTag: {
            backgroundColor: colors.overlays.tag,
            paddingHorizontal: 12,
            paddingVertical: 6,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: colors.overlays.tagBorder,
        },
        activityText: {
            color: colors.text,
            fontSize: 12,
        },
        notes: {
            color: colors.text,
            marginTop: 8,
            fontStyle: 'italic',
            paddingHorizontal: 4,  // Add some padding here too
        },
        date: {
            color: colors.text,
            fontSize: 12,
            marginTop: 8,
            opacity: 0.7,
            paddingHorizontal: 4,  // Add some padding to prevent text from touching edges
        },
        modalContainer: {
            flex: 1,
            backgroundColor: colors.background,
        },
        modalHeader: {
            paddingTop: 40,
            paddingHorizontal: 20,
            flexDirection: "row",
            justifyContent: "flex-start",
        },
        closeButton: {
            padding: 8,
        },
        modalContent: {
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 20,
        },
        modalTitle: {
            color: colors.text,
            fontSize: 24,
            fontWeight: "bold",
            marginBottom: 30,
        },
        continueButton: {
            backgroundColor: colors.accent,
            margin: 20,
            padding: 15,
            borderRadius: 25,
            alignItems: 'center',
            width: '100%',
        },
        continueButtonText: {
            color: '#fff',
            fontSize: 16,
            fontWeight: 'bold',
        },
        label: {
            color: colors.text,
            fontSize: 16,
            marginBottom: 8,
            alignSelf: "flex-start",
        },
        noteInput: {
            backgroundColor: colors.cardBackground,
            borderRadius: 8,
            padding: 12,
            marginBottom: 16,
            color: colors.text,
            fontSize: 16,
            width: "100%",
            minHeight: 100,
            textAlignVertical: "top",
        },
        buttonContainer: {
            flexDirection: "row",
            justifyContent: "space-between",
            width: "100%",
            marginTop: 20,
        },
        navigationButton: {
            flex: 1,
            padding: 15,
            borderRadius: 25,
            alignItems: "center",
            marginHorizontal: 5,
        },
        backButton: {
            backgroundColor: colors.overlays.tag,
        },
        submitButton: {
            backgroundColor: colors.accent,
        },
        buttonText: {
            color: colors.text,
            fontSize: 16,
            fontWeight: '600',
        },
        actionButton: {
            padding: 8,
            borderRadius: 20,
            backgroundColor: colors.overlays.tag,
            flexDirection: 'row',
            gap: 8,  // This adds space between the buttons
        },
        deleteButton: {
            backgroundColor: 'rgba(255, 68, 68, 0.2)', // Keep error color consistent
        },
    }), [colors]);
}

// Helper Functions
const groupEntriesByDate = (entries: MoodEntry[]): Section[] => {
    const grouped = entries.reduce((acc: { [key: string]: MoodEntry[] }, entry) => {
        const date = new Date(entry.date);
        const dateKey = date.toLocaleDateString(undefined, {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });

        if (!acc[dateKey]) {
            acc[dateKey] = [];
        }
        acc[dateKey].push(entry);
        return acc;
    }, {});

    return Object.entries(grouped).map(([title, data]) => ({
        title,
        data
    }));
};

// Sub-Components
const EntryCard: React.FC<EntryCardProps> = ({ entry, onEdit, onDelete, styles, colors }) => (
    <Card style={styles.cardCustom}>
        <View style={styles.cardHeader}>
            <Text style={styles.moodValue}>Mood: {entry.mood}</Text>
            <View style={styles.actionButton}>
                <Pressable style={styles.editButton} onPress={onEdit}>
                    <Feather name="pen-tool" color={colors.text} size={16} />
                </Pressable>
                <Pressable
                    style={[styles.actionButton, styles.deleteButton]}
                    onPress={() => onDelete(entry.id)}
                >
                    <Feather name="trash-2" color={colors.text} size={16} />
                </Pressable>
            </View>
        </View>

        <ActivitiesList activities={entry.activities} styles={styles} />
        {entry.notes && <Text style={styles.notes}>Notes: {entry.notes}</Text>}
        <Text style={styles.date}>
            {new Date(entry.date).toLocaleTimeString()}
        </Text>
    </Card>
);

const ActivitiesList: React.FC<{ activities: Activity[], styles: any }> = ({ activities, styles }) => {
    if (activities.length === 0) return null;

    return (
        <View style={styles.activitiesContainer}>
            <Text style={styles.sectionTitle}>Activities:</Text>
            <View style={styles.activitiesList}>
                {activities.map((activity: Activity, index: number) => (
                    <View key={index} style={styles.activityTag}>
                        <Text style={styles.activityText}>{activity.name}</Text>
                    </View>
                ))}
            </View>
        </View>
    );
};


// Main Component
export function DatabaseViewer() {
    const colors = useThemeColors();
    const styles = useThemedStyles(colors);
    const db = useSQLiteContext();
    const { refetchEntries, refreshCount } = useDataContext();

    // State
    const [sections, setSections] = useState<Section[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [page, setPage] = useState(0);
    const [editModalVisible, setEditModalVisible] = useState(false);
    const [currentEntry, setCurrentEntry] = useState<MoodEntry | null>(null);

    // Data Fetching
    const fetchEntriesPage = async (pageNum: number) => {
        const offset = pageNum * ITEMS_PER_PAGE;
        try {
            const result = await db.getAllAsync<any>(`
                WITH EntryData AS (
                    SELECT 
                        e.id, e.mood, e.notes, e.date,
                        GROUP_CONCAT(a.id) as activity_ids,
                        GROUP_CONCAT(a.name) as activity_names,
                        GROUP_CONCAT(a.group_id) as activity_group_ids,
                        GROUP_CONCAT(a.icon_name) as activity_icon_names
                    FROM entries e
                    LEFT JOIN entry_activities ea ON e.id = ea.entry_id
                    LEFT JOIN activities a ON ea.activity_id = a.id
                    GROUP BY e.id
                    ORDER BY e.date DESC
                    LIMIT ? OFFSET ?
                )
                SELECT * FROM EntryData
            `, [ITEMS_PER_PAGE, offset]);

            return result.map(row => ({
                id: row.id,
                mood: row.mood,
                notes: row.notes,
                date: row.date,
                activities: row.activity_ids ? row.activity_ids.split(',').map((id: string, index: number) => ({
                    id: parseInt(id),
                    name: row.activity_names.split(',')[index],
                    group_id: parseInt(row.activity_group_ids.split(',')[index]),
                    icon_name: row.activity_icon_names.split(',')[index]
                })) : []
            }));
        } catch (error) {
            console.error('Error fetching entries page:', error);
            return [];
        }
    };

    // Event Handlers
    const handleDelete = async (entryId: number) => {
        try {
            await db.runAsync('DELETE FROM entries WHERE id = ?', [entryId]);
            setSections(currentSections => {
                const updatedSections = currentSections
                    .map(section => ({
                        ...section,
                        data: section.data.filter(entry => entry.id !== entryId)
                    }))
                    .filter(section => section.data.length > 0);
                return updatedSections;
            });
            refetchEntries();
        } catch (error) {
            console.error('Error deleting entry:', error);
        }
    };

    const handleUpdate = async (formData: EntryFormData) => {
        if (!currentEntry) return;

        try {
            await db.withTransactionAsync(async () => {
                await db.runAsync(
                    `UPDATE entries SET mood = ?, notes = ?, date = ? WHERE id = ?`,
                    [formData.mood, formData.notes, formData.date.toISOString(), currentEntry.id]
                );

                await db.runAsync(
                    'DELETE FROM entry_activities WHERE entry_id = ?',
                    [currentEntry.id]
                );

                for (const activityId of formData.activities) {
                    await db.runAsync(
                        'INSERT INTO entry_activities (entry_id, activity_id) VALUES (?, ?)',
                        [currentEntry.id, activityId]
                    );
                }
            });

            setEditModalVisible(false);
            refetchEntries();
        } catch (error) {
            console.error('Error updating entry:', error);
        }
    };

    // Effects
    useEffect(() => {
        const loadInitialData = async () => {
            setIsLoading(true);
            try {
                const initialEntries = await fetchEntriesPage(0);
                setSections(groupEntriesByDate(initialEntries));
                setPage(0);
                setHasMore(initialEntries.length === ITEMS_PER_PAGE);
            } catch (error) {
                console.error('Error loading initial data:', error);
            }
            setIsLoading(false);
        };

        loadInitialData();
    }, [db, refreshCount]);

    const loadMoreData = async () => {
        if (isLoadingMore || !hasMore) return;

        setIsLoadingMore(true);
        try {
            const nextPage = page + 1;
            const newEntries = await fetchEntriesPage(nextPage);

            if (newEntries.length > 0) {
                setSections(prevSections => {
                    const allEntries = [...prevSections.flatMap(s => s.data), ...newEntries];
                    return groupEntriesByDate(allEntries);
                });
                setPage(nextPage);
                setHasMore(newEntries.length === ITEMS_PER_PAGE);
            } else {
                setHasMore(false);
            }
        } catch (error) {
            console.error('Error loading more data:', error);
        }
        setIsLoadingMore(false);
    };

    // Render Methods
    const renderItem = ({ item: entry }: { item: MoodEntry }) => (
        <EntryCard
            entry={entry}
            onEdit={() => {
                setCurrentEntry(entry);
                setEditModalVisible(true);
            }}
            onDelete={handleDelete}
            styles={styles}
            colors={colors}
        />
    );

    const renderSectionHeader = ({ section: { title } }: { section: Section }) => (
        <Card style={styles.sectionHeader}>
            <Text style={styles.sectionHeaderText}>{title}</Text>
        </Card>
    );

    if (isLoading) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={colors.accent} />
            </View>
        );
    }


    if (sections.length === 0) {
        return <EmptyState />;
    }

    return (
        <>
            <SectionList
                sections={sections}
                renderItem={renderItem}
                renderSectionHeader={renderSectionHeader}
                keyExtractor={item => item.id.toString()}
                onEndReached={loadMoreData}
                onEndReachedThreshold={0.5}
                stickySectionHeadersEnabled={true}
                maintainVisibleContentPosition={{
                    minIndexForVisible: 0,
                }}
                ListFooterComponent={isLoadingMore ? (
                    <View style={styles.loadingFooter}>
                        <ActivityIndicator size="small" color={colors.accent} />
                    </View>
                ) : null}
                contentContainerStyle={styles.container}
            />
            <EntryFormModal
                visible={editModalVisible}
                onClose={() => setEditModalVisible(false)}
                initialData={currentEntry ? {
                    mood: currentEntry.mood,
                    activities: currentEntry.activities.map(a => a.id),
                    notes: currentEntry.notes,
                    date: new Date(currentEntry.date)
                } : undefined}
                onSubmit={handleUpdate}
            />
        </>
    );
}