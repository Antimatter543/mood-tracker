/**
 * The Timeline against the REAL @shopify/flash-list (every other Timeline test
 * uses the probe in __mocks__/@shopify/flash-list.tsx).
 *
 * Under jest no list gets real layout, so this cannot show a fling. What it CAN
 * show, and what the probe cannot: that the props DBViewer hands FlashList are
 * ones the real RecyclerView accepts and renders from — rows through
 * `renderItem`, day headers through the same `renderItem` with the sticky
 * target, keys, item types, the constant-height footer — with no error logged.
 * The measure functions are stubbed as the package's own jestSetup.js does (a
 * 400x900 window of 100px items).
 */
import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import { ScrollView, StyleSheet } from 'react-native';

// In 2.0.2 FlashList IS the RecyclerView (src/FlashList.ts re-exports it), so the
// real export is used as-is. (The package's jestSetup.js maps FlashList to a
// `RecyclerView` export that 2.0.2 no longer has; copying it verbatim renders
// `undefined`.)
jest.mock('@shopify/flash-list', () => jest.requireActual('@shopify/flash-list'));
jest.mock('@shopify/flash-list/dist/recyclerview/utils/measureLayout', () => {
    const original = jest.requireActual('@shopify/flash-list/dist/recyclerview/utils/measureLayout');
    return {
        ...original,
        measureParentSize: jest.fn(() => ({ x: 0, y: 0, width: 400, height: 900 })),
        measureFirstChildLayout: jest.fn(() => ({ x: 0, y: 0, width: 400, height: 900 })),
        measureItemLayout: jest.fn(() => ({ x: 0, y: 0, width: 100, height: 100 })),
    };
});

jest.mock('expo-router', () => {
    const ReactActual = require('react') as typeof React;
    return {
        useFocusEffect: (cb: () => void | (() => void)) => {
            ReactActual.useEffect(() => cb(), [cb]);
        },
        useIsFocused: () => true,
    };
});
const mockDb = {
    getAllAsync: jest.fn(),
    getFirstAsync: jest.fn().mockResolvedValue(null),
    runAsync: jest.fn().mockResolvedValue({ lastInsertRowId: 1, changes: 1 }),
};
jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => mockDb }));
jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 48, left: 0, right: 0 }),
}));
jest.mock('react-native-reanimated', () => {
    const ReactLocal = require('react');
    const { View } = require('react-native');
    const anim = { duration: () => anim };
    return {
        __esModule: true,
        default: { View: (props: Record<string, unknown>) => ReactLocal.createElement(View, props) },
        FadeIn: anim,
        FadeInDown: anim,
        FadeOutDown: anim,
    };
});
jest.mock('@/hooks/useKeyboardHeight', () => ({ useKeyboardHeight: () => 0 }));
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
jest.mock('@/context/DataContext', () => ({ useDataContext: () => ({ refetchEntries: jest.fn() }) }));
// Mutable so a test can announce a write (a bump re-runs the Timeline's loader).
let mockRefreshCount = 0;
jest.mock('@/context/dataRefreshStore', () => ({ useDataVersion: () => mockRefreshCount }));
jest.mock('@/databases/entry-media', () => ({ getMediaByEntryIds: jest.fn().mockResolvedValue({}) }));
jest.mock('@/databases/mediaHelpers', () => ({
    MEDIA_DIR: 'file:///media/',
    copyToMediaDir: jest.fn(),
    deleteMediaFile: jest.fn(),
}));
jest.mock('@/databases/entry-bin', () => ({
    BIN_RETENTION_DAYS: 30,
    getBinCount: jest.fn().mockResolvedValue(0),
    getBinnedEntries: jest.fn().mockResolvedValue([]),
    restoreMoodEntry: jest.fn().mockResolvedValue({ success: true, message: 'ok' }),
    purgeMoodEntry: jest.fn().mockResolvedValue({ success: true, message: 'ok' }),
}));
jest.mock('@/components/forms/EntryForm', () => ({ EntryFormModal: () => null }));
jest.mock('@/components/EmptyState', () => ({ EmptyState: () => null }));

import { OverlayProvider } from '@/context/OverlayHost';
import { DatabaseViewer } from '@/components/DBViewer';

const row = (id: number, dayOffset: number) => ({
    id,
    mood: 6,
    notes: `note-${id}`,
    date: new Date(2026, 5, 20 - dayOffset, 12, 0, 0).toISOString(),
    starred_at: null,
    activity_ids: null,
    activity_names: null,
    activity_group_ids: null,
    activity_icon_names: null,
    activity_icon_families: null,
});

describe('Timeline on the real FlashList', () => {
    it('mounts, renders day headers and entries through the real recycler, and logs no error', async () => {
        const errors = jest.spyOn(console, 'error');
        errors.mockClear();
        // Two entries a day for ten days.
        mockDb.getAllAsync.mockResolvedValue(
            Array.from({ length: 20 }, (_, i) => row(100 - i, Math.floor(i / 2)))
        );

        const view = await render(
            <OverlayProvider>
                <DatabaseViewer />
            </OverlayProvider>
        );

        await waitFor(() => expect(view.queryByText('note-100')).not.toBeNull());
        // The first day's header rendered through renderItem TWICE: once in the
        // list, once as FlashList's pinned sticky copy (target "StickyHeader"),
        // which is the one that draws the pinned edge.
        const headers = view.queryAllByTestId('day-header-2026-06-20');
        expect(headers).toHaveLength(2);
        const edges = headers.map((h: any) => StyleSheet.flatten(h.props.style).borderBottomWidth ?? 0);
        expect(edges.filter((w: number) => w > 0)).toHaveLength(1);
        // Rows really were virtualized: 20 entries + 10 headers is more than a
        // 900px window of 100px rows draws.
        const cards = view.container.queryAll((n: any) => /^entry-\d+$/.test(n.props?.testID ?? ''));
        expect(cards.length).toBeGreaterThan(0);
        expect(cards.length).toBeLessThan(20);
        // The footer is always mounted (constant height, never toggled).
        expect(view.queryByTestId('timeline-footer')).not.toBeNull();
        expect(errors).not.toHaveBeenCalled();
    });
});

/**
 * Device QA 2026-09-28: near the top, an entry added via the FAB (or put back by
 * Undo) was counted in its day header but never appeared. FlashList's
 * content-position maintenance had "corrected" for the inserted row, keeping the
 * row it was anchored on still, which pushed the new row one row-height above
 * the viewport. The Timeline's reveal, a `scrollToOffset(0)` a frame after the
 * rows committed, reached Android as a view command, and Fabric runs view
 * commands BEFORE the mount that carries the correction, so the correction won.
 *
 * What this pins, on the REAL recycler: the commit that inserts rows above
 * FlashList's anchor, while the user is near the top, is NOT offset-corrected,
 * because the Timeline issues its reveal through `scrollToIndex` (which pauses
 * that correction) BEFORE the rows reach the list. The correction is observable
 * under jest: FlashList applies it by moving its ScrollAnchor (an absolute,
 * 0-height View parked at top: 1_000_000) by the correction, and the native side
 * scrolls by however far that view moves. On the pre-fix code the anchor moved.
 *
 * What it can NOT show: the native ordering itself (no Fabric under jest), or
 * pixels. That half was verified on the Pixel in Expo Go (lessons 2026-09-28).
 */
describe('Timeline on the real FlashList: an insertion near the top is revealed, not corrected away', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const measure = require('@shopify/flash-list/dist/recyclerview/utils/measureLayout') as {
        measureParentSize: jest.Mock;
        measureFirstChildLayout: jest.Mock;
        measureItemLayout: jest.Mock;
    };
    // The jest ScrollView mock's instance methods live on its prototype.
    const scrollTo = ScrollView.prototype.scrollTo as unknown as jest.Mock;

    /** The `top` of FlashList's ScrollAnchor: 1_000_000 plus every correction applied so far. */
    const anchorTop = (view: any): number => {
        const anchors = view.container.queryAll((n: any) => {
            if (n.type !== 'View') return false;
            const s = StyleSheet.flatten(n.props.style) ?? {};
            return s.position === 'absolute' && s.height === 0 && typeof s.top === 'number' && s.top >= 1_000_000;
        });
        expect(anchors).toHaveLength(1);
        return StyleSheet.flatten(anchors[0].props.style).top as number;
    };

    const tree = () => (
        <OverlayProvider>
            <DatabaseViewer />
        </OverlayProvider>
    );

    /** Announce a write: the Timeline re-reads its window and commits the new rows. */
    const refresh = async (view: any, rows: ReturnType<typeof row>[]) => {
        mockDb.getAllAsync.mockResolvedValue(rows);
        await act(async () => {
            mockRefreshCount += 1;
            view.rerender(tree());
        });
    };

    /** Let frame-deferred work run (the pre-fix reveal waited a requestAnimationFrame). */
    const settle = () =>
        act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 50));
        });

    beforeEach(() => {
        mockRefreshCount = 0;
        scrollTo.mockClear();
        measure.measureParentSize.mockImplementation(() => ({ x: 0, y: 0, width: 400, height: 900 }));
        measure.measureFirstChildLayout.mockImplementation(() => ({ x: 0, y: 0, width: 400, height: 900 }));
        measure.measureItemLayout.mockImplementation(() => ({ x: 0, y: 0, width: 100, height: 100 }));
    });

    it("QA's case: anchored on the first entry, a new entry lands on the same day above it", async () => {
        // Fabric reports the list's origin in its parent (107dp under the search
        // bar) for FlashList 2.0.2's measureLayout(view, view), and that version
        // subtracts it (upstream #2105). So at the very top FlashList's first
        // visible row, its correction anchor, is the first ENTRY (y 100..200),
        // exactly as on the Pixel. (Also true of a user scrolled a header down.)
        measure.measureParentSize.mockImplementation(() => ({ x: 0, y: 107, width: 400, height: 900 }));
        const rows = [row(100, 0), row(99, 0), row(98, 1), row(97, 1)];
        mockDb.getAllAsync.mockResolvedValue(rows);
        const view = await render(tree());
        await waitFor(() => expect(view.queryByText('note-100')).not.toBeNull());
        await settle();
        const before = anchorTop(view);

        // Entry 101 is newer, on the same day: it lands between that day's
        // header and entry 100, i.e. above the anchor.
        const newer = { ...row(101, 0), date: new Date(2026, 5, 20, 13, 0, 0).toISOString() };
        await refresh(view, [newer, ...rows]);
        await waitFor(() => expect(view.queryByText('note-101')).not.toBeNull());
        await settle();

        // No correction was applied for that commit...
        expect(anchorTop(view)).toBe(before);
        // ...and the list was taken to its real top.
        expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ y: 0 }));
    });

    it('the first entry of a NEW day, at the very top, where the anchor is the previous day header', async () => {
        const rows = [row(100, 1), row(99, 1), row(98, 2), row(97, 2)];
        mockDb.getAllAsync.mockResolvedValue(rows);
        const view = await render(tree());
        await waitFor(() => expect(view.queryByText('note-100')).not.toBeNull());
        await settle();
        const before = anchorTop(view);

        // A new day's header and its entry land above the old top header.
        await refresh(view, [row(101, 0), ...rows]);
        await waitFor(() => expect(view.queryByText('note-101')).not.toBeNull());
        await settle();

        expect(anchorTop(view)).toBe(before);
        expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ y: 0 }));
    });

    it('a write that inserts nothing above the anchor neither corrects nor scrolls', async () => {
        const rows = [row(100, 0), row(99, 0), row(98, 1)];
        mockDb.getAllAsync.mockResolvedValue(rows);
        const view = await render(tree());
        await waitFor(() => expect(view.queryByText('note-100')).not.toBeNull());
        await settle();
        const before = anchorTop(view);

        // An entry on an OLDER day, below everything on screen.
        await refresh(view, [...rows, row(50, 5)]);
        await waitFor(() => expect(view.queryByText('note-50')).not.toBeNull());
        await settle();

        expect(anchorTop(view)).toBe(before);
        expect(scrollTo).not.toHaveBeenCalled();
    });
});
