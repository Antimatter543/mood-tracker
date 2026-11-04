/**
 * The "Recently deleted" panel — the bin's own surface.
 *
 * Guards the behaviour a DB-layer test can't see:
 *   - binned rows render with the deleted-N-days-ago / M-days-left context,
 *   - Restore calls `restoreMoodEntry`, reloads, and notifies the Timeline,
 *   - "Delete forever" CONFIRMS first and only purges on confirm (it takes the
 *     photos off disk — an unconfirmed tap would be unrecoverable),
 *   - a failed read shows a retry, NOT the reassuring "Nothing here" over a bin
 *     that still holds the user's entries,
 *   - the panel renders in-tree (no react-native <Modal>, a hard rule here).
 *
 * RNTL 14: `render`/`fireEvent` are async — every one is awaited.
 */
import React from 'react';
import { render, act, waitFor, fireEvent } from '@testing-library/react-native';

let mockDb: MockDb;
jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => mockDb }));

jest.mock('@/styles/global', () => require('@/testing/theme').mockThemeModule());

const mockGetBinnedEntries = jest.fn();
const mockRestoreMoodEntry = jest.fn();
const mockPurgeMoodEntry = jest.fn();
jest.mock('@/databases/entry-bin', () => ({
    BIN_RETENTION_DAYS: 30,
    getBinnedEntries: (...args: unknown[]) => mockGetBinnedEntries(...args),
    restoreMoodEntry: (...args: unknown[]) => mockRestoreMoodEntry(...args),
    purgeMoodEntry: (...args: unknown[]) => mockPurgeMoodEntry(...args),
}));

import { Alert } from 'react-native';
import { makeDb, resetWriteLayer, type MockDb } from '@/testing/fakeDb';
import { setInsets, INSETS } from '@/testing/platform';
import { freezeNow } from '@/testing/clock';
import { FIXED_NOW } from '@/testing/builders';
import { OverlayProvider } from '@/context/OverlayHost';
import { RecentlyDeletedPanel } from '@/components/timeline/RecentlyDeletedPanel';

const DAY = 86_400_000;
const binnedEntry = (over: Record<string, unknown> = {}) => ({
    id: 1,
    mood: 7,
    notes: 'a bad tuesday',
    date: '2026-06-12T10:00:00.000Z',
    deleted_at: new Date(FIXED_NOW.getTime() - 3 * DAY).toISOString(),
    activityNames: ['Running', 'Reading'],
    ...over,
});

const onClose = jest.fn();
const onChanged = jest.fn();

const renderPanel = (visible = true) =>
    render(
        <OverlayProvider>
            <RecentlyDeletedPanel visible={visible} onClose={onClose} onChanged={onChanged} />
        </OverlayProvider>
    );

beforeEach(() => {
    jest.clearAllMocks();
    resetWriteLayer();
    mockDb = makeDb();
    setInsets(INSETS.THREE_BUTTON_NAV);
    // "N days left" counts from the app clock; binnedEntry stamps from the same instant.
    freezeNow(FIXED_NOW);
    mockGetBinnedEntries.mockResolvedValue([]);
    mockRestoreMoodEntry.mockResolvedValue({ success: true, message: 'ok' });
    mockPurgeMoodEntry.mockResolvedValue({ success: true, message: 'ok' });
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

describe('RecentlyDeletedPanel', () => {
    it('renders nothing while hidden (and does not read the DB)', async () => {
        const view = await renderPanel(false);
        expect(view.queryByText('Recently deleted')).toBeNull();
        expect(mockGetBinnedEntries).not.toHaveBeenCalled();
    });

    it('shows the empty state and the retention promise when the bin is empty', async () => {
        const view = await renderPanel();
        await waitFor(() => expect(view.queryByTestId('bin-empty')).not.toBeNull());
        expect(view.queryByText('Nothing here')).not.toBeNull();
        // The retention window is stated in copy, sourced from BIN_RETENTION_DAYS
        // so it can never disagree with the sweep. Both the header note and the
        // empty-state body say it, hence getAllByText.
        expect(view.getAllByText(/30 days/).length).toBeGreaterThanOrEqual(2);
    });

    it('renders a binned entry with its mood, notes, activities and bin countdown', async () => {
        mockGetBinnedEntries.mockResolvedValue([binnedEntry()]);
        const view = await renderPanel();

        await waitFor(() => expect(view.queryByTestId('bin-entry-1')).not.toBeNull());
        expect(view.queryByText('a bad tuesday')).not.toBeNull();
        expect(view.queryByText('Running · Reading')).not.toBeNull();
        expect(view.queryByText('Deleted 3 days ago · 27 days left')).not.toBeNull();
    });

    it('Restore calls restoreMoodEntry, reloads the bin, and notifies the Timeline', async () => {
        mockGetBinnedEntries.mockResolvedValueOnce([binnedEntry()]).mockResolvedValue([]);
        const view = await renderPanel();
        await waitFor(() => expect(view.queryByTestId('bin-restore-1')).not.toBeNull());

        await act(async () => {
            await fireEvent.press(view.getByTestId('bin-restore-1'));
        });

        expect(mockRestoreMoodEntry).toHaveBeenCalledWith(mockDb, 1);
        // Reloaded from the DB (not patched locally) so the two lists can't
        // disagree about what exists…
        expect(mockGetBinnedEntries.mock.calls.length).toBeGreaterThan(1);
        // …and the Timeline is told to refetch.
        expect(onChanged).toHaveBeenCalled();
        await waitFor(() => expect(view.queryByTestId('bin-empty')).not.toBeNull());
    });

    it('Delete forever CONFIRMS first and only purges when the user confirms', async () => {
        mockGetBinnedEntries.mockResolvedValue([binnedEntry()]);
        const view = await renderPanel();
        await waitFor(() => expect(view.queryByTestId('bin-purge-1')).not.toBeNull());

        await act(async () => {
            await fireEvent.press(view.getByTestId('bin-purge-1'));
        });

        // Confirmed, not executed: this is the one irreversible action in the
        // feature and it also unlinks the photo files.
        expect(mockPurgeMoodEntry).not.toHaveBeenCalled();
        expect(Alert.alert).toHaveBeenCalledWith(
            'Delete forever?',
            expect.stringContaining('permanently'),
            expect.any(Array)
        );

        // Run the destructive button the Alert offered.
        const buttons = (Alert.alert as jest.Mock).mock.calls[0][2] as {
            text: string;
            onPress?: () => void;
        }[];
        const confirm = buttons.find((b) => b.text === 'Delete forever');
        expect(confirm).toBeDefined();
        expect(buttons.some((b) => b.text === 'Cancel')).toBe(true);

        await act(async () => {
            await confirm!.onPress?.();
        });

        expect(mockPurgeMoodEntry).toHaveBeenCalledWith(mockDb, 1);
        expect(onChanged).toHaveBeenCalled();
    });

    it('a failed read shows a retry, NOT the reassuring empty state', async () => {
        mockGetBinnedEntries.mockRejectedValue(new Error('read failed'));
        const view = await renderPanel();

        await waitFor(() => expect(view.queryByTestId('bin-retry')).not.toBeNull());
        // Rendering "Nothing here" over a bin that still holds entries would tell
        // the user their entries are gone.
        expect(view.queryByTestId('bin-empty')).toBeNull();

        mockGetBinnedEntries.mockResolvedValue([binnedEntry()]);
        await act(async () => {
            await fireEvent.press(view.getByTestId('bin-retry'));
        });
        await waitFor(() => expect(view.queryByTestId('bin-entry-1')).not.toBeNull());
    });

    it('a failed restore alerts and leaves the entry in the bin', async () => {
        mockGetBinnedEntries.mockResolvedValue([binnedEntry()]);
        mockRestoreMoodEntry.mockResolvedValue({ success: false, message: 'nope' });
        const view = await renderPanel();
        await waitFor(() => expect(view.queryByTestId('bin-restore-1')).not.toBeNull());

        await act(async () => {
            await fireEvent.press(view.getByTestId('bin-restore-1'));
        });

        expect(Alert.alert).toHaveBeenCalledWith("Couldn't restore entry", 'nope');
        expect(onChanged).not.toHaveBeenCalled();
        expect(view.queryByTestId('bin-entry-1')).not.toBeNull();
    });

    it('the close button fires onClose', async () => {
        const view = await renderPanel();
        await waitFor(() => expect(view.queryByTestId('bin-close')).not.toBeNull());
        await act(async () => {
            await fireEvent.press(view.getByTestId('bin-close'));
        });
        expect(onClose).toHaveBeenCalled();
    });

    it('renders IN-TREE: no react-native <Modal> anywhere in the panel', async () => {
        mockGetBinnedEntries.mockResolvedValue([binnedEntry()]);
        const view = await renderPanel();
        await waitFor(() => expect(view.queryByTestId('bin-entry-1')).not.toBeNull());
        // Native <Modal> opens a second native window whose touch dispatch is
        // broken on this RN/Fabric line — every control inside would be dead to a
        // real finger. Structurally banned; this asserts it.
        expect(view.container.queryAll((n) => n.type === 'Modal')).toHaveLength(0);
    });
});
