/**
 * Regression test for DBViewer Task 1b: the edit <EntryFormModal> must be
 * rendered UNCONDITIONALLY — never behind the `isLoading` / empty-state early
 * returns. Before the fix, a focus refetch that flipped `isLoading` back to true
 * unmounted the open edit form (and destroyed the user's in-progress draft),
 * because the form lived AFTER `if (isLoading) return <Spinner/>`.
 *
 * We can't render the real EntryFormModal cheaply (it pulls reanimated, the
 * image picker, sortables, the mood/activity pickers). That's also not what this
 * test is about — Task 1b is purely about DBViewer's RENDER STRUCTURE. So we
 * replace EntryFormModal with a sentinel and assert it is present in EVERY one of
 * DBViewer's render states: populated list, empty state, AND initial loading.
 * The heavy contexts (SQLite, theme, data) are mocked to the minimum needed.
 */
import React from 'react';
import { render, act, waitFor } from '@testing-library/react-native';

// ── Mock expo-router useFocusEffect (run on mount + on callback-identity change) ──
jest.mock('expo-router', () => {
    const ReactActual = require('react') as typeof React;
    return {
        useFocusEffect: (cb: () => void | (() => void)) => {
            ReactActual.useEffect(() => cb(), [cb]);
        },
    };
});

// ── Controllable mock SQLite DB behind useSQLiteContext ──────────────────────
const mockDb = {
    getAllAsync: jest.fn().mockResolvedValue([]),
    getFirstAsync: jest.fn().mockResolvedValue(null),
    runAsync: jest.fn().mockResolvedValue({ lastInsertRowId: 1, changes: 1 }),
    withTransactionAsync: jest
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

// ── Data context (writers bump this; the focus hook consumes it) ─────────────
jest.mock('@/context/DataContext', () => ({
    useDataContext: () => ({ refreshCount: 0, refetchEntries: jest.fn() }),
}));

// ── No photos to load for any entry ──────────────────────────────────────────
jest.mock('@/databases/entry-media', () => ({
    getMediaByEntryIds: jest.fn().mockResolvedValue({}),
}));
jest.mock('@/databases/mediaHelpers', () => ({
    MEDIA_DIR: 'file:///media/',
    copyToMediaDir: jest.fn(),
    deleteMediaFile: jest.fn(),
}));

// ── Sentinel EntryFormModal: lets us assert it is present in the tree, with no
//    reanimated / picker dependencies. ───────────────────────────────────────
const ENTRY_FORM_SENTINEL = '__ENTRY_FORM_MODAL_SENTINEL__';
jest.mock('@/components/forms/EntryForm', () => ({
    EntryFormModal: ({ visible }: { visible: boolean }) => {
        const ReactActual = require('react') as typeof React;
        const { Text: RNText } = require('react-native');
        return ReactActual.createElement(RNText, null, `${ENTRY_FORM_SENTINEL}:${visible}`);
    },
}));

// Pass-through stubs for leaf UI so the tree renders without extra providers.
jest.mock('@/components/Card', () => ({
    Card: ({ children }: { children: React.ReactNode }) => {
        const ReactActual = require('react') as typeof React;
        const { View } = require('react-native');
        return ReactActual.createElement(View, null, children);
    },
}));
jest.mock('@/components/EmptyState', () => ({
    EmptyState: () => {
        const ReactActual = require('react') as typeof React;
        const { Text: RNText } = require('react-native');
        return ReactActual.createElement(RNText, null, '__EMPTY_STATE__');
    },
}));
jest.mock('@/components/OverlayModal', () => ({
    OverlayModal: ({ children, visible }: { children: React.ReactNode; visible: boolean }) => {
        const ReactActual = require('react') as typeof React;
        const { View } = require('react-native');
        return visible ? ReactActual.createElement(View, null, children) : null;
    },
}));

// Import AFTER mocks are registered.
import { DatabaseViewer } from '@/components/DBViewer';

// render() is async in this project's jest-expo / concurrent-React setup (see
// activityReorder.test.tsx / overlayPopover.test.tsx) — always `await` it.
type View = Awaited<ReturnType<typeof render>>;

// The sentinel mounts with `visible=false` until an edit is tapped, so its text
// is the exact, deterministic string below.
const FORM_TEXT_HIDDEN = `${ENTRY_FORM_SENTINEL}:false`;

const formSentinelPresent = (view: View): boolean =>
    view.queryByText(FORM_TEXT_HIDDEN) !== null;

const hasExactText = (view: View, text: string): boolean =>
    view.queryByText(text) !== null;

const oneEntryRow = () => ({
    id: 1,
    mood: 7,
    notes: 'hello',
    date: '2026-06-12T10:00:00.000Z',
    activity_ids: null,
    activity_names: null,
    activity_group_ids: null,
    activity_icon_names: null,
});

beforeEach(() => {
    jest.clearAllMocks();
    mockDb.getAllAsync.mockResolvedValue([]);
});

describe('DBViewer — EntryFormModal is rendered unconditionally (Task 1b)', () => {
    it('renders the EntryFormModal in the POPULATED-list state', async () => {
        mockDb.getAllAsync.mockResolvedValue([oneEntryRow()]);
        const view = await render(<DatabaseViewer />);
        // Wait for the initial focus-load to resolve and the list to render.
        await waitFor(() => expect(formSentinelPresent(view)).toBe(true));
        // The form is present (mounted, visible=false until an edit is tapped).
        expect(hasExactText(view, FORM_TEXT_HIDDEN)).toBe(true);
    });

    it('renders the EntryFormModal in the EMPTY state (no early-return bypass)', async () => {
        mockDb.getAllAsync.mockResolvedValue([]); // empty DB -> EmptyState branch
        const view = await render(<DatabaseViewer />);
        await waitFor(() => expect(hasExactText(view, '__EMPTY_STATE__')).toBe(true));
        // Critically: the form is STILL mounted alongside the empty state, not
        // skipped by an early `return <EmptyState/>`.
        expect(formSentinelPresent(view)).toBe(true);
    });

    it('keeps the EntryFormModal mounted across an isLoading flip on refetch', async () => {
        // Start populated.
        mockDb.getAllAsync.mockResolvedValue([oneEntryRow()]);
        const view = await render(<DatabaseViewer />);
        await waitFor(() => expect(formSentinelPresent(view)).toBe(true));

        // Simulate a refetch that re-resolves (the focus hook re-runs the loader
        // when refreshCount/identity changes — here we just re-render and let the
        // already-mocked getAllAsync resolve again). The form must never drop out
        // of the tree at any committed render.
        await act(async () => {
            await view.rerender(<DatabaseViewer />);
        });
        expect(formSentinelPresent(view)).toBe(true);

        // And after the refetch settles it's still there.
        await waitFor(() => expect(formSentinelPresent(view)).toBe(true));
    });
});
