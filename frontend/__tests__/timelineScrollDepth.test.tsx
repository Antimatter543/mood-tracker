/**
 * Regression tests for the Timeline scroll bug reported 2026-09-13: "when in
 * timeline if i scroll too fast or too far down it glitches me all the way up and
 * tbh im not sure i can even scroll down past a certain point".
 *
 * Reproduced on the Pixel 3 against the installed 2.11.1 release, and depth-
 * dependent rather than fling-dependent. Two of the three defects behind it are
 * pure data-window logic and therefore testable here; the third (the list was
 * effectively unvirtualized and re-rendered every mounted card) is covered by
 * timelineListPerf.test.tsx.
 *
 * DEFECT 1 — a refresh TRUNCATED the list.
 *   `loadInitialData` always read exactly ITEMS_PER_PAGE rows and reset the page
 *   counter, and `useDataRefresh` runs it on every focus gain AND every
 *   data-version bump (i.e. after ANY write, on this screen or another). Deep in
 *   the list that replaced 100+ rendered rows with 20: the content height
 *   collapsed under the scroll offset, the native ScrollView clamped the offset
 *   into the much shorter content — the "glitches me all the way up" — and the
 *   rows the user had paged in had to be re-fetched one `onEndReached` at a time,
 *   which is the "can't get past a certain point". A refresh now re-reads the
 *   WHOLE loaded window.
 *
 * DEFECT 2 — the next page's SQL OFFSET came from a page counter, which the
 *   list's LOCAL splices desynced. Deleting an entry removes a row from
 *   `sections` but left `page` alone, so the following page started one row too
 *   far in and an entry was skipped for good. The offset is now derived from the
 *   rows actually on screen, so the two cannot drift.
 *
 * HOW THESE ARE ASSERTED: on the `(limit, offset)` the component asks SQL for.
 * That is the whole contract — and it is the only observable one, because under
 * jest a VirtualizedList never receives layout events, so it mounts
 * `initialNumToRender` cells regardless of how many rows the data actually holds.
 * Counting visible cards would prove nothing; the requested window proves
 * everything. Both assertions FAIL on the pre-fix component (defect 1 requests
 * limit 20 instead of the loaded depth; defect 2 requests offset 60 instead of 59).
 */
import React from 'react';
import { render, act, waitFor, fireEvent } from '@testing-library/react-native';
import { TIMELINE_PAGE_SIZE } from '@/components/timeline/timelineRows';

// ── expo-router: `useFocusEffect` models a focus gain that re-runs when the
//    callback identity changes (production behaviour — react-navigation re-runs
//    the effect on a new callback), which is how a filter change reaches the
//    loader. VECTOR 2 (the data-version effect) is driven by `mockDataVersion`. ──
let mockDataVersion = 0;
jest.mock('expo-router', () => {
    const ReactActual = require('react') as typeof React;
    return {
        useFocusEffect: (cb: () => void | (() => void)) => {
            ReactActual.useEffect(() => cb(), [cb]);
        },
        useIsFocused: () => true,
    };
});

// ── The DB: a synthetic 5-page table served through the REAL
//    limit/offset bind positions, so the test exercises the window the component
//    actually asks for instead of a hand-fed page. `getEntriesWindow` binds
//    `[...filterParams, limit, offset]`, so the window is always the last two. ──
type Window = { limit: number; offset: number };
const windows: Window[] = [];

const DAY_MS = 86_400_000;
const entryRow = (id: number) => ({
    id,
    mood: 7,
    notes: `entry-${id}`,
    // 5 entries per local day, so the list has ~20 date sections at full depth
    // (section identity across the per-page regroup is part of what we exercise).
    date: new Date(Date.UTC(2026, 5, 12) - Math.floor((id - 1) / 5) * DAY_MS).toISOString(),
    starred_at: null,
    activity_ids: null,
    activity_names: null,
    activity_group_ids: null,
    activity_icon_names: null,
    activity_icon_families: null,
});
const TOTAL_ENTRIES = 5 * TIMELINE_PAGE_SIZE;
/** Rows still live in the fake DB, newest first. Deletes remove from here too. */
let table = Array.from({ length: TOTAL_ENTRIES }, (_, i) => entryRow(i + 1));

const mockDb = {
    getAllAsync: jest.fn(async (_sql: string, params: any[] = []) => {
        const limit = Number(params[params.length - 2]);
        const offset = Number(params[params.length - 1]);
        windows.push({ limit, offset });
        return table.slice(offset, offset + limit);
    }),
    getFirstAsync: jest.fn().mockResolvedValue(null),
    runAsync: jest.fn().mockResolvedValue({ lastInsertRowId: 1, changes: 1 }),
};
jest.mock('expo-sqlite', () => ({
    useSQLiteContext: () => mockDb,
}));

jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 48, left: 0, right: 0 }),
}));
jest.mock('react-native-reanimated', () => {
    const ReactLocal = require('react');
    const { View } = require('react-native');
    const anim = { duration: () => anim };
    return {
        __esModule: true,
        default: {
            View: (props: Record<string, unknown>) => ReactLocal.createElement(View, props),
        },
        FadeIn: anim,
        FadeInDown: anim,
        FadeOutDown: anim,
    };
});
jest.mock('@/hooks/useKeyboardHeight', () => ({ useKeyboardHeight: () => 0 }));

const THEME = {
    background: '#000',
    cardBackground: '#111',
    secondaryBackground: '#222',
    text: '#fff',
    textSecondary: '#aaa',
    border: '#333',
    accent: '#4CAF50',
    accentDark: '#388E3C',
    accentLight: 'rgba(76,175,80,0.1)',
    overlays: { tag: '#222', tagBorder: '#333', border: '#333', textSecondary: '#aaa' },
    elevation: { shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, elevation: 8 },
    isDark: true,
};
jest.mock('@/styles/global', () => ({ useThemeColors: () => THEME }));
jest.mock('@/context/DataContext', () => ({
    useDataContext: () => ({ refetchEntries: jest.fn() }),
}));
jest.mock('@/context/dataRefreshStore', () => ({
    useDataVersion: () => mockDataVersion,
}));
jest.mock('@/databases/entry-media', () => ({
    getMediaByEntryIds: jest.fn().mockResolvedValue({}),
}));
jest.mock('@/databases/mediaHelpers', () => ({
    MEDIA_DIR: 'file:///media/',
    copyToMediaDir: jest.fn(),
    deleteMediaFile: jest.fn(),
}));

let mockSetEntryStarred = jest.fn().mockResolvedValue({ success: true, message: 'ok' });

// The soft delete: succeeds, and removes the row from the fake table so the next
// window read reflects the DB the way a real soft delete would.
const mockDeleteMoodEntry = jest.fn(async (_db: unknown, id: number) => {
    table = table.filter((row) => row.id !== id);
    return { success: true, message: 'ok' };
});
jest.mock('@/databases/entries', () => ({
    ...jest.requireActual('@/databases/entries'),
    deleteMoodEntry: (...args: any[]) => (mockDeleteMoodEntry as any)(...args),
    updateMoodEntry: jest.fn().mockResolvedValue({ success: true, message: 'ok' }),
    setEntryStarred: (...args: any[]) => (mockSetEntryStarred as any)(...args),
}));
// Keep the bin badge off `getAllAsync` so `windows` only ever records entry reads.
jest.mock('@/databases/entry-bin', () => ({
    BIN_RETENTION_DAYS: 30,
    getBinCount: jest.fn().mockResolvedValue(0),
    getBinnedEntries: jest.fn().mockResolvedValue([]),
    restoreMoodEntry: jest.fn().mockResolvedValue({ success: true, message: 'ok' }),
    purgeMoodEntry: jest.fn().mockResolvedValue({ success: true, message: 'ok' }),
}));
jest.mock('@/components/forms/EntryForm', () => ({ EntryFormModal: () => null }));
jest.mock('@/components/EmptyState', () => ({ EmptyState: () => null }));
// A card thin enough to drive from a test: its notes as text, plus delete and
// star buttons that exercise the real `onDelete(id)` / `onToggleStar(entry)`
// contracts.
jest.mock('@/components/timeline/EntryCard', () => ({
    EntryCard: ({ entry, onDelete, onToggleStar }: any) => {
        const ReactActual = require('react') as typeof React;
        const { Text: RNText, Pressable, View: RNView } = require('react-native');
        return ReactActual.createElement(
            RNView,
            null,
            ReactActual.createElement(
                Pressable,
                { testID: `delete-${entry.id}`, onPress: () => onDelete(entry.id) },
                ReactActual.createElement(RNText, null, entry.notes)
            ),
            ReactActual.createElement(Pressable, {
                testID: `star-${entry.id}`,
                // Not returned: RNTL 14 awaits a handler's promise, and the test
                // holds the star write open on purpose.
                onPress: () => {
                    void onToggleStar(entry);
                },
            })
        );
    },
}));

import { OverlayProvider } from '@/context/OverlayHost';
import { DatabaseViewer } from '@/components/DBViewer';

const ITEMS_PER_PAGE = TIMELINE_PAGE_SIZE;
const P = TIMELINE_PAGE_SIZE;

const renderTimeline = () =>
    render(
        <OverlayProvider>
            <DatabaseViewer />
        </OverlayProvider>
    );

/**
 * The loaded entries, read off the list itself: the FlashList probe
 * (__mocks__/@shopify/flash-list.tsx) puts every prop on the testID'd host, so
 * `props.data` IS the flat row array (day headers + entries).
 */
const loadedEntries = (view: any): any[] =>
    view
        .getByTestId('timeline-list')
        .props.data.filter((row: any) => row.type === 'entry')
        .map((row: any) => row.entry);
const loadedIds = (view: any): number[] => loadedEntries(view).map((e: any) => e.id);

/** Fire the list's own `onEndReached` — the real pagination entry point. */
const reachEnd = async (view: ReturnType<typeof render> extends Promise<infer T> ? T : any) => {
    const list = view.getByTestId('timeline-list');
    await act(async () => {
        list.props.onEndReached();
    });
};

beforeEach(() => {
    jest.clearAllMocks();
    mockDataVersion = 0;
    windows.length = 0;
    table = Array.from({ length: TOTAL_ENTRIES }, (_, i) => entryRow(i + 1));
    mockDb.getAllAsync.mockImplementation(async (_sql: string, params: any[] = []) => {
        const limit = Number(params[params.length - 2]);
        const offset = Number(params[params.length - 1]);
        windows.push({ limit, offset });
        return table.slice(offset, offset + limit);
    });
    mockDb.getFirstAsync.mockResolvedValue(null);
});

/** Mount and paginate to `pages` pages loaded. Returns the rendered view. */
const mountAtDepth = async (pages: number) => {
    const view = await renderTimeline();
    await waitFor(() => expect(windows.length).toBeGreaterThan(0));
    for (let i = 1; i < pages; i++) {
        await reachEnd(view);
        await waitFor(() => expect(windows.length).toBeGreaterThanOrEqual(i + 1));
    }
    return view;
};

describe('Timeline — a refresh must preserve the loaded scroll depth', () => {
    it('loads one page on mount and appends by OFFSET, never re-reading page 0', async () => {
        const view = await mountAtDepth(3);
        expect(windows).toEqual([
            { limit: ITEMS_PER_PAGE, offset: 0 },
            { limit: ITEMS_PER_PAGE, offset: P },
            { limit: ITEMS_PER_PAGE, offset: 2 * P },
        ]);
        // Sanity: the deepest page's rows really did reach the component's data.
        expect(loadedEntries(view)).toHaveLength(3 * P);
    });

    it('re-reads the WHOLE loaded window on a data-version bump (the truncation bug)', async () => {
        const view = await mountAtDepth(3);
        windows.length = 0;

        // Any write anywhere in the app bumps the data version; the Timeline must
        // refresh IN PLACE rather than collapsing back to a single page.
        await act(async () => {
            mockDataVersion = 1;
            view.rerender(
                <OverlayProvider>
                    <DatabaseViewer />
                </OverlayProvider>
            );
        });
        await waitFor(() => expect(windows.length).toBeGreaterThan(0));

        // Before 2026-09-13 this was `{ limit: P, offset: 0 }`: 3P loaded rows
        // replaced by P, the scroll offset clamped into the shorter content.
        expect(windows).toContainEqual({ limit: 3 * P, offset: 0 });
        expect(windows.every((w) => w.offset === 0 && w.limit === 3 * P)).toBe(true);
        expect(loadedEntries(view)).toHaveLength(3 * P);
    });

    it('keeps paginating from the refreshed depth, not from page 1', async () => {
        const view = await mountAtDepth(3);
        await act(async () => {
            mockDataVersion = 1;
            view.rerender(
                <OverlayProvider>
                    <DatabaseViewer />
                </OverlayProvider>
            );
        });
        await waitFor(() => expect(windows).toContainEqual({ limit: 3 * P, offset: 0 }));
        windows.length = 0;

        await reachEnd(view);
        await waitFor(() => expect(windows.length).toBe(1));
        // The next page continues past the refreshed window instead of re-fetching
        // the second page all over again.
        expect(windows[0]).toEqual({ limit: ITEMS_PER_PAGE, offset: 3 * P });
    });

    it('collapses back to one page when the FILTER changes (the one legitimate reset)', async () => {
        const view = await mountAtDepth(3);
        windows.length = 0;

        // A mood chip changes the filter: the loaded rows no longer match, so
        // starting over at one page is correct.
        await act(async () => {
            await fireEvent.press(view.getByTestId('mood-filter-low'));
        });
        await waitFor(() => expect(windows.length).toBeGreaterThan(0));

        expect(windows.every((w) => w.offset === 0 && w.limit === ITEMS_PER_PAGE)).toBe(true);
    });
});

describe("Timeline — the next page's offset follows the rows on screen", () => {
    it('does not skip an entry after a local delete shortens the list', async () => {
        const view = await mountAtDepth(3);
        // Deleting an entry splices it out of the rendered list, leaving 3P-1 rows.
        await act(async () => {
            await fireEvent.press(view.getByTestId('delete-1'));
        });
        await waitFor(() => expect(mockDeleteMoodEntry).toHaveBeenCalledWith(mockDb, 1));
        await waitFor(() => expect(loadedEntries(view)).toHaveLength(3 * P - 1));
        windows.length = 0;

        await reachEnd(view);
        await waitFor(() => expect(windows.length).toBe(1));
        // Before 2026-09-13: offset 3P (page 3 x P) over a 3P-1 row window, so
        // entry 3P+1 was never fetched by any page and vanished from the history.
        expect(windows[0]).toEqual({ limit: ITEMS_PER_PAGE, offset: 3 * P - 1 });
        await waitFor(() => expect(loadedIds(view)).toContain(3 * P + 1));
    });

    it('never loads the same entry twice, at any depth', async () => {
        const view = await mountAtDepth(5);
        const ids = loadedIds(view);
        expect(ids).toHaveLength(new Set(ids).size);
        // Duplicate ids would be duplicate list keys, which breaks FlashList's
        // key-anchored content-position maintenance and its cell recycling.
        expect(ids).toEqual(Array.from({ length: TOTAL_ENTRIES }, (_, i) => i + 1));
        const keys = view.getByTestId('timeline-list').props.data.map((row: any) => row.key);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it('stops asking for more once a window comes back short', async () => {
        const view = await mountAtDepth(5); // all 5P rows loaded
        windows.length = 0;
        await reachEnd(view);
        await waitFor(() => expect(windows.length).toBe(1));
        expect(windows[0]).toEqual({ limit: ITEMS_PER_PAGE, offset: TOTAL_ENTRIES });
        windows.length = 0;
        // hasMore is now false, so the list stops hitting SQL on every fling that
        // lands at the bottom.
        await reachEnd(view);
        expect(windows).toHaveLength(0);
    });
});

describe('Timeline, a failed star toggle', () => {
    it('reverts only that entry and keeps a page appended while the write was in flight', async () => {
        const { Alert } = require('react-native');
        jest.spyOn(Alert, 'alert').mockImplementation(() => {});
        const view = await mountAtDepth(2);
        let failWrite: (r: unknown) => void = () => {};
        mockSetEntryStarred = jest.fn(
            () => new Promise((resolve) => { failWrite = resolve; })
        );

        await fireEvent.press(view.getByTestId('star-1'));
        await waitFor(() =>
            expect(loadedEntries(view).find((e: any) => e.id === 1).starred_at).not.toBeNull()
        );
        // A page lands while the star write is still pending.
        await reachEnd(view);
        await waitFor(() => expect(loadedEntries(view)).toHaveLength(3 * P));

        await act(async () => {
            failWrite({ success: false, message: 'disk full' });
        });

        // Before this fix the handler restored a snapshot taken BEFORE the await:
        // the appended page vanished (3P -> 2P rows) under the user.
        expect(loadedEntries(view)).toHaveLength(3 * P);
        expect(loadedEntries(view).find((e: any) => e.id === 1).starred_at).toBeNull();
        expect(Alert.alert).toHaveBeenCalledWith("Couldn't update star", 'disk full');
        mockSetEntryStarred = jest.fn().mockResolvedValue({ success: true, message: 'ok' });
    });
});
