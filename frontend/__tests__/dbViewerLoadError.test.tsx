/**
 * DBViewer load-ERROR surfacing (the "Timeline shows nothing at all" report).
 *
 * getEntriesPage now THROWS on a read failure instead of swallowing it and
 * returning [] — the old behaviour blanked a full DB into the EmptyState ("add
 * your first entry"). DBViewer must instead:
 *   1. with NO sections on screen → show an inline "Couldn't load" + Try again,
 *      NEVER the EmptyState;
 *   2. with existing sections → KEEP them (a transient refetch failure must not
 *      blank the list);
 *   3. Try again re-runs the loader and recovers.
 *
 * Render-level test on the real DatabaseViewer (mirrors dbViewerLoadRace.test.tsx).
 */
import React from 'react';
import { render, act, waitFor, fireEvent } from '@testing-library/react-native';

let mockRefreshCount = 0;
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
jest.mock('expo-sqlite', () => ({
    useSQLiteContext: () => mockDb,
}));

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

jest.mock('@/context/DataContext', () => ({
    useDataContext: () => ({
        refetchEntries: jest.fn(),
    }),
}));

// The reload signal is the external data-version store (useDataRefresh reads
// useDataVersion). The test mutates `mockRefreshCount` to fire a refetch, so
// wire the store's version to that same variable.
jest.mock('@/context/dataRefreshStore', () => ({
    useDataVersion: () => mockRefreshCount,
}));

// getEntriesPage batch-loads photos via getMediaByEntryIds; keep it empty.
jest.mock('@/databases/entry-media', () => ({
    getMediaByEntryIds: jest.fn().mockResolvedValue({}),
}));
jest.mock('@/databases/mediaHelpers', () => ({
    MEDIA_DIR: 'file:///media/',
    copyToMediaDir: jest.fn(),
    deleteMediaFile: jest.fn(),
}));

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
jest.mock('@/components/timeline/EntryCard', () => ({
    EntryCard: ({ entry }: { entry: { notes: string } }) => {
        const ReactActual = require('react') as typeof React;
        const { Text: RNText } = require('react-native');
        return ReactActual.createElement(RNText, null, entry.notes);
    },
}));

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

beforeEach(() => {
    jest.clearAllMocks();
    mockRefreshCount = 0;
    mockDb.getFirstAsync.mockResolvedValue(null);
});

describe('DBViewer — a read failure surfaces an error, never the EmptyState', () => {
    it('shows an inline error + Try again (NOT EmptyState) when the initial load fails with nothing on screen', async () => {
        mockDb.getAllAsync.mockRejectedValue(new Error('read failed'));

        const view = await render(<DatabaseViewer />);

        await waitFor(() =>
            expect(view.queryByText("Couldn't load your entries")).not.toBeNull()
        );
        expect(view.queryByTestId('timeline-retry')).not.toBeNull();
        // Critically NOT the "add your first entry" empty state over a failed read.
        expect(view.queryByText(EMPTY_STATE_TEXT)).toBeNull();
    });

    it('KEEPS the existing list when a later refetch fails (no blank)', async () => {
        // Mount succeeds with one entry.
        mockDb.getAllAsync.mockResolvedValueOnce([entryRow(1, 'kept-entry')]);
        // Every later load fails.
        mockDb.getAllAsync.mockRejectedValue(new Error('refetch failed'));

        const view = await render(<DatabaseViewer />);
        await waitFor(() => expect(view.queryByText('kept-entry')).not.toBeNull());

        // Bump refreshCount → the focus loader re-runs and rejects.
        await act(async () => {
            mockRefreshCount = 1;
            view.rerender(<DatabaseViewer />);
        });
        await waitFor(() => expect(mockDb.getAllAsync.mock.calls.length).toBeGreaterThan(1));

        // The list is kept — no blank, no error UI over an already-populated list.
        expect(view.queryByText('kept-entry')).not.toBeNull();
        expect(view.queryByText(EMPTY_STATE_TEXT)).toBeNull();
        expect(view.queryByText("Couldn't load your entries")).toBeNull();
    });

    it('recovers when Try again succeeds', async () => {
        mockDb.getAllAsync.mockRejectedValueOnce(new Error('read failed'));

        const view = await render(<DatabaseViewer />);
        await waitFor(() =>
            expect(view.queryByText("Couldn't load your entries")).not.toBeNull()
        );

        // The retry load succeeds.
        mockDb.getAllAsync.mockResolvedValue([entryRow(2, 'recovered-entry')]);
        await act(async () => {
            fireEvent.press(view.getByTestId('timeline-retry'));
        });

        await waitFor(() => expect(view.queryByText('recovered-entry')).not.toBeNull());
        expect(view.queryByText("Couldn't load your entries")).toBeNull();
        expect(view.queryByText(EMPTY_STATE_TEXT)).toBeNull();
    });
});
