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
import { render, act, waitFor, fireEvent, within } from '@testing-library/react-native';

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

import { Alert, StyleSheet } from 'react-native';
import { OverlayProvider } from '@/context/OverlayHost';
import { UNDO_SNACKBAR_DURATION_MS } from '@/components/UndoSnackbar';
import { DatabaseViewer } from '@/components/DBViewer';

// The FlashList stand-in's imperative ref (see __mocks__/@shopify/flash-list.tsx).
// A plain require, NOT jest.requireMock: requireMock hands back a SEPARATE
// instance of a root-__mocks__ module, so scripting its jest.fns would never
// reach the copy DBViewer imported.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { flashListProbe } = require('@shopify/flash-list') as {
    flashListProbe: {
        scrollToOffset: jest.Mock;
        scrollToIndex: jest.Mock;
        getFirstVisibleIndex: jest.Mock;
        reset: () => void;
    };
};

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

/**
 * Delete is one step behind "More actions" on the redesigned card (2026-09-28):
 * the trash can no longer sits on every card. Open the strip, then delete.
 * NOT wrapped in an outer `act`: RNTL 14's async fireEvent acts itself, and an
 * outer act would batch the strip's open state until AFTER the second query.
 */
const pressDelete = async (view: any, id = 1) => {
    const card = within(view.getByTestId(`entry-${id}`));
    await fireEvent.press(card.getByLabelText('More actions'));
    await fireEvent.press(card.getByLabelText('Delete entry'));
};

beforeEach(() => {
    jest.clearAllMocks();
    flashListProbe.reset();
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

        await pressDelete(view);

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

        await pressDelete(view);
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

        await pressDelete(view);

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

        await pressDelete(view);
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
        await pressDelete(view);
        expect(view.queryByTestId('undo-snackbar')).not.toBeNull();

        // Drive the REAL window, never a copy of the number — re-hardcoding it
        // here is what made this test fail the moment the window was widened
        // from 6s to 8s, for no behavioural reason. (The window's own bounds are
        // asserted in undoSnackbar.test.tsx; this test only cares THAT it ends.)
        await act(async () => {
            jest.advanceTimersByTime(UNDO_SNACKBAR_DURATION_MS + 1);
        });

        expect(view.queryByTestId('undo-snackbar')).toBeNull();
    });
});

describe('Timeline list scroll anchoring', () => {
    // HISTORY. The old SectionList carried
    // `maintainVisibleContentPosition={{ minIndexForVisible: 0 }}` from the
    // initial release and it hid every insertion at the top (device QA
    // 2026-09-03: a restored entry read as "corrupted" because only its last
    // note line peeked out under the sticky header; new entries "only appeared
    // after a pull-to-refresh"). The prop was removed, which is what let the
    // FLING bug of 2026-09-28 through: with nothing compensating, rows above the
    // viewport that re-measured moved the user's content ("teleports me to a
    // more recent date").
    //
    // THE CONTRACT NOW (FlashList v2): content-position maintenance stays ON
    // (FlashList's default: we must not disable it, and must not set the native
    // `autoscrollToTopThreshold`, which fires on ANY anchor correction), and the
    // refresh path itself scrolls to the top when it inserted rows ABOVE the
    // first visible row while the user was near the top. Layout is not
    // simulated in jest, so the scripted inputs are the probe's
    // `getFirstVisibleIndex()` and the list's own onScroll/onLayout; the
    // observable output is the `scrollToIndex` call, and WHEN it happens
    // relative to the data commit.
    //
    // The reveal is `scrollToIndex`, issued BEFORE the inserting rows reach the
    // list (device QA 2026-09-28): scrollToIndex pauses FlashList's own offset
    // correction, while a `scrollToOffset` after the commit is a native view
    // command that Android runs BEFORE the mount carrying that correction, so
    // the correction won and hid the new row. The real-list half of this
    // contract is in timelineRealFlashList.test.tsx.

    const restoreAtTop = async (view: any) => {
        await pressDelete(view);
        await waitFor(() => expect(view.queryByTestId('undo-snackbar')).not.toBeNull());
        // The undo reload returns the restored entry as the NEWEST row, on a
        // day of its own, above the day the user was looking at.
        mockDb.getAllAsync.mockResolvedValue([
            { ...entryRow(1, 'delete-me'), date: '2026-06-14T10:00:00.000Z' },
            entryRow(2, 'older sibling'),
        ]);
        await act(async () => {
            await fireEvent.press(view.getByTestId('undo-snackbar-action'));
        });
        await waitFor(() => expect(view.queryByText('delete-me')).not.toBeNull());
    };

    const scrollTo = async (view: any, y: number, viewport = 800) => {
        const list = view.getByTestId('timeline-list');
        await act(async () => {
            list.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 400, height: viewport } } });
            list.props.onScroll({
                nativeEvent: {
                    contentOffset: { x: 0, y },
                    layoutMeasurement: { width: 400, height: viewport },
                    contentSize: { width: 400, height: 50_000 },
                },
            });
        });
    };

    it('keeps FlashList content-position maintenance ON, with no native autoscroll threshold', async () => {
        mockDb.getAllAsync.mockResolvedValue([entryRow(1, 'delete-me'), entryRow(2, 'older sibling')]);
        const view = await renderTimeline();
        await waitFor(() => expect(view.queryByText('delete-me')).not.toBeNull());

        const mvcp = view.getByTestId('timeline-list').props.maintainVisibleContentPosition;
        // Undefined = FlashList v2's default, which is ENABLED. Anything passed
        // must neither disable it nor add the threshold that teleports users.
        expect(mvcp?.disabled).not.toBe(true);
        expect(mvcp?.autoscrollToTopThreshold).toBeUndefined();
    });

    it('renders the list ALONE in its own frame, so FlashList 2.0.2 measures its offset from 0', async () => {
        // FlashList 2.0.2 subtracts the list's origin IN ITS PARENT (what Fabric
        // reports for measureLayout(view, view)) from its first-item offset
        // (upstream #2105, fixed in 2.2.3). Sharing a parent with the search bar
        // made every visible-index FlashList computed ~107dp too deep: at the top
        // it anchored its correction on the first ENTRY, so a new entry above it
        // was pushed off-screen (device QA 2026-09-28). Jest has no layout, so
        // this pins the structure that makes the arithmetic right on a device:
        // the list is the frame's only child, hence at y=0 inside it.
        mockDb.getAllAsync.mockResolvedValue([entryRow(1, 'delete-me'), entryRow(2, 'older sibling')]);
        const view = await renderTimeline();
        await waitFor(() => expect(view.queryByText('delete-me')).not.toBeNull());

        const frame = view.getByTestId('timeline-list-frame');
        expect(frame.children).toHaveLength(1);
        expect(frame.children[0]).toBe(view.getByTestId('timeline-list'));
        const style = StyleSheet.flatten(frame.props.style);
        expect(style.flex).toBe(1);
        // Nothing that would move the list off the frame's origin.
        for (const key of ['padding', 'paddingTop', 'paddingVertical', 'borderWidth', 'borderTopWidth'] as const) {
            expect(style[key] ?? 0).toBe(0);
        }
    });

    it('an entry restored ABOVE the first visible row, near the top, is scrolled into view', async () => {
        mockDb.getAllAsync.mockResolvedValue([entryRow(1, 'delete-me'), entryRow(2, 'older sibling')]);
        const view = await renderTimeline();
        await waitFor(() => expect(view.queryByText('delete-me')).not.toBeNull());
        // The user is at the very top: the first visible row is the day header.
        flashListProbe.getFirstVisibleIndex.mockReturnValue(0);
        await scrollTo(view, 0);

        // Record what the LIST held at the moment the reveal was issued.
        let keysAtReveal: string[] | null = null;
        flashListProbe.scrollToIndex.mockImplementation(() => {
            keysAtReveal = view.getByTestId('timeline-list').props.data.map((r: { key: string }) => r.key);
            return Promise.resolve();
        });

        await restoreAtTop(view);

        await waitFor(() =>
            // viewOffset cancels the first-item offset (content padding), so the
            // list lands at 0, not 4px down.
            expect(flashListProbe.scrollToIndex).toHaveBeenCalledWith({ index: 0, animated: true, viewOffset: -4 })
        );
        expect(flashListProbe.scrollToIndex).toHaveBeenCalledTimes(1);
        // Issued BEFORE the restored row was committed: the list still held the
        // post-delete rows, so FlashList's correction is paused for the commit
        // that brings entry 1 back.
        expect(keysAtReveal).not.toBeNull();
        expect(keysAtReveal).not.toContain('entry:1');
        expect(view.getByTestId('timeline-list').props.data.map((r: { key: string }) => r.key)).toContain('entry:1');
        // The racy form is gone for good.
        expect(flashListProbe.scrollToOffset).not.toHaveBeenCalled();
        // …and it is the FIRST row in document order.
        const rendered = view.container
            .queryAll((node) => node.type === 'Text')
            .map((node) => node.props.children);
        expect(rendered.indexOf('delete-me')).toBeGreaterThanOrEqual(0);
        expect(rendered.indexOf('delete-me')).toBeLessThan(rendered.indexOf('older sibling'));
    });

    it('a user deep in their history keeps their place (no reveal)', async () => {
        mockDb.getAllAsync.mockResolvedValue([entryRow(1, 'delete-me'), entryRow(2, 'older sibling')]);
        const view = await renderTimeline();
        await waitFor(() => expect(view.queryByText('delete-me')).not.toBeNull());
        flashListProbe.getFirstVisibleIndex.mockReturnValue(1);
        await scrollTo(view, 5_000); // six viewports down

        await restoreAtTop(view);

        // Give a pending frame every chance to fire before asserting silence.
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 50));
        });
        expect(flashListProbe.scrollToIndex).not.toHaveBeenCalled();
        expect(flashListProbe.scrollToOffset).not.toHaveBeenCalled();
    });

    it('an entry added to the day ALREADY at the top does not scroll (it is visible in place)', async () => {
        mockDb.getAllAsync.mockResolvedValue([entryRow(2, 'older sibling')]);
        const view = await renderTimeline();
        await waitFor(() => expect(view.queryByText('older sibling')).not.toBeNull());
        flashListProbe.getFirstVisibleIndex.mockReturnValue(0); // that day's header
        await scrollTo(view, 0);

        // A new entry lands on the SAME day, below its header: the header the
        // user sees does not move, so there is nothing to reveal.
        mockDb.getAllAsync.mockResolvedValue([
            { ...entryRow(3, 'brand new'), date: '2026-06-12T11:00:00.000Z' },
            entryRow(2, 'older sibling'),
        ]);
        await act(async () => {
            mockRefreshCount += 1;
            view.rerender(
                <OverlayProvider>
                    <DatabaseViewer />
                </OverlayProvider>
            );
        });
        await waitFor(() => expect(view.queryByText('brand new')).not.toBeNull());
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 50));
        });
        expect(flashListProbe.scrollToIndex).not.toHaveBeenCalled();
        expect(flashListProbe.scrollToOffset).not.toHaveBeenCalled();
    });
});

describe('Timeline back-to-top pill', () => {
    const scrollTo = async (view: any, y: number, viewport = 800) => {
        const list = view.getByTestId('timeline-list');
        await act(async () => {
            list.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 400, height: viewport } } });
            list.props.onScroll({
                nativeEvent: {
                    contentOffset: { x: 0, y },
                    layoutMeasurement: { width: 400, height: viewport },
                    contentSize: { width: 400, height: 50_000 },
                },
            });
        });
    };

    it('appears once the user is several screens deep, and takes them to the top', async () => {
        mockDb.getAllAsync.mockResolvedValue([entryRow(1, 'delete-me'), entryRow(2, 'older sibling')]);
        const view = await renderTimeline();
        await waitFor(() => expect(view.queryByText('delete-me')).not.toBeNull());
        expect(view.queryByLabelText('Back to top')).toBeNull();

        await scrollTo(view, 1_000);
        expect(view.queryByLabelText('Back to top')).toBeNull();

        await scrollTo(view, 4_000);
        expect(view.queryByLabelText('Back to top')).not.toBeNull();

        await fireEvent.press(view.getByLabelText('Back to top'));
        expect(flashListProbe.scrollToOffset).toHaveBeenCalledWith({ offset: 0, animated: true });

        // Scrolling back up hides it again.
        await scrollTo(view, 100);
        expect(view.queryByLabelText('Back to top')).toBeNull();
    });

    it('steps aside while the undo snackbar is up (they share the bottom edge)', async () => {
        mockDb.getAllAsync.mockResolvedValue([entryRow(1, 'delete-me'), entryRow(2, 'older sibling')]);
        const view = await renderTimeline();
        await waitFor(() => expect(view.queryByText('delete-me')).not.toBeNull());
        await scrollTo(view, 4_000);
        expect(view.queryByLabelText('Back to top')).not.toBeNull();

        await pressDelete(view);
        await waitFor(() => expect(view.queryByTestId('undo-snackbar')).not.toBeNull());
        expect(view.queryByLabelText('Back to top')).toBeNull();
    });
});

describe('Timeline filter change', () => {
    it('starts the freshly-filtered list at the top', async () => {
        mockDb.getAllAsync.mockResolvedValue([entryRow(1, 'delete-me'), entryRow(2, 'older sibling')]);
        const view = await renderTimeline();
        await waitFor(() => expect(view.queryByText('delete-me')).not.toBeNull());
        flashListProbe.scrollToIndex.mockClear();

        await fireEvent.press(view.getByTestId('mood-filter-low'));
        // Same ordering rule as the reveal: if an entry the user was anchored
        // on survives the filter, FlashList would otherwise "correct" to it and
        // win against a scroll issued after the commit.
        await waitFor(() =>
            expect(flashListProbe.scrollToIndex).toHaveBeenCalledWith({ index: 0, animated: false, viewOffset: -4 })
        );
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
