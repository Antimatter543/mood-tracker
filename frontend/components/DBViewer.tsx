import React, { useEffect, useMemo, useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    Pressable,
    SectionList,
    ActivityIndicator,
    Image,
    ScrollView,
    Modal,
    Dimensions,
    FlatList,
} from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { useThemeColors } from '@/styles/global';
import { useDataContext } from '@/context/DataContext';
import { MoodEntry, Activity, EntryPhoto } from './types';


import Feather from '@expo/vector-icons/Feather';

import { Card } from './Card';
import { EntryFormData, EntryFormModal } from './forms/EntryForm';
import { EmptyState } from './EmptyState';
import { getMediaByEntryIds } from '@/databases/entry-media';
import { MEDIA_DIR, copyToMediaDir, deleteMediaFile } from '@/databases/mediaHelpers';

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
            padding: 16,
            marginBottom: 8,
            borderLeftWidth: 2,
            borderLeftColor: colors.accent,
        },
        loadingFooter: {
            paddingVertical: 20,
            alignItems: 'center',
        },
        sectionHeader: {
            backgroundColor: colors.accentLight,
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
            minHeight: 44,
            minWidth: 44,
            alignItems: 'center',
            justifyContent: 'center',
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
            minHeight: 44,
            minWidth: 44,
            alignItems: 'center',
            justifyContent: 'center',
        },
        photoStrip: {
            flexDirection: 'row',
            marginTop: 8,
            paddingHorizontal: 4,
        },
        photoThumb: {
            width: 64,
            height: 64,
            borderRadius: 6,
            marginRight: 6,
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
                <Pressable
                    style={styles.editButton}
                    onPress={onEdit}
                    accessibilityRole="button"
                    accessibilityLabel="Edit entry"
                    hitSlop={8}
                >
                    <Feather name="pen-tool" color={colors.text} size={16} />
                </Pressable>
                <Pressable
                    style={[styles.actionButton, styles.deleteButton]}
                    onPress={() => onDelete(entry.id)}
                    accessibilityRole="button"
                    accessibilityLabel="Delete entry"
                    hitSlop={8}
                >
                    <Feather name="trash-2" color={colors.text} size={16} />
                </Pressable>
            </View>
        </View>

        <ActivitiesList activities={entry.activities} styles={styles} />
        {entry.notes && <Text style={styles.notes}>Notes: {entry.notes}</Text>}
        {entry.photos && entry.photos.length > 0 && (
            <PhotoStrip photos={entry.photos} styles={styles} colors={colors} />
        )}
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

const { width: VIEWER_WIDTH, height: VIEWER_HEIGHT } = Dimensions.get('window');

/**
 * Full-screen, swipeable photo viewer. Opens at `initialIndex` and pages
 * horizontally through the entry's photos. Used by PhotoStrip below.
 */
const PhotoViewer: React.FC<{
    visible: boolean;
    photos: EntryPhoto[];
    initialIndex: number;
    onClose: () => void;
}> = ({ visible, photos, initialIndex, onClose }) => {
    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
            <View style={viewerStyles.overlay}>
                <Pressable
                    style={viewerStyles.closeButton}
                    onPress={onClose}
                    accessibilityRole="button"
                    accessibilityLabel="Close photo viewer"
                    hitSlop={16}
                >
                    <Feather name="x" size={28} color="#fff" />
                </Pressable>
                <FlatList
                    data={photos}
                    horizontal
                    pagingEnabled
                    showsHorizontalScrollIndicator={false}
                    keyExtractor={(p) => String(p.id)}
                    initialScrollIndex={Math.min(initialIndex, Math.max(photos.length - 1, 0))}
                    getItemLayout={(_, index) => ({
                        length: VIEWER_WIDTH,
                        offset: VIEWER_WIDTH * index,
                        index,
                    })}
                    renderItem={({ item }) => (
                        <Image
                            source={{ uri: item.file_path }}
                            style={{ width: VIEWER_WIDTH, height: VIEWER_HEIGHT * 0.85 }}
                            resizeMode="contain"
                        />
                    )}
                />
            </View>
        </Modal>
    );
};

/**
 * Horizontal strip of entry thumbnails. Tapping a thumbnail opens the
 * full-screen PhotoViewer at that photo.
 */
const PhotoStrip: React.FC<{ photos: EntryPhoto[]; styles: any; colors: any }> = ({
    photos,
    styles,
    colors,
}) => {
    const [viewerVisible, setViewerVisible] = useState(false);
    const [activeIndex, setActiveIndex] = useState(0);

    if (!photos.length) return null;

    return (
        <>
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.photoStrip}
            >
                {photos.map((photo, index) => (
                    <Pressable
                        key={photo.id}
                        onPress={() => {
                            setActiveIndex(index);
                            setViewerVisible(true);
                        }}
                        accessibilityRole="imagebutton"
                        accessibilityLabel={`View photo ${index + 1}`}
                    >
                        <Image
                            source={{ uri: photo.file_path }}
                            style={[
                                styles.photoThumb,
                                { backgroundColor: colors.cardBackground },
                            ]}
                            resizeMode="cover"
                        />
                    </Pressable>
                ))}
            </ScrollView>
            <PhotoViewer
                visible={viewerVisible}
                photos={photos}
                initialIndex={activeIndex}
                onClose={() => setViewerVisible(false)}
            />
        </>
    );
};

const viewerStyles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.95)',
        justifyContent: 'center',
    },
    closeButton: {
        position: 'absolute',
        top: 48,
        right: 20,
        zIndex: 10,
        padding: 8,
    },
});


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

            const baseEntries: MoodEntry[] = result.map(row => ({
                id: row.id,
                mood: row.mood,
                notes: row.notes,
                date: row.date,
                activities: row.activity_ids ? row.activity_ids.split(',').map((id: string, index: number) => ({
                    id: parseInt(id),
                    name: row.activity_names.split(',')[index],
                    group_id: parseInt(row.activity_group_ids.split(',')[index]),
                    icon_name: row.activity_icon_names.split(',')[index]
                })) : [],
                photos: [],
            }));

            // Batch-load photos for the whole page in a single query (avoids
            // the N+1 the per-entry GROUP_CONCAT pattern would create if we
            // joined entry_media into the big query and re-split it).
            const mediaByEntry = await getMediaByEntryIds(
                db,
                baseEntries.map(e => e.id)
            );
            for (const entry of baseEntries) {
                entry.photos = mediaByEntry[entry.id] ?? [];
            }

            return baseEntries;
        } catch (error) {
            console.error('Error fetching entries page:', error);
            return [];
        }
    };

    // Event Handlers
    const handleDelete = async (entryId: number) => {
        try {
            // Delete photo FILES first, while their paths are still queryable.
            // SQLite ON DELETE CASCADE removes the entry_media ROWS when the
            // entry is deleted, but never the files on disk — without this the
            // images would orphan in MEDIA_DIR forever.
            const media = await getMediaByEntryIds(db, [entryId]);
            await Promise.all(
                (media[entryId] ?? []).map(p => deleteMediaFile(p.file_path))
            );

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
            // ---- Photo diff (computed against the entry's current DB photos) ----
            // The edit form seeds `formData.photos` with existing MEDIA_DIR
            // paths; the user may have removed some and/or added new picker
            // source URIs. Photos already under MEDIA_DIR are kept as-is; any
            // path NOT under MEDIA_DIR is a freshly-picked source URI to copy.
            const dbPhotos = (await getMediaByEntryIds(db, [currentEntry.id]))[
                currentEntry.id
            ] ?? [];
            const draftPaths = new Set(formData.photos);

            const removedPhotos = dbPhotos.filter(p => !draftPaths.has(p.file_path));
            const addedSourceUris = formData.photos.filter(
                p => !p.startsWith(MEDIA_DIR)
            );

            // Copy newly-picked photos into MEDIA_DIR BEFORE the transaction
            // (file IO must not hold the write lock). Orphaned only if the
            // transaction below throws — acceptable for the rare failure case.
            const addedPaths: string[] = [];
            for (const uri of addedSourceUris) {
                addedPaths.push(await copyToMediaDir(uri));
            }

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

                for (const photo of removedPhotos) {
                    await db.runAsync('DELETE FROM entry_media WHERE id = ?', [photo.id]);
                }

                for (const path of addedPaths) {
                    await db.runAsync(
                        `INSERT INTO entry_media (entry_id, file_path, media_type) VALUES (?, ?, 'image')`,
                        [currentEntry.id, path]
                    );
                }
            });

            // Files for removed photos are unlinked AFTER the rows are gone, so
            // a transaction rollback can't leave us with a missing file but a
            // live row. Best-effort: a failed unlink never blocks the update.
            await Promise.all(removedPhotos.map(p => deleteMediaFile(p.file_path)));

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
                    date: new Date(currentEntry.date),
                    photos: (currentEntry.photos ?? []).map(p => p.file_path),
                } : undefined}
                onSubmit={handleUpdate}
            />
        </>
    );
}