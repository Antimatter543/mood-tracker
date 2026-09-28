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
import { render, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

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
jest.mock('@/context/dataRefreshStore', () => ({ useDataVersion: () => 0 }));
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
