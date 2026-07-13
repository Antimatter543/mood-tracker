import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    View,
    Text,
    Pressable,
    StyleSheet,
    SectionList,
    ActivityIndicator,
    Alert,
} from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { useThemeColors } from '@/styles/global';
import { useDataContext } from '@/context/DataContext';
import { useDataRefresh } from '@/hooks/useDataRefresh';
import { useLatestRun } from '@/hooks/useLatestRun';
import { MoodEntry } from './types';

import { EntryFormData, EntryFormModal } from './forms/EntryForm';
import { EmptyState } from './EmptyState';
import { EntryCard } from './timeline/EntryCard';
import { TimelineSearchBar } from './timeline/TimelineSearchBar';
import {
    moodPresetToRange,
    EntryFilters,
    MoodPresetKey,
} from './timeline/entryFilter';
import { sectionKeyForDate, formatSectionTitle } from './timeline/dateHeader';
// The DB layer owns ALL SQL now: this component reads pages via getEntriesPage
// and mutates via updateMoodEntry / deleteMoodEntry (databases/entries.ts). The
// component is hooks + rendering only — zero SQL, zero transactions.
import { getEntriesPage, updateMoodEntry, deleteMoodEntry } from '@/databases/entries';

const ITEMS_PER_PAGE = 20;
// Debounce the search text before it hits SQL so each keystroke doesn't fire a
// paged query; the mood chips filter instantly (no debounce needed).
const SEARCH_DEBOUNCE_MS = 250;

// Types — `key` is the stable local-day bucket; `title` is its humanized label.
type Section = {
    key: string;
    title: string;
    data: MoodEntry[];
};

const useThemedStyles = (colors: any) => {
    return useMemo(() => StyleSheet.create({
        // Root fills the tab body so the search bar pins at the top and the list
        // (or the loading / empty branch below it) takes the remaining space.
        root: {
            flex: 1,
        },
        container: {
            paddingHorizontal: 16,
        },
        loadingContainer: {
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
        },
        // Distinct "no results" state shown ONLY while a filter is active — it
        // reads as "your filter matched nothing" (and offers a reset), never as
        // "add your first entry" (that's <EmptyState/>, for a truly empty DB).
        emptyFilterContainer: {
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
            paddingHorizontal: 32,
        },
        emptyFilterText: {
            color: colors.textSecondary,
            fontSize: 15,
            textAlign: 'center',
            marginBottom: 16,
        },
        clearFiltersButton: {
            paddingVertical: 8,
            paddingHorizontal: 16,
        },
        clearFiltersText: {
            color: colors.accent,
            fontSize: 15,
            fontWeight: '600',
        },
        // Inline load-error state — shown ONLY when a read failed AND there's
        // nothing already on screen. It must NEVER be the EmptyState ("add your
        // first entry"): a transient read failure over a full DB is an error, not
        // an empty database. Offers a retry that re-runs the loader.
        errorContainer: {
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
            paddingHorizontal: 32,
        },
        errorText: {
            color: colors.textSecondary,
            fontSize: 15,
            textAlign: 'center',
            marginBottom: 16,
        },
        retryButton: {
            paddingVertical: 8,
            paddingHorizontal: 16,
        },
        retryText: {
            color: colors.accent,
            fontSize: 15,
            fontWeight: '600',
        },
        loadingFooter: {
            paddingVertical: 20,
            alignItems: 'center',
        },
        // Lightweight text section header — no card bubble. A subtle hairline
        // rule + generous top margin separate date groups; the title is small,
        // semibold and muted. A solid background so sticky headers don't show
        // list rows bleeding through as they scroll under.
        sectionHeader: {
            backgroundColor: colors.background,
            paddingTop: 24,
            paddingBottom: 8,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: colors.border,
            marginBottom: 8,
        },
        sectionHeaderText: {
            color: colors.textSecondary,
            fontSize: 13,
            fontWeight: '600',
            letterSpacing: 0.3,
            textTransform: 'uppercase',
        },
    }), [colors]);
}

// Helper Functions
const groupEntriesByDate = (entries: MoodEntry[], now: Date = new Date()): Section[] => {
    const grouped = entries.reduce((acc: { [key: string]: MoodEntry[] }, entry) => {
        const key = sectionKeyForDate(entry.date);
        if (!acc[key]) acc[key] = [];
        acc[key].push(entry);
        return acc;
    }, {});

    return Object.entries(grouped).map(([key, data]) => ({
        key,
        title: formatSectionTitle(key, now),
        data,
    }));
};

// Main Component
export function DatabaseViewer() {
    const colors = useThemeColors();
    const styles = useThemedStyles(colors);
    const db = useSQLiteContext();
    // refetchEntries bumps the global data version after writes here; the
    // focus-aware useDataRefresh below consumes that bump (no direct refreshCount
    // read needed — the hook reads it internally).
    const { refetchEntries } = useDataContext();

    // State
    const [sections, setSections] = useState<Section[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    // True once the first load has resolved. Gates the full-screen spinner to
    // the initial load only, so on-focus refetches don't flash a spinner over
    // the already-rendered list. A ref (not state) — it's read inside the
    // loader and must not trigger a re-render when it flips.
    const hasLoadedOnce = useRef(false);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [page, setPage] = useState(0);
    const [editModalVisible, setEditModalVisible] = useState(false);
    const [currentEntry, setCurrentEntry] = useState<MoodEntry | null>(null);
    // True when the last initial load FAILED. Drives the inline "couldn't load"
    // + retry UI (only when there are no sections to show) — so a transient read
    // failure never blanks a full DB into the EmptyState. Cleared on any
    // successful load.
    const [loadError, setLoadError] = useState(false);

    // Search + mood filter. `searchQuery` is the RAW input (drives the field with
    // zero lag); `debouncedQuery` is what actually reaches SQL. `moodPresetKey`
    // is the selected mood band (no debounce — chip taps filter immediately).
    const [searchQuery, setSearchQuery] = useState('');
    const [moodPresetKey, setMoodPresetKey] = useState<MoodPresetKey>('all');
    const [debouncedQuery, setDebouncedQuery] = useState('');
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedQuery(searchQuery), SEARCH_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    // The SQL-facing filter state. Recomputed only when the debounced query or
    // the mood preset changes.
    const filters = useMemo<EntryFilters>(
        () => ({ query: debouncedQuery, moodRange: moodPresetToRange(moodPresetKey) }),
        [debouncedQuery, moodPresetKey]
    );
    // The non-memoized loaders (loadMoreData, and fetchEntriesPage which they
    // share) close over stale state; a ref updated every render lets them read
    // the CURRENT filter without threading it through — and, crucially, without
    // touching the useLatestRun / useDataRefresh latch wiring.
    const filtersRef = useRef(filters);
    filtersRef.current = filters;

    // Any active filter switches the empty branch from "add your first entry" to
    // the filter-specific "nothing matched" message (with a reset).
    const isFiltering = debouncedQuery.trim() !== '' || moodPresetKey !== 'all';

    // Run-sequence latch — the SAME guard Home's fetchData uses (see
    // app/(tabs)/index.tsx + hooks/useLatestRun.ts). useDataRefresh ignores the
    // loader's returned Promise (it can't cancel it), so overlapping invocations —
    // a rapid focus change, or a refreshCount bump that re-runs loadInitialData
    // while a previous run is still awaiting its DB reads — can resolve in EITHER
    // order. Without the latch a slow STALE run's setSections/setPage/setHasMore
    // would clobber a fresher run and, when the stale read came back short/empty,
    // blank the Timeline list (sections.length === 0 -> EmptyState) until remount.
    // One shared counter also makes a fresh initial load supersede any in-flight
    // loadMore (and vice-versa) so pagination can't write a stale page either —
    // only the most recently begun run is allowed to commit state.
    const { begin: beginRun, isLatest: isLatestRun } = useLatestRun();

    // Event Handlers
    const handleDelete = async (entryId: number) => {
        // deleteMoodEntry does the DELETE (FK cascade removes activity/media
        // rows) + unlinks the photo files, returning a DatabaseResult (it never
        // throws). On failure we keep the row on screen and tell the user.
        const result = await deleteMoodEntry(db, entryId);
        if (!result.success) {
            Alert.alert("Couldn't delete entry", result.message);
            return;
        }
        setSections(currentSections =>
            currentSections
                .map(section => ({
                    ...section,
                    data: section.data.filter(entry => entry.id !== entryId),
                }))
                .filter(section => section.data.length > 0)
        );
        refetchEntries();
    };

    const handleUpdate = async (formData: EntryFormData) => {
        if (!currentEntry) return;

        // updateMoodEntry owns the SQL + photo-diff/file-copy logic (see
        // databases/entries.ts). On failure we KEEP the edit modal open with the
        // draft intact and surface the error — the old path silently swallowed
        // it, leaving the user staring at an unchanged entry with no feedback.
        const result = await updateMoodEntry(db, currentEntry.id, {
            mood: formData.mood,
            activities: formData.activities,
            notes: formData.notes,
            date: formData.date,
            photos: formData.photos,
        });
        if (!result.success) {
            Alert.alert("Couldn't save changes", result.message);
            return;
        }
        setEditModalVisible(false);
        refetchEntries();
    };

    // Focus-aware reload (replaces useEffect([db, refreshCount])). Runs whenever
    // the Timeline tab regains focus — so an entry added on another tab shows
    // immediately, no app reopen — and re-runs while focused when refreshCount
    // bumps (a write here). The full-screen spinner shows ONLY on the very first
    // load; a refetch over an already-populated list keeps the stale list
    // visible (no spinner flash) and swaps it for fresh data when the query
    // resolves. `hasLoadedOnce` is a ref so toggling it never itself re-renders.
    const loadInitialData = useCallback(async () => {
        // Claim this run BEFORE the first await so any later invocation (focus /
        // refreshCount bump / a loadMore) supersedes it; a stale run that resolves
        // after a newer one is then dropped instead of clobbering fresher state.
        const runId = beginRun();
        if (!hasLoadedOnce.current) setIsLoading(true);
        try {
            const initialEntries = await getEntriesPage(
                db,
                filtersRef.current,
                0,
                ITEMS_PER_PAGE
            );
            // A newer run started while these reads were in flight — drop this
            // (now stale) result so it can't overwrite the newer one or blank the
            // list out of order.
            if (!isLatestRun(runId)) return;
            setSections(groupEntriesByDate(initialEntries));
            setPage(0);
            setHasMore(initialEntries.length === ITEMS_PER_PAGE);
            setLoadError(false);
        } catch (error) {
            // getEntriesPage now THROWS on a read failure (it used to swallow the
            // error and return [], which blanked the list into EmptyState over a
            // full DB). KEEP whatever sections are already on screen and flag the
            // error so the render can show a retry when there's nothing to show —
            // NEVER fall through to EmptyState on an error.
            console.error('Error loading initial data:', error);
            if (isLatestRun(runId)) setLoadError(true);
        } finally {
            // Only the latest run owns the loading flag / hasLoadedOnce — a stale
            // run must not flip isLoading off under a newer in-flight load.
            if (isLatestRun(runId)) {
                hasLoadedOnce.current = true;
                setIsLoading(false);
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- getEntriesPage reads db + filtersRef.current (not closed deps); the filter deps below make this loader re-run (resetting to page 0) on a filter change via useDataRefresh; setState + latch (beginRun/isLatestRun) identities are stable
    }, [db, debouncedQuery, moodPresetKey]);
    // A filter change flips these extraDeps -> useDataRefresh re-runs loadInitialData
    // through the SAME run-sequence latch, which resets pagination to page 0 and
    // supersedes any in-flight loadMore (shared beginRun) so it can't append stale
    // pages onto the freshly-filtered list.
    useDataRefresh(loadInitialData, [db, debouncedQuery, moodPresetKey]);

    const loadMoreData = async () => {
        if (isLoadingMore || !hasMore) return;

        // Pagination joins the same run sequence: if a fresh initial load (focus /
        // refreshCount bump) begins while this page is loading, this run is no
        // longer latest and must not append onto — or mis-set hasMore for — the
        // list the newer load just reset.
        const runId = beginRun();
        setIsLoadingMore(true);
        try {
            const nextPage = page + 1;
            const newEntries = await getEntriesPage(
                db,
                filtersRef.current,
                nextPage,
                ITEMS_PER_PAGE
            );
            if (!isLatestRun(runId)) return;

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
        } finally {
            // Always clear the loading flag, even when superseded: it's local
            // pagination/guard UI state (NOT list data), so a stale run resetting
            // it can't clobber fresher data — and leaving it stuck `true` would
            // permanently block the `isLoadingMore` guard above. Only the data
            // writes (setSections/setPage/setHasMore) are latch-gated.
            setIsLoadingMore(false);
        }
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
            colors={colors}
        />
    );

    const renderSectionHeader = ({ section: { title } }: { section: Section }) => (
        <View style={styles.sectionHeader}>
            <Text style={styles.sectionHeaderText}>{title}</Text>
        </View>
    );

    // EntryFormModal is rendered UNCONDITIONALLY below — never behind an early
    // return. A focus refetch can flip `isLoading`, and if the edit form lived
    // past an early return it would unmount mid-edit and destroy the user's
    // draft. So the loading/empty/list states are chosen inline while the form
    // stays mounted across all of them. The full-screen spinner shows only on
    // the INITIAL load (isLoading && no sections yet) — a refetch over an
    // existing list keeps the stale list visible until fresh data arrives.
    return (
        <View style={styles.root}>
            {/* Pinned above the list — always rendered (even while loading/empty)
                so the user can filter regardless of the current data state. */}
            <TimelineSearchBar
                query={searchQuery}
                onQueryChange={setSearchQuery}
                moodPresetKey={moodPresetKey}
                onMoodPresetChange={setMoodPresetKey}
                colors={colors}
            />
            {isLoading && sections.length === 0 ? (
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color={colors.accent} />
                </View>
            ) : loadError && sections.length === 0 ? (
                // A read failed and there's nothing on screen — show a recoverable
                // error, NOT the EmptyState. Retry re-runs the loader.
                <View style={styles.errorContainer}>
                    <Text style={styles.errorText}>
                        Couldn't load your entries
                    </Text>
                    <Pressable
                        testID="timeline-retry"
                        onPress={() => loadInitialData()}
                        accessibilityRole="button"
                        accessibilityLabel="Try again"
                        style={styles.retryButton}
                    >
                        <Text style={styles.retryText}>Try again</Text>
                    </Pressable>
                </View>
            ) : sections.length === 0 ? (
                isFiltering ? (
                    <View style={styles.emptyFilterContainer}>
                        <Text style={styles.emptyFilterText}>
                            No entries match your filters
                        </Text>
                        <Pressable
                            testID="timeline-clear-filters"
                            onPress={() => {
                                setSearchQuery('');
                                setMoodPresetKey('all');
                            }}
                            accessibilityRole="button"
                            accessibilityLabel="Clear filters"
                            style={styles.clearFiltersButton}
                        >
                            <Text style={styles.clearFiltersText}>Clear filters</Text>
                        </Pressable>
                    </View>
                ) : (
                    <EmptyState />
                )
            ) : (
                <SectionList
                    sections={sections}
                    renderItem={renderItem}
                    renderSectionHeader={renderSectionHeader}
                    keyExtractor={item => item.id.toString()}
                    onEndReached={loadMoreData}
                    onEndReachedThreshold={0.5}
                    stickySectionHeadersEnabled={true}
                    keyboardDismissMode="on-drag"
                    keyboardShouldPersistTaps="handled"
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
            )}
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
        </View>
    );
}