/**
 * The Timeline must hand every entry card the SAME callback identities render after
 * render, so `React.memo(EntryCard)` can actually bail out.
 *
 * The other half of the third defect behind the 2026-09-13 Timeline scroll bug
 * (entryCardMemo.test.tsx proves the card bails on value-equal props; this proves
 * the props ARE value-equal). Each is useless alone: a future refactor that
 * re-introduces an inline `onEdit={() => handleEdit(entry)}` in `renderItem` leaves
 * the memo technically in place and silently restores the bug — every mounted card
 * re-rendering on every parent state change, three times per page append, while the
 * user is dragging the list. So this is asserted on the real DatabaseViewer by
 * recording what it passes down, never by reading the source.
 */
import React from 'react';
import { render, act, waitFor } from '@testing-library/react-native';

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

const ROWS = Array.from({ length: 40 }, (_, i) => ({
    id: i + 1,
    mood: 6,
    notes: `entry-${i + 1}`,
    // 5 per local day, so a page append also rebuilds several date sections.
    date: new Date(Date.UTC(2026, 8, 12) - Math.floor(i / 5) * 86_400_000).toISOString(),
    starred_at: null,
    activity_ids: null,
    activity_names: null,
    activity_group_ids: null,
    activity_icon_names: null,
    activity_icon_families: null,
}));

const mockDb = {
    getAllAsync: jest.fn(async (_sql: string, params: any[] = []) => {
        const limit = Number(params[params.length - 2]);
        const offset = Number(params[params.length - 1]);
        return ROWS.slice(offset, offset + limit);
    }),
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
        default: { View: (props: any) => ReactLocal.createElement(View, props) },
        FadeIn: anim,
        FadeInDown: anim,
        FadeOutDown: anim,
    };
});
jest.mock('@/hooks/useKeyboardHeight', () => ({ useKeyboardHeight: () => 0 }));
// The real hook returns a module-level constant per theme, which is WHY `colors` can
// be compared by identity; the mock keeps that property.
const mockTheme = {
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
jest.mock('@/styles/global', () => ({ useThemeColors: () => mockTheme }));
jest.mock('@/context/DataContext', () => ({
    useDataContext: () => ({ refetchEntries: jest.fn() }),
}));
jest.mock('@/context/dataRefreshStore', () => ({ useDataVersion: () => mockDataVersion }));
jest.mock('@/databases/entry-media', () => ({
    getMediaByEntryIds: jest.fn().mockResolvedValue({}),
}));
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

// Record every prop set a card is handed.
const mockHanded: any[] = [];
jest.mock('@/components/timeline/EntryCard', () => ({
    EntryCard: (props: any) => {
        mockHanded.push(props);
        return null;
    },
}));

import { OverlayProvider } from '@/context/OverlayHost';
import { DatabaseViewer } from '@/components/DBViewer';

const Timeline = () => (
    <OverlayProvider>
        <DatabaseViewer />
    </OverlayProvider>
);

/** The most recent props handed to the card for `id`. */
const latestFor = (id: number) => [...mockHanded].reverse().find((p) => p.entry.id === id);

beforeEach(() => {
    jest.clearAllMocks();
    mockHanded.length = 0;
    mockDataVersion = 0;
    mockDb.getAllAsync.mockImplementation(async (_sql: string, params: any[] = []) => {
        const limit = Number(params[params.length - 2]);
        const offset = Number(params[params.length - 1]);
        return ROWS.slice(offset, offset + limit);
    });
    mockDb.getFirstAsync.mockResolvedValue(null);
});

describe('Timeline — the props it hands each card are stable', () => {
    it('gives every card ONE shared set of callbacks (nothing allocated per row)', async () => {
        await render(<Timeline />);
        await waitFor(() => expect(mockHanded.length).toBeGreaterThan(1));

        const first = mockHanded[0];
        for (const props of mockHanded) {
            expect(props.onEdit).toBe(first.onEdit);
            expect(props.onDelete).toBe(first.onDelete);
            expect(props.onToggleStar).toBe(first.onToggleStar);
            expect(props.colors).toBe(first.colors);
        }
    });

    it('keeps them identical across a page append, and carries untouched rows by reference', async () => {
        const view = await render(<Timeline />);
        await waitFor(() => expect(mockHanded.length).toBeGreaterThan(0));

        const before = latestFor(1)!;
        const entryObjectBefore = before.entry;

        // The event that used to re-render every mounted card.
        const list = view.getByTestId('timeline-list');
        await act(async () => {
            list.props.onEndReached({ distanceFromEnd: 0 });
        });
        await waitFor(() => expect(mockDb.getAllAsync).toHaveBeenCalledTimes(2));

        const after = latestFor(1)!;
        expect(after.onEdit).toBe(before.onEdit);
        expect(after.onDelete).toBe(before.onDelete);
        expect(after.onToggleStar).toBe(before.onToggleStar);
        expect(after.colors).toBe(before.colors);
        // The regroup rebuilds SECTIONS, never the entries inside them — so memo's
        // shallow compare sees nothing changed for a row the append didn't touch.
        expect(after.entry).toBe(entryObjectBefore);
    });

    it('keeps them identical across a data-version refresh', async () => {
        const view = await render(<Timeline />);
        await waitFor(() => expect(mockHanded.length).toBeGreaterThan(0));
        const before = latestFor(1)!;

        await act(async () => {
            mockDataVersion = 1;
            view.rerender(<Timeline />);
        });
        await waitFor(() => expect(mockDb.getAllAsync.mock.calls.length).toBeGreaterThan(1));

        const after = latestFor(1)!;
        expect(after.onEdit).toBe(before.onEdit);
        expect(after.onDelete).toBe(before.onDelete);
        expect(after.onToggleStar).toBe(before.onToggleStar);
    });

    it('bounds the render window so the whole loaded list is not permanently mounted', async () => {
        // RN's default `windowSize` is 21 VIEWPORTS — for a few hundred entry cards
        // that exceeds the entire content, so nothing was ever unmounted and every
        // mounted card took part in every render pass. The exact number is a
        // judgement call; that it is BOUNDED, and well clear of the 2-viewport floor
        // that would make a fling land on unrendered space, is the contract.
        const view = await render(<Timeline />);
        await waitFor(() => expect(mockHanded.length).toBeGreaterThan(0));
        const list = view.getByTestId('timeline-list');
        expect(list.props.windowSize).toBeGreaterThanOrEqual(3);
        expect(list.props.windowSize).toBeLessThanOrEqual(10);
    });
});
