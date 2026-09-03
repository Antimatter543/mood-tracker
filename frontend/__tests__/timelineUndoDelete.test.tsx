/**
 * The Timeline's delete → UNDO flow, rendered end-to-end on the real
 * DatabaseViewer (mirrors dbViewerLoadError.test.tsx's harness).
 *
 * What matters here and can't be seen from the DB layer:
 *   1. deleting shows the undo snackbar (and calls the SOFT delete, not a purge),
 *   2. UNDO calls `restoreMoodEntry` and reloads, so the entry comes back at its
 *      correct DATE position rather than being spliced onto the end,
 *   3. a FAILED delete shows no snackbar (undoing something that never happened
 *      would restore an entry the user still has, or silently do nothing),
 *   4. the snackbar auto-dismisses,
 *   5. the bin button's badge reflects `getBinCount`,
 *   6. no react-native `<Modal>` is involved — the snackbar goes through the
 *      OverlayHost, which is a hard rule in this app.
 *
 * RNTL 14: `render` and `fireEvent` are ASYNC — every one is awaited. An
 * un-awaited `fireEvent.press` silently does nothing and reads as dead wiring.
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

jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 48, left: 0, right: 0 }),
}));

// The snackbar + overlay panel import reanimated (no worklets runtime in jest).
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

const mockRefetchEntries = jest.fn();
jest.mock('@/context/DataContext', () => ({
    useDataContext: () => ({ refetchEntries: mockRefetchEntries }),
}));
jest.mock('@/context/dataRefreshStore', () => ({
    useDataVersion: () => mockRefreshCount,
}));

jest.mock('@/databases/entry-media', () => ({
    getMediaByEntryIds: jest.fn().mockResolvedValue({}),
}));
jest.mock('@/databases/mediaHelpers', () => ({
    MEDIA_DIR: 'file:///media/',
    copyToMediaDir: jest.fn(),
    deleteMediaFile: jest.fn(),
}));
// OverlayModal's keyboard inset uses reanimated's worklet-backed
// useAnimatedKeyboard, which the mock above doesn't provide.
jest.mock('@/hooks/useKeyboardHeight', () => ({ useKeyboardHeight: () => 0 }));
jest.mock('@/components/forms/EntryForm', () => ({ EntryFormModal: () => null }));
jest.mock('@/components/EmptyState', () => ({ EmptyState: () => null }));

// The write layer: assert WHICH function the delete button reaches (a soft
// delete), and drive undo's success/failure.
const mockDeleteMoodEntry = jest.fn().mockResolvedValue({ success: true, message: 'ok' });
const mockRestoreMoodEntry = jest.fn().mockResolvedValue({ success: true, message: 'ok' });
const mockPurgeMoodEntry = jest.fn().mockResolvedValue({ success: true, message: 'ok' });
const mockGetBinCount = jest.fn().mockResolvedValue(0);
jest.mock('@/databases/entries', () => ({
    ...jest.requireActual('@/databases/entries'),
    deleteMoodEntry: (...args: unknown[]) => mockDeleteMoodEntry(...args),
    updateMoodEntry: jest.fn().mockResolvedValue({ success: true, message: 'ok' }),
    setEntryStarred: jest.fn().mockResolvedValue({ success: true, message: 'ok' }),
}));
jest.mock('@/databases/entry-bin', () => ({
    BIN_RETENTION_DAYS: 30,
    getBinCount: (...args: unknown[]) => mockGetBinCount(...args),
    getBinnedEntries: jest.fn().mockResolvedValue([]),
    restoreMoodEntry: (...args: unknown[]) => mockRestoreMoodEntry(...args),
    purgeMoodEntry: (...args: unknown[]) => mockPurgeMoodEntry(...args),
}));

import { Alert } from 'react-native';
import { OverlayProvider } from '@/context/OverlayHost';
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

/** The Timeline needs the OverlayProvider — that's where the snackbar mounts. */
const renderTimeline = () =>
    render(
        <OverlayProvider>
            <DatabaseViewer />
        </OverlayProvider>
    );

beforeEach(() => {
    jest.clearAllMocks();
    mockRefreshCount = 0;
    mockDb.getFirstAsync.mockResolvedValue(null);
    mockGetBinCount.mockResolvedValue(0);
    mockDeleteMoodEntry.mockResolvedValue({ success: true, message: 'ok' });
    mockRestoreMoodEntry.mockResolvedValue({ success: true, message: 'ok' });
    mockDb.getAllAsync.mockResolvedValue([entryRow(1, 'delete-me')]);
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => {
    jest.useRealTimers();
});

describe('Timeline delete → undo', () => {
    it('deleting an entry calls the SOFT delete and raises the undo snackbar', async () => {
        const view = await renderTimeline();
        await waitFor(() => expect(view.queryByText('delete-me')).not.toBeNull());
        expect(view.queryByTestId('undo-snackbar')).toBeNull();

        await act(async () => {
            await fireEvent.press(view.getByLabelText('Delete entry'));
        });

        // The soft delete, NOT purgeMoodEntry — a stray tap must never destroy
        // photos on disk.
        expect(mockDeleteMoodEntry).toHaveBeenCalledWith(mockDb, 1);
        expect(mockPurgeMoodEntry).not.toHaveBeenCalled();

        await waitFor(() => expect(view.queryByTestId('undo-snackbar')).not.toBeNull());
        expect(view.queryByText('Entry moved to the bin')).not.toBeNull();
        // The row left the list even though the row still exists in the DB.
        expect(view.queryByText('delete-me')).toBeNull();
    });

    it('UNDO restores the entry and reloads the page (so it lands back in date order)', async () => {
        const view = await renderTimeline();
        await waitFor(() => expect(view.queryByText('delete-me')).not.toBeNull());
        const readsBeforeDelete = mockDb.getAllAsync.mock.calls.length;

        await act(async () => {
            await fireEvent.press(view.getByLabelText('Delete entry'));
        });
        await waitFor(() => expect(view.queryByTestId('undo-snackbar')).not.toBeNull());

        await act(async () => {
            await fireEvent.press(view.getByTestId('undo-snackbar-action'));
        });

        expect(mockRestoreMoodEntry).toHaveBeenCalledWith(mockDb, 1);
        // A RELOAD, not a local splice: the entry belongs at its date position,
        // which only a re-read of the page can place correctly.
        await waitFor(() =>
            expect(mockDb.getAllAsync.mock.calls.length).toBeGreaterThan(readsBeforeDelete)
        );
        await waitFor(() => expect(view.queryByText('delete-me')).not.toBeNull());
        // …and the snackbar goes away once used.
        expect(view.queryByTestId('undo-snackbar')).toBeNull();
    });

    it('a FAILED delete keeps the row and raises NO snackbar', async () => {
        mockDeleteMoodEntry.mockResolvedValue({ success: false, message: 'nope' });
        const view = await renderTimeline();
        await waitFor(() => expect(view.queryByText('delete-me')).not.toBeNull());

        await act(async () => {
            await fireEvent.press(view.getByLabelText('Delete entry'));
        });

        // Offering "Undo" for a delete that never happened would either restore
        // an entry the user still has or silently do nothing — both confusing.
        expect(view.queryByTestId('undo-snackbar')).toBeNull();
        expect(view.queryByText('delete-me')).not.toBeNull();
        expect(Alert.alert).toHaveBeenCalled();
    });

    it('a FAILED undo alerts and leaves the snackbar dismissed', async () => {
        mockRestoreMoodEntry.mockResolvedValue({ success: false, message: 'nope' });
        const view = await renderTimeline();
        await waitFor(() => expect(view.queryByText('delete-me')).not.toBeNull());

        await act(async () => {
            await fireEvent.press(view.getByLabelText('Delete entry'));
        });
        await waitFor(() => expect(view.queryByTestId('undo-snackbar')).not.toBeNull());
        await act(async () => {
            await fireEvent.press(view.getByTestId('undo-snackbar-action'));
        });

        expect(Alert.alert).toHaveBeenCalledWith("Couldn't restore entry", 'nope');
        expect(view.queryByTestId('undo-snackbar')).toBeNull();
    });

    it('the snackbar auto-dismisses after its timeout', async () => {
        jest.useFakeTimers();
        const view = await renderTimeline();
        await act(async () => {
            jest.advanceTimersByTime(500);
        });
        await act(async () => {
            await fireEvent.press(view.getByLabelText('Delete entry'));
        });
        expect(view.queryByTestId('undo-snackbar')).not.toBeNull();

        await act(async () => {
            jest.advanceTimersByTime(6001);
        });

        expect(view.queryByTestId('undo-snackbar')).toBeNull();
    });
});

describe('Timeline list scroll anchoring', () => {
    // REGRESSION (device QA 2026-09-03). The SectionList carried
    // `maintainVisibleContentPosition={{ minIndexForVisible: 0 }}` from the
    // initial release. It pins the scroll offset to the VIEW of the first
    // visible row, so any layout pass that pushes that row down is compensated
    // for by scrolling down the same amount. This list is date-DESC: every
    // insert the user cares about (a new entry, an undone delete, a bin
    // restore) lands at the TOP and pushes that row down — so the list silently
    // scrolled the new row off the top of the viewport. It read as "restoring
    // corrupts the entry" (only the trailing note line showed under the sticky
    // date header — no mood, no time, no activity chips) and as "new entries
    // don't appear until you pull to refresh".
    //
    // Layout is not simulated in jest, so the observable contract is the prop
    // itself: this list must not anchor its scroll position. `loadMoreData`
    // APPENDS, so pagination never needed it.
    //
    // SectionList forwards `maintainVisibleContentPosition` all the way down to
    // its host RCTScrollView, so reading it off the `timeline-list` testID node
    // is a REAL assertion: it reads back `{ minIndexForVisible: 0 }` when the
    // prop is set and `undefined` when it isn't (verified against RNTL 14 before
    // this was written — a vacuous "always undefined" assertion would be worse
    // than no test).
    it('does NOT anchor scroll position (a prepended entry must stay visible)', async () => {
        const view = await renderTimeline();
        await waitFor(() => expect(view.queryByText('delete-me')).not.toBeNull());

        const list = view.getByTestId('timeline-list');
        expect(list.props.maintainVisibleContentPosition).toBeUndefined();
    });

    it('an entry restored to the TOP of the list is rendered first', async () => {
        // The undo reload returns the restored entry as the NEWEST row — the
        // exact position the scroll anchor used to hide.
        const view = await renderTimeline();
        await waitFor(() => expect(view.queryByText('delete-me')).not.toBeNull());

        await act(async () => {
            await fireEvent.press(view.getByLabelText('Delete entry'));
        });
        await waitFor(() => expect(view.queryByTestId('undo-snackbar')).not.toBeNull());

        mockDb.getAllAsync.mockResolvedValue([
            { ...entryRow(1, 'delete-me'), date: '2026-06-14T10:00:00.000Z' },
            entryRow(2, 'older sibling'),
        ]);
        await act(async () => {
            await fireEvent.press(view.getByTestId('undo-snackbar-action'));
        });

        await waitFor(() => expect(view.queryByText('delete-me')).not.toBeNull());
        // …and it is the FIRST row in document order, i.e. exactly the position
        // the scroll anchor used to park above the viewport.
        const rendered = view.container
            .queryAll((node) => node.type === 'Text')
            .map((node) => node.props.children);
        expect(rendered.indexOf('delete-me')).toBeGreaterThanOrEqual(0);
        expect(rendered.indexOf('delete-me')).toBeLessThan(rendered.indexOf('older sibling'));
    });
});

describe('Timeline bin button', () => {
    it('shows no badge when the bin is empty', async () => {
        const view = await renderTimeline();
        await waitFor(() => expect(view.queryByTestId('timeline-open-bin')).not.toBeNull());
        // Plain label, no count: an empty bin stays visually quiet.
        expect(view.queryByLabelText('Recently deleted')).not.toBeNull();
    });

    it('shows the count badge when the bin is not empty', async () => {
        mockGetBinCount.mockResolvedValue(3);
        const view = await renderTimeline();
        await waitFor(() =>
            expect(view.queryByLabelText('Recently deleted, 3 entries')).not.toBeNull()
        );
        expect(view.queryByText('3')).not.toBeNull();
    });

    it('singularises the badge label for one binned entry', async () => {
        mockGetBinCount.mockResolvedValue(1);
        const view = await renderTimeline();
        await waitFor(() =>
            expect(view.queryByLabelText('Recently deleted, 1 entry')).not.toBeNull()
        );
    });

    it('opens the Recently deleted panel through the overlay host (no native Modal)', async () => {
        const view = await renderTimeline();
        await waitFor(() => expect(view.queryByTestId('timeline-open-bin')).not.toBeNull());

        await act(async () => {
            await fireEvent.press(view.getByTestId('timeline-open-bin'));
        });

        await waitFor(() => expect(view.queryByTestId('bin-empty')).not.toBeNull());
        expect(view.queryByText('Recently deleted')).not.toBeNull();
        // The app bans react-native <Modal> (dead touch dispatch on Fabric) —
        // the panel must render in-tree, so no Modal host node may exist.
        expect(view.container.queryAll((n) => n.type === 'Modal')).toHaveLength(0);
    });
});
