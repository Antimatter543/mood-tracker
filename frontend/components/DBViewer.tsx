import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    View,
    Text,
    Pressable,
    StyleSheet,
    ActivityIndicator,
    Alert,
    LayoutChangeEvent,
    NativeScrollEvent,
    NativeSyntheticEvent,
} from 'react-native';
import { FlashList, type FlashListRef, type ListRenderItemInfo } from '@shopify/flash-list';
import { useSQLiteContext } from 'expo-sqlite';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemeColors, useThemeColors } from '@/styles/global';
import { LAYOUT_FAB_CLEARANCE } from '@/styles/layout';
import { useDataContext } from '@/context/DataContext';
import { useDataRefresh } from '@/hooks/useDataRefresh';
import { useLatestRun } from '@/hooks/useLatestRun';
import { MoodEntry } from './types';

import { EntryFormData, EntryFormModal } from './forms/EntryForm';
import { EmptyState } from './EmptyState';
import { EntryCard } from './timeline/EntryCard';
import { DayHeader } from './timeline/DayHeader';
import { TimelineFooter, footerStateFor } from './timeline/TimelineFooter';
import { BackToTopPill, shouldShowBackToTop } from './timeline/BackToTopPill';
import { TimelineSearchBar } from './timeline/TimelineSearchBar';
import {
    moodPresetToRange,
    EntryFilters,
    MoodPresetKey,
} from './timeline/entryFilter';
import {
    TIMELINE_PAGE_SIZE,
    TimelineRow,
    appendUnique,
    buildTimelineRows,
    reuseUnchanged,
    rowTypeOf,
    shouldRevealInsertion,
    stickyHeaderIndicesFor,
} from './timeline/timelineRows';
import { useDateFormat } from '@/hooks/useDateFormat';
// The DB layer owns ALL SQL: this component reads OFFSET/LIMIT windows via
// getEntriesWindow and mutates via updateMoodEntry / deleteMoodEntry
// (databases/entries.ts). The component is hooks + rendering only — zero SQL,
// zero transactions. It asks for a WINDOW rather than a page number because the
// window it needs is "the rows I am currently showing", which a page index
// cannot express (see the loader below).
import { getEntriesWindow, updateMoodEntry, deleteMoodEntry, setEntryStarred } from '@/databases/entries';
// Recycle bin (migration 12): `deleteMoodEntry` is a SOFT delete, so the delete
// is fully reversible, from the snackbar right after it, or from the "Recently
// deleted" panel for the next 30 days.
import { getBinCount, restoreMoodEntry } from '@/databases/entry-bin';
import { UndoSnackbar } from './UndoSnackbar';
import { RecentlyDeletedPanel } from './timeline/RecentlyDeletedPanel';

// Debounce the search text before it hits SQL so each keystroke doesn't fire a
// paged query; the mood chips filter instantly (no debounce needed).
const SEARCH_DEBOUNCE_MS = 250;

/**
 * Prefetch the next page while the user is still this many SCREENS from the end
 * (FlashList measures `onEndReachedThreshold` in viewport lengths). Two screens
 * of runway plus 50-row pages means a hard fling is still over loaded rows when
 * the next page lands, instead of slamming into the end of the content and
 * appending mid-gesture.
 */
const END_REACHED_SCREENS = 2;

/**
 * How far past the viewport FlashList keeps cells drawn, in px. Above the 250px
 * default so a fling lands on rendered cells more often; FlashList recycles
 * cells, so the extra reach costs re-binds, not new mounts.
 */
const DRAW_DISTANCE = 600;

const useThemedStyles = (colors: ThemeColors, insetBottom: number) => {
    return useMemo(() => StyleSheet.create({
        // Root fills the tab body so the search bar pins at the top and the list
        // (or the loading / empty branch below it) takes the remaining space.
        root: {
            flex: 1,
        },
        // The FlashList's OWN parent, so the list sits at y=0 inside it.
        // FlashList 2.0.2 computes its first-item offset as (first child's y
        // relative to the list) minus (the list's y as `measureLayout(view,
        // view)` reports it), and on Fabric the latter is the list's origin in
        // its PARENT. Sharing `root` with the search bar made that ~107dp, which
        // skewed every visible-index computation (the offset-correction anchor,
        // sticky headers, `getFirstVisibleIndex`). Upstream #2105, fixed in
        // flash-list 2.2.3. Nothing else may be rendered in this frame.
        listFrame: {
            flex: 1,
        },
        listContent: {
            paddingTop: 4,
            // Timeline renders inside `<Layout useScrollView={false}>`, so it gets
            // NONE of Layout's ScrollView padding and owes itself the FAB clearance
            // (styles/layout.ts). Without it the last entry sits permanently under
            // the floating "add entry" button. Horizontal padding is owned by each
            // ROW, not by the content container: FlashList draws the pinned sticky
            // header outside the content container (left:0/right:0 of the list), so
            // a container gutter would misalign the sticky copy from its in-list
            // original.
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
    }), [colors, insetBottom]);
};

/**
 * Main Component — the Timeline list.
 *
 * ── WHY A FLASHLIST (2026-09-28) ─────────────────────────────────────────────
 * Reported as "when I scroll down hard/fast enough it's still glitchy, and if I
 * do it fast enough it'll teleport me back up to the most recent date or a more
 * recent date". This was the FLING-dependent half of the 2026-09-13 bug (that fix
 * removed the depth-dependent half — see below). Root cause, read out of RN
 * 0.85's VirtualizedList: a hard fling moves the render window past cells that
 * never mount, so they are never measured; VirtualizedList then estimates EACH
 * unmeasured cell's offset as `averageCellLength * index`
 * (ListMetricsAggregator.getCellMetricsApprox), ignoring the real measured
 * offsets of the cells before it. The leading spacer and every window-boundary
 * cell are placed from those estimates, so whenever the window later shifts
 * across the unmeasured stretch — and a sticky section header is rendered at its
 * own index on every window update, so it shifts constantly — the content above
 * the viewport jumps by the accumulated estimation error, which GROWS WITH
 * DEPTH. With `maintainVisibleContentPosition` deliberately off (it hid new
 * entries, see below) nothing compensated, so the rows under the user's finger
 * were replaced by rows hundreds or thousands of px higher up: "a more recent
 * date". Detail: tasks/lessons.md 2026-09-28.
 *
 * FlashList v2 removes the mechanism rather than tuning around it: its layout
 * manager keeps a CONTIGUOUS layout table (every row's y is the previous row's
 * y + height, estimated or measured, never `average * index`), it measures cells
 * synchronously before paint on the new architecture, and it corrects the
 * scroll offset for any size change above the first visible row
 * (`maintainVisibleContentPosition`, on by default in v2, anchored to that row's
 * KEY). Photo boxes are fixed-size so an image load never changes a row height,
 * and the footer is a constant height so a page append never shrinks content.
 *
 * ── NEW ENTRIES AT THE TOP MUST STAY VISIBLE ───────────────────────────────────
 * The old SectionList once carried `maintainVisibleContentPosition` and it hid
 * every prepend (a just-added entry, an undone delete, a bin restore) by
 * scrolling the new row off the top (device-QA'd 2026-09-03). FlashList's version
 * would do the same whenever the insertion lands ABOVE the first visible row. So
 * the refresh path decides, with the pure `shouldRevealInsertion`, whether it
 * inserted rows above the user while they were near the top, and if so takes the
 * list to the top AS PART OF the commit that inserts them (`jumpToTop`, below).
 * Locked by __tests__/timelineUndoDelete.test.tsx + timelineRows.test.ts +
 * timelineRealFlashList.test.tsx.
 *
 * ── THE REVEAL MUST NOT RACE FLASHLIST'S OWN CORRECTION (2026-09-28) ──────────
 * Device QA of the first FlashList build: an entry added via the FAB, or put
 * back by Undo, near the top was counted in its day header but never drawn. It
 * was drawn, one row-height ABOVE the viewport, under the pinned day header
 * (uiautomator's "[221,579][358,578]" is a node clipped to nothing, not a
 * collapsed one). Two faults, both read out of the sources:
 *   1. FlashList 2.0.2 measures its own offset inside its parent with
 *      `measureLayout(view, view)`, which on Fabric returns the view's origin in
 *      its PARENT, and subtracts it (upstream #2105, fixed in 2.2.3; Expo 56 pins
 *      2.0.2). The search bar sat above the list in the same parent, so every
 *      offset FlashList computed was ~107dp too deep: at the very top it
 *      anchored content-position maintenance to the first ENTRY instead of the
 *      day header, so ANY entry inserted above it was "above the anchor". (It
 *      also pinned each day header ~107dp early.) The list now sits alone in
 *      `listFrame`, at the origin of its parent, which is exactly the geometry
 *      2.0.2's arithmetic assumes.
 *   2. The reveal was `scrollToOffset(0)` a frame after the rows committed. That
 *      is a native VIEW COMMAND, and Fabric on Android executes every queued
 *      view command BEFORE the mount items of the same batch
 *      (MountItemDispatcher.dispatchMountItems); FlashList's correction reaches
 *      native as a MOUNT (it moves its ScrollAnchor view, and the native
 *      maintainVisibleContentPosition helper follows it in didMountItems). So the
 *      reveal ran first, as a no-op at offset 0, and the correction then pushed
 *      the new row off the top. Timing decided which one won, which is why a bin
 *      restore (the list behind an overlay) happened to work. The fix is
 *      ordering, not timing: `scrollToIndex` PAUSES FlashList's correction while
 *      it runs, so issuing it before `setEntries` means the inserting commit is
 *      never corrected at all and the scroll is the only thing that moves the
 *      list.
 *
 * We deliberately do NOT use v2's `autoscrollToTopThreshold`: Android's native
 * helper (MaintainVisibleScrollPositionHelper) fires it on EVERY anchor
 * correction while the offset is under the threshold — including a plain
 * re-measure of a row above the viewport — which would be a new "teleport to
 * the top" for any user near it. Deciding in JS, on an actual insertion, is the
 * precise version.
 *
 * ── SCROLL DEPTH IS STATE THE USER OWNS (2026-09-13) ──────────────────────────
 * Still true, still enforced here:
 *   1. A refresh re-reads the WHOLE loaded window (never one page), so any write
 *      or focus gain while the user is deep keeps both the rows and the scroll
 *      position. Only a filter change resets the depth.
 *   2. The next page's SQL OFFSET is `entries.length` — derived from the rows on
 *      screen, never a page counter the local splices (delete, unstar under the
 *      starred filter) could desync.
 *   3. Cards are `React.memo`, their callbacks are stable and entry-agnostic,
 *      and a refresh carries unchanged entries over BY REFERENCE
 *      (`reuseUnchanged`), so a parent render re-renders only changed rows.
 * The through-line: a list that owns a scroll position must never silently render
 * FEWER rows than it did a moment ago, must never move content above the user
 * without compensating, and must never rebuild its cells while the user drags it.
 */
export function DatabaseViewer() {
    const colors = useThemeColors();
    const insets = useSafeAreaInsets();
    const styles = useThemedStyles(colors, insets.bottom);
    const db = useSQLiteContext();
    // `broadcastWrite` is THE way this component announces a write — every write
    // path below calls it, none calls `refetchEntries` directly. It is a stable
    // wrapper over a ref so the memoized card handlers don't have to carry
    // `refetchEntries` in a dependency list: whether a context value keeps its
    // identity is the PROVIDER's business, and the list's render cost must not
    // silently depend on it. Locked by __tests__/timelineListPerf.test.tsx, whose
    // context mock deliberately returns a fresh function each render.
    const { refetchEntries } = useDataContext();
    const refetchEntriesRef = useRef(refetchEntries);
    refetchEntriesRef.current = refetchEntries;
    const broadcastWrite = useCallback(() => refetchEntriesRef.current(), []);

    // The user's date-format preference, used to render the day headers.
    const { pref: dateFormatPref } = useDateFormat();

    // ── State ──────────────────────────────────────────────────────────────────
    // `entries` is the ONE source of truth: the loaded window, newest first, in
    // the query's total order. Header rows, day summaries, sticky indices and the
    // next page's offset are all DERIVED from it.
    const [entries, setEntries] = useState<readonly MoodEntry[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    // True once the first load has resolved. Gates the full-screen spinner to
    // the initial load only, so on-focus refetches don't flash a spinner over
    // the already-rendered list. A ref — it must not trigger a re-render.
    const hasLoadedOnce = useRef(false);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    // Mirrors `isLoadingMore` for the GUARD in loadMoreData. The state drives the
    // footer spinner; the ref is what stops a second page from being requested,
    // because a `useState` flag is only visible to the NEXT render and
    // `onEndReached` can fire again before that render commits. Two overlapping
    // runs at the same offset would append the same rows twice.
    const isLoadingMoreRef = useRef(false);
    const [hasMore, setHasMore] = useState(true);
    const [editModalVisible, setEditModalVisible] = useState(false);
    const [currentEntry, setCurrentEntry] = useState<MoodEntry | null>(null);
    // True when the last initial load FAILED. Drives the inline "couldn't load"
    // + retry UI (only when there is nothing to show) — so a transient read
    // failure never blanks a full DB into the EmptyState.
    const [loadError, setLoadError] = useState(false);
    // Recycle bin. `binCount` drives the search bar's badge; `pendingUndo` holds
    // the entry id the snackbar can restore (null = no snackbar). `undoNonce`
    // restarts the snackbar's auto-dismiss on a second delete.
    const [binCount, setBinCount] = useState(0);
    const [binVisible, setBinVisible] = useState(false);
    const [pendingUndo, setPendingUndo] = useState<{ id: number; nonce: number } | null>(null);
    const undoNonce = useRef(0);

    // ── Scroll bookkeeping (refs: read on demand, never re-render per frame) ──
    const listRef = useRef<FlashListRef<TimelineRow>>(null);
    const scrollOffsetRef = useRef(0);
    const viewportHeightRef = useRef(0);
    const [showBackToTop, setShowBackToTop] = useState(false);

    // Search + mood filter. `searchQuery` is the RAW input (drives the field with
    // zero lag); `debouncedQuery` is what actually reaches SQL. `moodPresetKey`
    // is the selected mood band (no debounce — chip taps filter immediately).
    const [searchQuery, setSearchQuery] = useState('');
    const [moodPresetKey, setMoodPresetKey] = useState<MoodPresetKey>('all');
    // Independent "starred only" toggle (composes with search + mood presets).
    const [starredOnly, setStarredOnly] = useState(false);
    const [debouncedQuery, setDebouncedQuery] = useState('');
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedQuery(searchQuery), SEARCH_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    // The SQL-facing filter state.
    const filters = useMemo<EntryFilters>(
        () => ({ query: debouncedQuery, moodRange: moodPresetToRange(moodPresetKey), starredOnly }),
        [debouncedQuery, moodPresetKey, starredOnly]
    );
    // The loaders read the CURRENT filter through a ref, without threading it
    // through and without touching the useLatestRun / useDataRefresh wiring.
    const filtersRef = useRef(filters);
    filtersRef.current = filters;

    // HOW DEEP the list is: both the SQL OFFSET for the next page and the window
    // a refresh must re-read. Derived — see note 2 above the component.
    const entriesRef = useRef(entries);
    entriesRef.current = entries;
    const loadedCountRef = useRef(entries.length);
    loadedCountRef.current = entries.length;

    // Rows for the list. `hasMore` feeds the summary of the LAST day, which may
    // continue on the page that hasn't loaded yet.
    const rows = useMemo(() => buildTimelineRows(entries, hasMore), [entries, hasMore]);
    const rowsRef = useRef(rows);
    rowsRef.current = rows;
    const stickyHeaderIndices = useMemo(() => stickyHeaderIndicesFor(rows), [rows]);

    /**
     * Take the list to its very top as PART OF the data commit the caller is
     * about to make. Call it in the committing run, BEFORE the rows reach the
     * list: keep it above that run's `setEntries`, never in an effect or a frame
     * after the commit (see "THE REVEAL MUST NOT RACE" above the component).
     * `scrollToIndex` pauses FlashList's content-position correction from this
     * call until its scroll has landed, so the commit that inserts rows above
     * the anchor is never corrected and nothing native can reorder against this
     * scroll. A `scrollToOffset` issued after the commit loses to that
     * correction on Android. `viewOffset` cancels FlashList's first-item offset
     * (the content padding) so this lands at 0, the real top.
     * Offset and pill state follow from the scroll events this produces
     * (handleScroll is their one writer).
     */
    const jumpToTop = useCallback((animated: boolean) => {
        const list = listRef.current;
        if (!list) return;
        void list.scrollToIndex({ index: 0, animated, viewOffset: -list.getFirstItemOffset() });
    }, []);

    // Any active filter switches the empty branch from "add your first entry" to
    // the filter-specific "nothing matched" message (with a reset).
    const isFiltering = debouncedQuery.trim() !== '' || moodPresetKey !== 'all' || starredOnly;
    // The starred filter is the ONLY active constraint — drives the dedicated
    // "no starred entries yet" empty copy (vs the generic "nothing matched").
    const starredOnlyActive = starredOnly && debouncedQuery.trim() === '' && moodPresetKey === 'all';

    // Run-sequence latch — the SAME guard Home's fetchData uses (see
    // app/(tabs)/index.tsx + hooks/useLatestRun.ts). useDataRefresh ignores the
    // loader's returned Promise, so overlapping invocations can resolve in EITHER
    // order; only the most recently begun run (refresh OR page) may commit state.
    const { begin: beginRun, isLatest: isLatestRun } = useLatestRun();

    // ── Card handlers ─────────────────────────────────────────────────────────
    // MEMOIZED and entry-agnostic (they take the entry as an argument), which is
    // what makes `React.memo(EntryCard)` effective. Anything that would put
    // changing state in their closures reads a ref instead.
    const handleEdit = useCallback((entry: MoodEntry) => {
        setCurrentEntry(entry);
        setEditModalVisible(true);
    }, []);

    const handleDelete = useCallback(async (entryId: number) => {
        // deleteMoodEntry is a SOFT delete: it only stamps `deleted_at`, so the
        // entry's activities, media rows and photo FILES all survive and the undo
        // below is lossless. It returns a DatabaseResult (never throws); on
        // failure we keep the row on screen and tell the user.
        const result = await deleteMoodEntry(db, entryId);
        if (!result.success) {
            Alert.alert("Couldn't delete entry", result.message);
            return;
        }
        setEntries(current => current.filter(entry => entry.id !== entryId));
        setPendingUndo({ id: entryId, nonce: ++undoNonce.current });
        broadcastWrite();
    }, [db, broadcastWrite]);

    const starredOnlyRef = useRef(starredOnly);
    starredOnlyRef.current = starredOnly;

    const handleToggleStar = useCallback(async (entry: MoodEntry) => {
        const nextStarred = entry.starred_at == null;
        const nextStarredAt = nextStarred ? new Date().toISOString() : null;
        const leavesList = starredOnlyRef.current && !nextStarred;

        // Optimistic update. Under the starred filter an UNstar means the entry
        // no longer matches, so it leaves the list; otherwise it's updated in
        // place (a NEW object, so its memoized card re-renders).
        setEntries(current =>
            leavesList
                ? current.filter(e => e.id !== entry.id)
                : current.map(e => (e.id === entry.id ? { ...e, starred_at: nextStarredAt } : e))
        );

        const result = await setEntryStarred(db, entry.id, nextStarred);
        if (!result.success) {
            // Revert ONLY this entry. Restoring a whole snapshot taken before the
            // await would also throw away a page that was appended meanwhile —
            // shrinking the window under the user. An entry that left the list
            // comes back through a window refresh, which re-reads at full depth.
            if (leavesList) void loadEntriesRef.current();
            else setEntries(current => current.map(e => (e.id === entry.id ? entry : e)));
            Alert.alert("Couldn't update star", result.message);
            return;
        }
        broadcastWrite();
    }, [db, broadcastWrite]);

    // A refresh has to know whether the filter CHANGED, because that is the only
    // thing that legitimately throws away the user's scroll depth. The signature
    // is captured in the loader's closure (rebuilt on every filter change); the
    // ref holds what the PREVIOUS run saw.
    const filterSignature = `${debouncedQuery} ${moodPresetKey} ${starredOnly}`;
    const lastLoadedFilterRef = useRef(filterSignature);
    const filterResetPendingRef = useRef(false);

    // Focus-aware reload. Runs whenever the Timeline tab regains focus and
    // re-runs while focused when the data version bumps (any write, here or on
    // another screen). The full-screen spinner shows ONLY on the very first load.
    //
    // IT RE-READS THE WHOLE LOADED WINDOW, NOT PAGE 0 (2026-09-13). A refresh
    // that read one page over a list the user had paged five deep truncated the
    // content under the scroll offset; Android clamped the offset into the
    // shorter content ("glitches me to the top") and the rows had to be re-earned
    // one onEndReached at a time ("can't get past a certain point"). Leaving the
    // Timeline and coming back KEEPS the user's place as a result — deliberately.
    const loadEntries = useCallback(async () => {
        // Claim this run BEFORE the first await so any later invocation (focus /
        // data-version bump / a loadMore) supersedes it.
        const runId = beginRun();
        const filterChanged = lastLoadedFilterRef.current !== filterSignature;
        lastLoadedFilterRef.current = filterSignature;
        if (filterChanged) {
            // A filter change is the ONE reset. Void the bookkeeping too: a filter
            // change fires BOTH useDataRefresh vectors in the same commit, and the
            // second run would otherwise read the OLD depth off the ref and
            // quietly restore it. The ref is re-derived on the next render.
            loadedCountRef.current = 0;
            // Same reason: the "start the new list at the top" decision must
            // survive this run being superseded by its twin, so it is a flag the
            // COMMITTING run consumes rather than this run's local.
            filterResetPendingRef.current = true;
        }
        const windowSize = Math.max(TIMELINE_PAGE_SIZE, loadedCountRef.current);
        if (!hasLoadedOnce.current) setIsLoading(true);
        try {
            const fetched = await getEntriesWindow(db, filtersRef.current, 0, windowSize);
            // A newer run started while these reads were in flight — drop this
            // (now stale) result so it can't overwrite the newer one.
            if (!isLatestRun(runId)) return;

            const prev = entriesRef.current;
            const next = reuseUnchanged(prev, fetched);
            // A SHORT window is proof there is nothing past it (the query starts
            // at offset 0). A full window says nothing either way.
            const nextHasMore = fetched.length === windowSize;

            if (filterResetPendingRef.current) {
                filterResetPendingRef.current = false;
                // The rows on screen were replaced wholesale — start at the top.
                jumpToTop(false);
            } else if (
                shouldRevealInsertion({
                    prevIds: new Set(prev.map(e => e.id)),
                    next,
                    nextRows: buildTimelineRows(next, nextHasMore),
                    firstVisibleKey: firstVisibleRowKey(),
                    scrollOffset: scrollOffsetRef.current,
                    nearTop: viewportHeightRef.current,
                })
            ) {
                jumpToTop(true);
            }

            // Only AFTER any jumpToTop above (it has to pause FlashList's
            // correction before these rows reach it).
            setEntries(next);
            setHasMore(nextHasMore);
            setLoadError(false);
        } catch (error) {
            // getEntriesWindow THROWS on a read failure. KEEP whatever is already
            // on screen and flag the error so the render can offer a retry when
            // there's nothing to show — NEVER fall through to EmptyState.
            console.error('Error loading timeline entries:', error);
            if (isLatestRun(runId)) setLoadError(true);
        } finally {
            // Only the latest run owns the loading flag / hasLoadedOnce.
            if (isLatestRun(runId)) {
                hasLoadedOnce.current = true;
                setIsLoading(false);
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- getEntriesWindow reads db + refs (not closed deps); the filter deps make this loader re-run (collapsing to one page) on a filter change via useDataRefresh; setState + latch identities are stable
    }, [db, debouncedQuery, moodPresetKey, starredOnly]);
    useDataRefresh(loadEntries, [db, debouncedQuery, moodPresetKey, starredOnly]);
    // The memoized star handler (declared above the loader) re-runs the CURRENT
    // loader through this ref; plain per-render closures call `loadEntries`.
    const loadEntriesRef = useRef(loadEntries);
    loadEntriesRef.current = loadEntries;

    /** Key of the first row on screen right now, or null before first layout. */
    function firstVisibleRowKey(): string | null {
        const index = listRef.current?.getFirstVisibleIndex?.() ?? -1;
        return index >= 0 ? rowsRef.current[index]?.key ?? null : null;
    }

    // Bin badge count. Rides the SAME focus/data-version signal as the list.
    // `getBinCount` never throws (a badge must not break the Timeline).
    const loadBinCount = useCallback(async () => {
        setBinCount(await getBinCount(db));
    }, [db]);
    useDataRefresh(loadBinCount, [db]);

    // Undo: put the entry straight back. A full reload (not a local splice) is
    // what restores it to its correct DATE position; the reload's reveal logic
    // brings it into view if it landed above the user near the top.
    const handleUndoDelete = async (entryId: number) => {
        const result = await restoreMoodEntry(db, entryId);
        if (!result.success) {
            Alert.alert("Couldn't restore entry", result.message);
            return;
        }
        await loadEntries();
        broadcastWrite();
    };

    const handleUpdate = async (formData: EntryFormData) => {
        if (!currentEntry) return;
        // updateMoodEntry owns the SQL + photo-diff/file-copy logic. On failure we
        // KEEP the edit modal open with the draft intact and surface the error.
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

    const hasMoreRef = useRef(hasMore);
    hasMoreRef.current = hasMore;
    const loadMoreData = useCallback(async () => {
        // Guard on the REF, not the state (see isLoadingMoreRef).
        if (isLoadingMoreRef.current || !hasMoreRef.current) return;

        // Pagination joins the same run sequence: if a fresh load begins while
        // this page is loading, this run must not append onto the list the newer
        // load just refreshed.
        const runId = beginRun();
        isLoadingMoreRef.current = true;
        setIsLoadingMore(true);
        try {
            // OFFSET = rows on screen, not a page counter (note 2 above).
            const offset = loadedCountRef.current;
            const page = await getEntriesWindow(db, filtersRef.current, offset, TIMELINE_PAGE_SIZE);
            if (!isLatestRun(runId)) return;
            if (page.length > 0) {
                // De-dupe by id: an entry added between two reads shifts the
                // window, so this offset can hand back a row already on screen.
                setEntries(prev => appendUnique(prev, page));
            }
            setHasMore(page.length === TIMELINE_PAGE_SIZE);
        } catch (error) {
            console.error('Error loading more data:', error);
        } finally {
            // Always clear the loading flag, even when superseded: it's guard UI
            // state, not list data, and leaving it stuck would block the guard.
            isLoadingMoreRef.current = false;
            setIsLoadingMore(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- reads db + refs; latch identities are stable
    }, [db]);

    // ── Scroll tracking ──────────────────────────────────────────────────────
    // Offset and viewport height go into refs (read by the reveal decision);
    // the only STATE is the back-to-top pill's visibility, set only when it
    // actually flips, so scrolling never re-renders the screen per frame.
    const showBackToTopRef = useRef(false);
    const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
        const { contentOffset, layoutMeasurement } = event.nativeEvent;
        scrollOffsetRef.current = contentOffset.y;
        if (layoutMeasurement?.height) viewportHeightRef.current = layoutMeasurement.height;
        const show = shouldShowBackToTop(contentOffset.y, viewportHeightRef.current);
        if (show !== showBackToTopRef.current) {
            showBackToTopRef.current = show;
            setShowBackToTop(show);
        }
    }, []);

    const handleLayout = useCallback((event: LayoutChangeEvent) => {
        viewportHeightRef.current = event.nativeEvent.layout.height;
    }, []);

    const scrollToTop = useCallback(() => {
        listRef.current?.scrollToOffset({ offset: 0, animated: true });
    }, []);

    // ── Rendering ────────────────────────────────────────────────────────────
    // Memoized along with the handlers it passes down, so a parent state change
    // (a spinner toggling, a page appending) re-binds only rows whose props
    // changed instead of every mounted card.
    const renderItem = useCallback(
        ({ item, target }: ListRenderItemInfo<TimelineRow>) =>
            item.type === 'header' ? (
                <DayHeader
                    dayKey={item.dayKey}
                    count={item.count}
                    averageMood={item.averageMood}
                    complete={item.complete}
                    dateFormatPref={dateFormatPref}
                    colors={colors}
                    sticky={target === 'StickyHeader'}
                />
            ) : (
                <EntryCard
                    entry={item.entry}
                    isFirstOfDay={item.isFirstOfDay}
                    isLastOfDay={item.isLastOfDay}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    onToggleStar={handleToggleStar}
                    colors={colors}
                />
            ),
        [handleEdit, handleDelete, handleToggleStar, colors, dateFormatPref]
    );

    const keyExtractor = useCallback((row: TimelineRow) => row.key, []);

    const footer = (
        <TimelineFooter state={footerStateFor(isLoadingMore, hasMore, entries.length)} colors={colors} />
    );

    // EntryFormModal is rendered UNCONDITIONALLY below — never behind an early
    // return. A focus refetch can flip `isLoading`, and if the edit form lived
    // past an early return it would unmount mid-edit and destroy the user's
    // draft. So the loading/empty/list states are chosen inline while the form
    // stays mounted across all of them.
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
            {isLoading && entries.length === 0 ? (
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color={colors.accent} />
                </View>
            ) : loadError && entries.length === 0 ? (
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
            ) : entries.length === 0 ? (
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
                <View style={styles.listFrame} testID="timeline-list-frame">
                    <FlashList
                        ref={listRef}
                        testID="timeline-list"
                        data={rows}
                        renderItem={renderItem}
                        keyExtractor={keyExtractor}
                        getItemType={rowTypeOf}
                        stickyHeaderIndices={stickyHeaderIndices}
                        onEndReached={loadMoreData}
                        onEndReachedThreshold={END_REACHED_SCREENS}
                        drawDistance={DRAW_DISTANCE}
                        onScroll={handleScroll}
                        onLayout={handleLayout}
                        scrollEventThrottle={16}
                        keyboardDismissMode="on-drag"
                        keyboardShouldPersistTaps="handled"
                        ListFooterComponent={footer}
                        contentContainerStyle={styles.listContent}
                    />
                </View>
            )}
            {showBackToTop && pendingUndo === null && entries.length > 0 ? (
                <BackToTopPill colors={colors} onPress={scrollToTop} />
            ) : null}
            {/* Undo affordance for the soft delete. In-tree (mounted through the
                OverlayHost), never a react-native <Modal>. Keyed by the undo nonce
                so a second delete restarts the countdown. */}
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
                    loadEntries();
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
