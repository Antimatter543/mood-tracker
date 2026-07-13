/**
 * Regression test for the Timeline blank-list race (DBViewer).
 *
 * THE BUG (pre-existing, same class as Home's old fetchData): DBViewer loads the
 * list with `loadInitialData`, an UNCANCELLED async loader driven by
 * `useDataRefresh` — it fires on every focus gain and every `refreshCount` bump,
 * and the hook ignores the Promise it returns (it can't cancel it; see
 * hooks/useDataRefresh.ts). So two overlapping invocations can resolve in EITHER
 * order, and if the older (stale) run resolves LAST its setSections/setPage/
 * setHasMore overwrite the newer run's state. When that stale read came back
 * short/empty, the list blanks (sections.length === 0 -> <EmptyState/>) and stays
 * blank until the screen remounts — the reported "Timeline renders blank until I
 * reopen the app" bug. DBViewer, unlike Home, was never given the useLatestRun
 * race-latch; this test pins that it now is.
 *
 * WHY a render-level test (not pure-unit): the latch fix lives in DBViewer's
 * loaders, so the contract under test is "the COMPONENT does not blank the list
 * when a stale load resolves after a fresh one." We render the real DatabaseViewer
 * (the dbViewerEntryFormMount.test.tsx harness already does exactly this) and hand
 * `getAllAsync` manually-resolvable deferred promises so the out-of-order
 * resolution is forced deterministically — no timers, no flakiness. The latch
 * itself also has direct unit coverage in useLatestRun.test.ts ("the slow earlier
 * run does not clobber the fast later run"); this test proves the wiring.
 */
import React from 'react';
import { render, act, waitFor } from '@testing-library/react-native';

// ── Mock expo-router. `useFocusEffect` models FOCUS GAIN only (mount-once) so it
//    does NOT double the loader on a refreshCount bump; the SECOND overlapping
//    load (run B) is driven purely by useDataRefresh's VECTOR 2 (`useIsFocused`-
//    gated effect on refreshCount) when the test bumps refreshCount. This mirrors
//    production: useFocusEffect owns focus transitions, VECTOR 2 owns in-focus
//    data updates. (Before VECTOR 2 existed this mock re-ran on callback identity;
//    keeping that here would fire BOTH vectors and enqueue 3 reads, not 2.) ──────
let mockRefreshCount = 0;
jest.mock('expo-router', () => {
    const ReactActual = require('react') as typeof React;
    return {
        useFocusEffect: (cb: () => void | (() => void)) => {
            // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only; ref keeps the latest cb without re-running on identity change
            const ref = ReactActual.useRef(cb);
            ref.current = cb;
            ReactActual.useEffect(() => ref.current(), []);
        },
        useIsFocused: () => true,
    };
});

// ── Deferred-promise factory: lets the test settle each getAllAsync call by hand
//    so we can force the stale-after-fresh resolution order the bug needs. ───────
type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void };
const defer = <T,>(): Deferred<T> => {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => {
        resolve = r;
    });
    return { promise, resolve };
};

// FIFO queue of deferreds — each getAllAsync (page-0 read) pulls the next one, so
// the test controls exactly which invocation resolves first/last.
let pendingReads: Deferred<any[]>[] = [];
const mockDb = {
    getAllAsync: jest.fn(() => {
        const d = defer<any[]>();
        pendingReads.push(d);
        return d.promise;
    }),
    getFirstAsync: jest.fn().mockResolvedValue(null),
    runAsync: jest.fn().mockResolvedValue({ lastInsertRowId: 1, changes: 1 }),
    withExclusiveTransactionAsync: jest
        .fn()
        .mockImplementation(async (cb: () => Promise<void>) => cb()),
};
jest.mock('expo-sqlite', () => ({
    useSQLiteContext: () => mockDb,
}));

// ── Minimal theme so useThemeColors works without SettingsProvider ───────────
jest.mock('@/styles/global', () => ({
    useThemeColors: () => ({
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
    }),
}));

// ── Data context: exposes refetchEntries; DBViewer calls it after edits/deletes.
jest.mock('@/context/DataContext', () => ({
    useDataContext: () => ({
        refetchEntries: jest.fn(),
    }),
}));

// ── The reload signal is the external data-version store (useDataRefresh reads
// useDataVersion). The test mutates `mockRefreshCount` to fire the second load,
// so wire the store's version to that same variable. ───────────────────────────
jest.mock('@/context/dataRefreshStore', () => ({
    useDataVersion: () => mockRefreshCount,
}));

// ── No photos to load for any entry (avoids a second getAllAsync per page). ────
jest.mock('@/databases/entry-media', () => ({
    getMediaByEntryIds: jest.fn().mockResolvedValue({}),
}));
jest.mock('@/databases/mediaHelpers', () => ({
    MEDIA_DIR: 'file:///media/',
    copyToMediaDir: jest.fn(),
    deleteMediaFile: jest.fn(),
}));

// ── Sentinel leaf stubs so the tree renders without heavy deps (reanimated, the
//    image picker, sortables). Same approach as dbViewerEntryFormMount.test.tsx. ─
jest.mock('@/components/forms/EntryForm', () => ({
    EntryFormModal: () => null,
}));
const EMPTY_STATE_TEXT = '__EMPTY_STATE__';
jest.mock('@/components/EmptyState', () => ({
    EmptyState: () => {
        const ReactActual = require('react') as typeof React;
        const { Text: RNText } = require('react-native');
        return ReactActual.createElement(RNText, null, EMPTY_STATE_TEXT);
    },
}));
// EntryCard renders the entry's notes as plain text we can assert on, with no
// icon/photo dependencies.
jest.mock('@/components/timeline/EntryCard', () => ({
    EntryCard: ({ entry }: { entry: { notes: string } }) => {
        const ReactActual = require('react') as typeof React;
        const { Text: RNText } = require('react-native');
        return ReactActual.createElement(RNText, null, entry.notes);
    },
}));

// Import AFTER mocks are registered.
import { DatabaseViewer } from '@/components/DBViewer';

const entryRow = (id: number, notes: string) => ({
    id,
    mood: 7,
    notes,
    date: '2026-06-12T10:00:00.000Z',
    activity_ids: null,
    activity_names: null,
    activity_group_ids: null,
    activity_icon_names: null,
    activity_icon_families: null,
});

// Settle the Nth-oldest queued read (0 = first/oldest still pending).
const settleRead = async (index: number, rows: any[]) => {
    const d = pendingReads[index];
    if (!d) throw new Error(`no pending read at index ${index} (have ${pendingReads.length})`);
    await act(async () => {
        d.resolve(rows);
        await d.promise;
    });
};

beforeEach(() => {
    jest.clearAllMocks();
    pendingReads = [];
    mockRefreshCount = 0;
});

describe('DBViewer — a stale load must not clobber/blank the list (race-latch)', () => {
    it('drops a STALE empty load that resolves AFTER a fresh populated load', async () => {
        // Mount: focus run A (refreshCount=0) fires loadInitialData; its page-0
        // read suspends on pendingReads[0]. Nothing has committed yet.
        const view = await render(<DatabaseViewer />);
        await waitFor(() => expect(pendingReads.length).toBe(1));

        // Bump refreshCount -> the focus hook re-runs the loader: run B fires while
        // A is still in flight; B's page-0 read suspends on pendingReads[1].
        await act(async () => {
            mockRefreshCount = 1;
            view.rerender(<DatabaseViewer />);
        });
        await waitFor(() => expect(pendingReads.length).toBe(2));

        // Run B (the LATEST) resolves FIRST with a real entry -> list renders it.
        await settleRead(1, [entryRow(1, 'fresh-entry')]);
        await waitFor(() => expect(view.queryByText('fresh-entry')).not.toBeNull());

        // Run A (STALE) resolves LAST with EMPTY rows. Pre-fix this would
        // setSections([]) -> the EmptyState branch -> a blank Timeline until
        // remount. The latch must drop it: the fresh entry stays, no EmptyState.
        await settleRead(0, []);

        expect(view.queryByText('fresh-entry')).not.toBeNull();
        expect(view.queryByText(EMPTY_STATE_TEXT)).toBeNull();
    });

    it('lets the LATEST load win even when it resolves AFTER an earlier one', async () => {
        // Symmetric ordering: prove the latch keys on RECENCY-of-start, not
        // order-of-resolution. Run A starts first then resolves first (populated);
        // run B starts second (the latest) and resolves last (also populated, with
        // a DIFFERENT entry). The final committed state must be B's, never A's.
        const view = await render(<DatabaseViewer />);
        await waitFor(() => expect(pendingReads.length).toBe(1));

        await act(async () => {
            mockRefreshCount = 1;
            view.rerender(<DatabaseViewer />);
        });
        await waitFor(() => expect(pendingReads.length).toBe(2));

        // Run A (older) resolves first with entry #1.
        await settleRead(0, [entryRow(1, 'older-run-entry')]);
        // Run B (latest) resolves last with entry #2 — B must be the final state.
        await settleRead(1, [entryRow(2, 'latest-run-entry')]);

        expect(view.queryByText('latest-run-entry')).not.toBeNull();
        // A's result was superseded the moment B began, so even though A committed
        // first, B's later commit is the one that stands (and A can't re-clobber).
        expect(view.queryByText('older-run-entry')).toBeNull();
        expect(view.queryByText(EMPTY_STATE_TEXT)).toBeNull();
    });
});
