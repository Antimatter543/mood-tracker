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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemeColors } from '@/styles/global';
import { LAYOUT_CONTENT_PADDING, LAYOUT_FAB_CLEARANCE } from '@/styles/layout';
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
// The DB layer owns ALL SQL now: this component reads OFFSET/LIMIT windows via
// getEntriesWindow and mutates via updateMoodEntry / deleteMoodEntry
// (databases/entries.ts). The component is hooks + rendering only — zero SQL,
// zero transactions. It asks for a WINDOW rather than a page number because the
// window it needs is "the rows I am currently showing", which a page index
// cannot express (see the loader below).
import { getEntriesWindow, updateMoodEntry, deleteMoodEntry, setEntryStarred } from '@/databases/entries';
// Recycle bin (migration 12): `deleteMoodEntry` is now a SOFT delete, so the
// destructive-looking tap is fully reversible, from the snackbar right after it,
// or from the "Recently deleted" panel for the next 30 days.
import { getBinCount, restoreMoodEntry } from '@/databases/entry-bin';
import { UndoSnackbar } from './UndoSnackbar';
import { RecentlyDeletedPanel } from './timeline/RecentlyDeletedPanel';

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

const useThemedStyles = (colors: any, insetBottom: number) => {
    return useMemo(() => StyleSheet.create({
        // Root fills the tab body so the search bar pins at the top and the list
        // (or the loading / empty branch below it) takes the remaining space.
        root: {
            flex: 1,
        },
        container: {
            // The entry list's gutter — same as the search bar pinned above it
            // and the Timeline page title above that (styles/layout.ts).
            paddingHorizontal: LAYOUT_CONTENT_PADDING,
            // Timeline renders inside `<Layout useScrollView={false}>`, so it gets
            // NONE of Layout's ScrollView padding and owes itself the FAB clearance
            // (styles/layout.ts). Without it the last entry card — and the
            // load-more spinner under it — sit permanently beneath the floating
            // "add entry" button with no scroll range left to lift them clear,
            // which reads exactly like "I can't scroll past a certain point".
            paddingBottom: LAYOUT_FAB_CLEARANCE + insetBottom,
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
    }), [colors, insetBottom]);
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

/**
 * Main Component — the Timeline list.
 *
 * NEVER put `maintainVisibleContentPosition` on this SectionList. (It WAS here,
 * since the initial release, and it is what made the whole "new entries don't
 * show up" class of bugs.) The prop anchors the scroll offset to the *view* of
 * the first visible row and, whenever a layout pass moves that row, scrolls by
 * the delta to hold it still. This list is ordered date-DESC, so EVERY insert
 * the user cares about — a just-added entry, an undone delete, an entry restored
 * from the bin — lands at the TOP and pushes that anchor row down. The list then
 * silently scrolled down by exactly the new row's height, parking the new row
 * off-screen above the viewport. Device-QA'd 2026-09-03: a restored entry read
 * as CORRUPTED (only its trailing note line peeked below the sticky date header,
 * no mood / time / activity chips) because its card was three-quarters scrolled
 * off the top, and freshly-added entries "only appeared after a pull-to-refresh"
 * (i.e. after a scroll put the top back in view).
 *
 * The prop exists for chat-style lists that prepend HISTORY while the user reads
 * something below; it is exactly wrong for a list whose newest content is at the
 * top. Pagination doesn't need it either: `loadMoreData` APPENDS, which never
 * moves anything above it. Locked by the "Timeline list scroll anchoring" tests
 * in __tests__/timelineUndoDelete.test.tsx.
 *
 * ── SCROLL DEPTH IS STATE THE USER OWNS (2026-09-13) ────────────────────────────
 * Reported as "scrolling the timeline glitches me all the way up, and I'm not sure
 * I can even scroll down past a certain point", reproduced on device at depth and
 * INDEPENDENT of fling speed. Three separate defects stacked into it, all fixed
 * here and each commented at its own site:
 *
 *   1. Every refresh re-read exactly ONE page and reset the page counter, so any
 *      refresh while the user was deep truncated the loaded rows back to 20. The
 *      content collapsed under the scroll offset and Android clamped the offset
 *      into the much shorter content. `loadEntries` now re-reads the WHOLE loaded
 *      window; only a filter change resets the depth.
 *   2. Pagination's SQL offset came from a page counter that the local list
 *      splices (delete, unstar-under-the-starred-filter) silently desynced, so the
 *      next page SKIPPED as many entries as the list had lost. The offset is now
 *      derived from what is actually on screen.
 *   3. The list was not virtualized in practice (RN's default 21-viewport window
 *      exceeded the whole content) and no cell was memoized, so every parent state
 *      change re-rendered every mounted card — three times per page append. RN's
 *      own "large list that is slow to update" notice fired on device. Cards are
 *      `React.memo`, their callbacks are stable and entry-agnostic, and the window
 *      is bounded.
 *
 * The through-line: a list that owns a scroll position must never silently render
 * FEWER rows than it did a moment ago, and must never rebuild the whole native
 * view tree while the user is dragging it.
 */
export function DatabaseViewer() {
    const colors = useThemeColors();
    const insets = useSafeAreaInsets();
    const styles = useThemedStyles(colors, insets.bottom);
    const db = useSQLiteContext();
    // refetchEntries bumps the global data version after writes here; the
    // focus-aware useDataRefresh below consumes that bump (no direct refreshCount
    // read needed — the hook reads it internally).
    const { refetchEntries } = useDataContext();
    // `broadcastWrite` is THE way this component announces a write — every write
    // path below calls it, none calls `refetchEntries` directly. It is a stable
    // wrapper over a ref so the memoized card handlers don't have to carry
    // `refetchEntries` in a dependency list: whether a context value keeps its
    // identity is the PROVIDER's business, and the list's render cost must not
    // silently depend on it. An un-memoized `refetchEntries` would otherwise change
    // every callback identity on every render, defeat React.memo on 100+ cards and
    // bring the scroll glitch back. Locked by __tests__/timelineListPerf.test.tsx,
    // whose context mock deliberately returns a fresh function each render.
    const refetchEntriesRef = useRef(refetchEntries);
    refetchEntriesRef.current = refetchEntries;
    const broadcastWrite = useCallback(() => refetchEntriesRef.current(), []);

    // State
    const [sections, setSections] = useState<Section[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    // True once the first load has resolved. Gates the full-screen spinner to
    // the initial load only, so on-focus refetches don't flash a spinner over
    // the already-rendered list. A ref (not state) — it's read inside the
    // loader and must not trigger a re-render when it flips.
    const hasLoadedOnce = useRef(false);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    // Mirrors `isLoadingMore` for the GUARD in loadMoreData. The state drives the
    // footer spinner; the ref is what stops a second page from being requested,
    // because a `useState` flag is only visible to the NEXT render and
    // `onEndReached` can fire again before that render commits (VirtualizedList
    // re-checks the edge on every content-size change, and appending the footer
    // spinner is itself a content-size change). Two overlapping runs at the same
    // offset would append the same rows twice — duplicate ids, duplicate
    // SectionList keys, corrupted cell measurement.
    const isLoadingMoreRef = useRef(false);
    const [hasMore, setHasMore] = useState(true);
    const [editModalVisible, setEditModalVisible] = useState(false);
    const [currentEntry, setCurrentEntry] = useState<MoodEntry | null>(null);
    // True when the last initial load FAILED. Drives the inline "couldn't load"
    // + retry UI (only when there are no sections to show) — so a transient read
    // failure never blanks a full DB into the EmptyState. Cleared on any
    // successful load.
    const [loadError, setLoadError] = useState(false);
    // Recycle bin. `binCount` drives the search bar's badge; `pendingUndo` holds
    // the entry id the snackbar can restore (null = no snackbar). `undoNonce`
    // makes two consecutive deletes of the SAME entry-less message distinct, so
    // the snackbar's auto-dismiss timer restarts rather than inheriting the
    // first one's remaining time.
    const [binCount, setBinCount] = useState(0);
    const [binVisible, setBinVisible] = useState(false);
    const [pendingUndo, setPendingUndo] = useState<{ id: number; nonce: number } | null>(null);
    const undoNonce = useRef(0);

    // Search + mood filter. `searchQuery` is the RAW input (drives the field with
    // zero lag); `debouncedQuery` is what actually reaches SQL. `moodPresetKey`
    // is the selected mood band (no debounce — chip taps filter immediately).
    const [searchQuery, setSearchQuery] = useState('');
    const [moodPresetKey, setMoodPresetKey] = useState<MoodPresetKey>('all');
    // Independent "starred only" toggle (composes with search + mood presets).
    // Filters instantly (no debounce), like the mood chips.
    const [starredOnly, setStarredOnly] = useState(false);
    const [debouncedQuery, setDebouncedQuery] = useState('');
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedQuery(searchQuery), SEARCH_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    // The SQL-facing filter state. Recomputed only when the debounced query or
    // the mood preset changes.
    const filters = useMemo<EntryFilters>(
        () => ({ query: debouncedQuery, moodRange: moodPresetToRange(moodPresetKey), starredOnly }),
        [debouncedQuery, moodPresetKey, starredOnly]
    );
    // The non-memoized loaders (loadMoreData, and fetchEntriesPage which they
    // share) close over stale state; a ref updated every render lets them read
    // the CURRENT filter without threading it through — and, crucially, without
    // touching the useLatestRun / useDataRefresh latch wiring.
    const filtersRef = useRef(filters);
    filtersRef.current = filters;

    // HOW DEEP the list currently is, derived from `sections` rather than kept as
    // its own `page` counter. It is both the SQL OFFSET for the next page and the
    // window size a refresh must re-read, and the two MUST agree — a separate
    // counter drifts the moment the list changes by any path that isn't a page
    // load (a delete splices a row out; unstarring under the starred filter drops
    // one), and a drifted offset makes the next page SKIP exactly as many entries
    // as the list lost. Deriving it makes that class of desync unrepresentable.
    const loadedCount = useMemo(
        () => sections.reduce((total, section) => total + section.data.length, 0),
        [sections]
    );
    const loadedCountRef = useRef(loadedCount);
    loadedCountRef.current = loadedCount;

    // Any active filter switches the empty branch from "add your first entry" to
    // the filter-specific "nothing matched" message (with a reset).
    const isFiltering = debouncedQuery.trim() !== '' || moodPresetKey !== 'all' || starredOnly;
    // The starred filter is the ONLY active constraint — drives the dedicated
    // "no starred entries yet" empty copy (vs the generic "nothing matched").
    const starredOnlyActive = starredOnly && debouncedQuery.trim() === '' && moodPresetKey === 'all';

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
    //
    // The three handlers the entry cards receive (`handleEdit`, `handleDelete`,
    // `handleToggleStar`) are MEMOIZED and take the entry as an argument instead
    // of being bound to it per row. That is what makes `React.memo(EntryCard)`
    // effective — see the note on EntryCard. Anything that would put changing
    // state in their closures (the revert snapshot below) reads a ref instead.
    const sectionsRef = useRef(sections);
    sectionsRef.current = sections;

    const handleEdit = useCallback((entry: MoodEntry) => {
        setCurrentEntry(entry);
        setEditModalVisible(true);
    }, []);

    const handleDelete = useCallback(async (entryId: number) => {
        // deleteMoodEntry is a SOFT delete since migration 12: it only stamps
        // `deleted_at`, so the entry's activities, media rows and photo FILES all
        // survive and the undo below is lossless. It returns a DatabaseResult
        // (never throws); on failure we keep the row on screen and tell the user.
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
        setPendingUndo({ id: entryId, nonce: ++undoNonce.current });
        broadcastWrite();
    }, [db, broadcastWrite]);

    // Undo: put the entry straight back. A full reload (not a local splice) is
    // what restores it to its correct DATE position in the sections, the entry
    // may well not belong at the end of the list it was removed from.
    const handleUndoDelete = async (entryId: number) => {
        const result = await restoreMoodEntry(db, entryId);
        if (!result.success) {
            Alert.alert("Couldn't restore entry", result.message);
            return;
        }
        await loadEntriesRef.current();
        broadcastWrite();
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
        broadcastWrite();
    };

    const handleToggleStar = useCallback(async (entry: MoodEntry) => {
        const nextStarred = entry.starred_at == null;
        const nextStarredAt = nextStarred ? new Date().toISOString() : null;

        // Snapshot for revert-on-failure — read from the ref so this handler's
        // identity doesn't change with every list update (see the note above).
        const prevSections = sectionsRef.current;

        // Optimistic update: reflect the new star state immediately. If the
        // starred filter is active AND we just UNstarred, the entry no longer
        // matches, so drop it from the visible list; otherwise update it in
        // place. Then prune any section left empty.
        setSections(currentSections =>
            currentSections
                .map(section => ({
                    ...section,
                    data:
                        starredOnly && !nextStarred
                            ? section.data.filter(e => e.id !== entry.id)
                            : section.data.map(e =>
                                  e.id === entry.id ? { ...e, starred_at: nextStarredAt } : e
                              ),
                }))
                .filter(section => section.data.length > 0)
        );

        const result = await setEntryStarred(db, entry.id, nextStarred);
        if (!result.success) {
            // Roll the optimistic change back and tell the user.
            setSections(prevSections);
            Alert.alert("Couldn't update star", result.message);
            return;
        }
        broadcastWrite();
    }, [db, broadcastWrite, starredOnly]);

    // A refresh has to know whether the filter CHANGED, because that is the only
    // thing that legitimately throws away the user's scroll depth. The signature
    // is captured in the loader's closure (it is rebuilt on every filter change);
    // the ref holds what the PREVIOUS run saw. Differ => the filter just changed
    // => collapse back to one page. Equal => this is a focus gain or a data-version
    // bump => keep the depth. See the loader below.
    const filterSignature = `${debouncedQuery} ${moodPresetKey} ${starredOnly}`;
    const lastLoadedFilterRef = useRef(filterSignature);

    // Focus-aware reload (replaces useEffect([db, refreshCount])). Runs whenever
    // the Timeline tab regains focus — so an entry added on another tab shows
    // immediately, no app reopen — and re-runs while focused when the data version
    // bumps (any write, here or on another screen). The full-screen spinner shows
    // ONLY on the very first load; a refetch over an already-populated list keeps
    // the stale list visible (no spinner flash) and swaps it for fresh data when
    // the query resolves. `hasLoadedOnce` is a ref so toggling it never itself
    // re-renders.
    //
    // IT RE-READS THE WHOLE LOADED WINDOW, NOT PAGE 0. This is the fix for the
    // reported "scrolling the Timeline glitches me back to the top and then I
    // can't get past a certain point". Every refresh used to read exactly
    // ITEMS_PER_PAGE rows and reset the page counter, so ANY refresh while the
    // user was paginated deep — deleting an entry, starring one, editing one,
    // restoring from the bin, or just leaving the tab and coming back — silently
    // truncated 100+ rendered rows down to 20. The content height collapsed under
    // the scroll offset, the native ScrollView clamped the offset into the much
    // shorter content (the "glitch to the top"), and the rows the user had already
    // paged in were gone until `onEndReached` fetched them all over again (the
    // "wall"). Refreshing IN PLACE at the current depth keeps both the data and
    // the scroll position, and makes the refresh idempotent — which is what the
    // useDataRefresh contract already promised (hooks/useDataRefresh.ts) and this
    // loader was quietly violating.
    //
    // ONE DELIBERATE BEHAVIOUR CHANGE falls out of that, device-confirmed
    // 2026-09-13: leaving the Timeline and coming back now KEEPS the user where
    // they were. It used to land them at the top, but only as a side effect of the
    // truncation — the navigator keeps this screen mounted, so the native scroll
    // offset always survived a tab switch; it was the data collapsing underneath it
    // that threw the user to the top. Losing your place in a long history because
    // you glanced at another tab is not a feature. If a future change ever wants
    // "return to top on focus", that has to be an explicit scrollToLocation, not a
    // truncated read.
    const loadEntries = useCallback(async () => {
        // Claim this run BEFORE the first await so any later invocation (focus /
        // data-version bump / a loadMore) supersedes it; a stale run that resolves
        // after a newer one is then dropped instead of clobbering fresher state.
        const runId = beginRun();
        const filterChanged = lastLoadedFilterRef.current !== filterSignature;
        lastLoadedFilterRef.current = filterSignature;
        // A filter change is the ONE reset: the rows on screen no longer match, so
        // starting over at one page is correct (and the user is at the top anyway,
        // having just tapped a chip or typed). Otherwise re-read exactly as many
        // rows as are on screen — never fewer, or the list shrinks under the user.
        if (filterChanged) {
            // Void the bookkeeping too, not just this run's window. A filter change
            // fires BOTH useDataRefresh vectors in the same commit (the focus
            // effect's callback identity changed AND its dep list changed), so a
            // second run follows this one with no render in between — and it would
            // read the OLD depth off the ref and quietly restore it, defeating the
            // reset. The ref is re-derived from `sections` on the next render.
            loadedCountRef.current = 0;
        }
        const windowSize = Math.max(ITEMS_PER_PAGE, loadedCountRef.current);
        if (!hasLoadedOnce.current) setIsLoading(true);
        try {
            const entries = await getEntriesWindow(
                db,
                filtersRef.current,
                0,
                windowSize
            );
            // A newer run started while these reads were in flight — drop this
            // (now stale) result so it can't overwrite the newer one or blank the
            // list out of order.
            if (!isLatestRun(runId)) return;
            setSections(groupEntriesByDate(entries));
            // A SHORT window is proof there is nothing past it: the query starts at
            // offset 0, so fewer rows than asked for means the whole filtered set
            // fits in what we just read. (A full window says nothing either way, so
            // assume there is more and let the next onEndReached settle it.)
            setHasMore(entries.length === windowSize);
            setLoadError(false);
        } catch (error) {
            // getEntriesWindow THROWS on a read failure (it used to swallow the
            // error and return [], which blanked the list into EmptyState over a
            // full DB). KEEP whatever sections are already on screen and flag the
            // error so the render can show a retry when there's nothing to show —
            // NEVER fall through to EmptyState on an error.
            console.error('Error loading timeline entries:', error);
            if (isLatestRun(runId)) setLoadError(true);
        } finally {
            // Only the latest run owns the loading flag / hasLoadedOnce — a stale
            // run must not flip isLoading off under a newer in-flight load.
            if (isLatestRun(runId)) {
                hasLoadedOnce.current = true;
                setIsLoading(false);
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- getEntriesWindow reads db + filtersRef.current/loadedCountRef.current (not closed deps); the filter deps below make this loader re-run (collapsing to one page) on a filter change via useDataRefresh; setState + latch (beginRun/isLatestRun) identities are stable
    }, [db, debouncedQuery, moodPresetKey, starredOnly]);
    // A filter change flips these extraDeps -> useDataRefresh re-runs loadEntries
    // through the SAME run-sequence latch, which collapses the window back to one
    // page and supersedes any in-flight loadMore (shared beginRun) so it can't
    // append stale pages onto the freshly-filtered list.
    useDataRefresh(loadEntries, [db, debouncedQuery, moodPresetKey, starredOnly]);
    // Undo (declared ABOVE loadEntries) needs to re-run the loader; a ref
    // updated every render lets it call the CURRENT one without hoisting the
    // whole loader above the handlers or touching the useLatestRun wiring —
    // the same trick `filtersRef` uses.
    const loadEntriesRef = useRef(loadEntries);
    loadEntriesRef.current = loadEntries;

    // Bin badge count. Rides the SAME focus/data-version signal as the list, so
    // it re-counts after any delete, undo, restore or purge without its own
    // plumbing. `getBinCount` never throws (a badge must not break the Timeline).
    const loadBinCount = useCallback(async () => {
        setBinCount(await getBinCount(db));
    }, [db]);
    useDataRefresh(loadBinCount, [db]);

    const loadMoreData = async () => {
        // Guard on the REF, not the state (see isLoadingMoreRef): a fast fling can
        // re-enter this before React has committed `setIsLoadingMore(true)`, and two
        // runs reading the same offset would append the same rows twice.
        if (isLoadingMoreRef.current || !hasMore) return;

        // Pagination joins the same run sequence: if a fresh load (focus /
        // data-version bump) begins while this page is loading, this run is no
        // longer latest and must not append onto — or mis-set hasMore for — the
        // list the newer load just refreshed.
        const runId = beginRun();
        isLoadingMoreRef.current = true;
        setIsLoadingMore(true);
        try {
            // OFFSET = how many rows are on screen right now, not a page counter.
            // The query excludes anything the list dropped locally (a soft-deleted
            // entry, an entry unstarred under the starred filter), so "rows loaded"
            // and "rows to skip" are the same number BY CONSTRUCTION — a separate
            // page counter drifts past those splices and silently skips entries.
            const offset = loadedCountRef.current;
            const newEntries = await getEntriesWindow(
                db,
                filtersRef.current,
                offset,
                ITEMS_PER_PAGE
            );
            if (!isLatestRun(runId)) return;

            if (newEntries.length > 0) {
                setSections(prevSections => {
                    const loaded = prevSections.flatMap(s => s.data);
                    // De-dupe by id. An entry added between the last read and this
                    // one shifts the whole window down by a row, so this offset can
                    // hand back a row already on screen; a duplicate id becomes a
                    // duplicate SectionList key, which corrupts cell measurement
                    // (and makes React drop a row). Cheap, and it makes the append
                    // safe against ANY concurrent insert rather than just the ones
                    // we thought of.
                    const seen = new Set(loaded.map(e => e.id));
                    const fresh = newEntries.filter(e => !seen.has(e.id));
                    return fresh.length > 0
                        ? groupEntriesByDate([...loaded, ...fresh])
                        : prevSections;
                });
                setHasMore(newEntries.length === ITEMS_PER_PAGE);
            } else {
                setHasMore(false);
            }
        } catch (error) {
            console.error('Error loading more data:', error);
        } finally {
            // Always clear the loading flag, even when superseded: it's local
            // pagination/guard UI state (NOT list data), so a stale run resetting
            // it can't clobber fresher data — and leaving it stuck would
            // permanently block the guard above. Only the data writes
            // (setSections/setHasMore) are latch-gated.
            isLoadingMoreRef.current = false;
            setIsLoadingMore(false);
        }
    };

    // Render Methods — memoized along with the handlers they pass down, so a
    // parent state change (a spinner toggling, a page appending) re-renders the
    // NEW cells only instead of every mounted card. See EntryCard's memo note.
    const renderItem = useCallback(
        ({ item: entry }: { item: MoodEntry }) => (
            <EntryCard
                entry={entry}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onToggleStar={handleToggleStar}
                colors={colors}
            />
        ),
        [handleEdit, handleDelete, handleToggleStar, colors]
    );

    const renderSectionHeader = useCallback(
        ({ section: { title } }: { section: Section }) => (
            <View style={styles.sectionHeader}>
                <Text style={styles.sectionHeaderText}>{title}</Text>
            </View>
        ),
        [styles]
    );

    const keyExtractor = useCallback((item: MoodEntry) => item.id.toString(), []);

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
                starredOnly={starredOnly}
                onStarredChange={setStarredOnly}
                binCount={binCount}
                onOpenBin={() => setBinVisible(true)}
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
                        onPress={() => loadEntries()}
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
                            {starredOnlyActive
                                ? 'No starred entries yet — tap the star on any entry to keep it here.'
                                : 'No entries match your filters'}
                        </Text>
                        <Pressable
                            testID="timeline-clear-filters"
                            onPress={() => {
                                setSearchQuery('');
                                setMoodPresetKey('all');
                                setStarredOnly(false);
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
                // NO `maintainVisibleContentPosition` on this list — see the note
                // above the component for why adding it back hides every prepend.
                <SectionList
                    testID="timeline-list"
                    sections={sections}
                    renderItem={renderItem}
                    renderSectionHeader={renderSectionHeader}
                    keyExtractor={keyExtractor}
                    onEndReached={loadMoreData}
                    onEndReachedThreshold={0.5}
                    stickySectionHeadersEnabled={true}
                    // ACTUALLY VIRTUALIZE. RN's default `windowSize` is 21
                    // VIEWPORTS, which for a list of a few hundred entry cards is
                    // taller than the whole list — so nothing was ever unmounted
                    // and every mounted card took part in every render pass. 5
                    // viewports keeps two screens of cards live above and below the
                    // visible one (plenty for a fling to land on rendered content)
                    // while capping how much native view tree a single update has
                    // to touch. Keep it well above 2: these cells have no
                    // `getItemLayout` (heights vary with notes and photos), so the
                    // tail spacer is clamped to the highest MEASURED cell and too
                    // small a window makes the list grow in visible stutters.
                    windowSize={5}
                    initialNumToRender={ITEMS_PER_PAGE / 2}
                    maxToRenderPerBatch={ITEMS_PER_PAGE / 2}
                    keyboardDismissMode="on-drag"
                    keyboardShouldPersistTaps="handled"
                    ListFooterComponent={isLoadingMore ? (
                        <View style={styles.loadingFooter}>
                            <ActivityIndicator size="small" color={colors.accent} />
                        </View>
                    ) : null}
                    contentContainerStyle={styles.container}
                />
            )}
            {/* Undo affordance for the soft delete. In-tree (mounted through the
                OverlayHost), never a react-native <Modal>. Keyed by the undo nonce
                so a second delete restarts the countdown instead of inheriting
                the first snackbar's remaining time. */}
            <UndoSnackbar
                key={pendingUndo?.nonce ?? 'idle'}
                visible={pendingUndo !== null}
                message="Entry moved to the bin"
                actionLabel="Undo"
                onAction={() => {
                    if (pendingUndo) handleUndoDelete(pendingUndo.id);
                }}
                onDismiss={() => setPendingUndo(null)}
            />
            {/* "Recently deleted". Reloading the list on close covers the case
                where the user restored something from inside the panel. */}
            <RecentlyDeletedPanel
                visible={binVisible}
                onClose={() => setBinVisible(false)}
                onChanged={() => {
                    loadEntriesRef.current();
                    broadcastWrite();
                }}
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
        </View>
    );
}