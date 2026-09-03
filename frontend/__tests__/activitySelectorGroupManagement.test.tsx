/**
 * ActivitySelector — GROUP management end-to-end through the real UI wiring:
 * long-press-to-move-mode, drag-to-persist, rename, and the delete flow with its
 * cascade warning + "move the activities somewhere first" escape hatch.
 *
 * This is deliberately an INTEGRATION test over the whole selector rather than
 * per-dialog unit tests: every one of these features is a chain (gesture ->
 * state -> DB call -> reload), and the bugs live in the joins, not in the
 * pieces. Only the truly undrivable leaves are mocked:
 *  - `react-native-sortables` (a worklet/RNGH drag cannot be fired in jest) is a
 *    passthrough that renders rows and captures the drag callbacks, so a "drop"
 *    is invokable;
 *  - `OverlayModal` / `OverlayPopover` become visible/hidden passthroughs (same
 *    pattern as dbViewerEntryFormMount.test.tsx) so nothing pulls reanimated;
 *  - the `@/databases/database` facade, so we assert on the exact calls.
 *
 * RNTL 14 is async-by-default in this repo (tasks/lessons.md 2026-08-29): every
 * render() and fireEvent.*() below is awaited.
 */
import React from 'react';
import { render, act, fireEvent, waitFor } from '@testing-library/react-native';

// ── Sortable.Grid passthrough; captures the LAST grid's props per render pass ──
type GridProps = {
    data: unknown[];
    renderItem: (info: { item: unknown }) => React.ReactElement;
    keyExtractor?: (item: unknown) => string;
    onDragEnd?: (params: { data: unknown[] }) => void;
};
const gridsBox: { current: GridProps[] } = { current: [] };

jest.mock('react-native-sortables', () => {
    const ReactActual = require('react') as typeof React;
    const { View } = require('react-native');
    return {
        __esModule: true,
        default: {
            Grid: (props: GridProps) => {
                gridsBox.current.push(props);
                return ReactActual.createElement(
                    View,
                    null,
                    props.data.map((item, i) =>
                        ReactActual.createElement(
                            View,
                            { key: props.keyExtractor?.(item) ?? String(i) },
                            props.renderItem({ item })
                        )
                    )
                );
            },
        },
    };
});

// ── Overlay passthroughs (no reanimated) ─────────────────────────────────────
jest.mock('@/components/OverlayModal', () => {
    const ReactActual = require('react') as typeof React;
    const { View } = require('react-native');
    return {
        OverlayModal: ({ children, visible }: { children: React.ReactNode; visible: boolean }) =>
            visible ? ReactActual.createElement(View, null, children) : null,
    };
});
jest.mock('@/components/OverlayPopover', () => {
    const ReactActual = require('react') as typeof React;
    const { View } = require('react-native');
    return {
        OverlayPopover: ({ children, visible }: { children: React.ReactNode; visible: boolean }) =>
            visible ? ReactActual.createElement(View, null, children) : null,
    };
});

const mockHapticDragStart = jest.fn();
jest.mock('@/lib/haptics', () => ({
    hapticDragStart: () => mockHapticDragStart(),
    hapticReorderTick: jest.fn(),
    hapticDragEnd: jest.fn(),
}));

jest.mock('@/context/DataContext', () => ({
    useDataContext: () => ({ refetchEntries: jest.fn() }),
}));

// ── The DB facade ─────────────────────────────────────────────────────────────
const ok = { success: true, message: 'ok' };

const mockGetActivityGroups = jest.fn();
const mockGetActivities = jest.fn();
const mockReorderActivityGroups = jest.fn();
const mockRenameActivityGroup = jest.fn();
const mockGetGroupDeletionImpact = jest.fn();
const mockDeleteActivityGroup = jest.fn();
const mockMoveActivitiesToGroup = jest.fn();
const mockAddActivityGroup = jest.fn();
const mockAddActivity = jest.fn();
const mockUpdateActivityPositions = jest.fn();
const mockUpdateActivity = jest.fn();
const mockDeleteActivity = jest.fn();
const mockMoveActivityToGroup = jest.fn();

jest.mock('@/databases/database', () => ({
    getActivityGroups: (...a: unknown[]) => mockGetActivityGroups(...a),
    getActivities: (...a: unknown[]) => mockGetActivities(...a),
    reorderActivityGroups: (...a: unknown[]) => mockReorderActivityGroups(...a),
    renameActivityGroup: (...a: unknown[]) => mockRenameActivityGroup(...a),
    getGroupDeletionImpact: (...a: unknown[]) => mockGetGroupDeletionImpact(...a),
    deleteActivityGroup: (...a: unknown[]) => mockDeleteActivityGroup(...a),
    moveActivitiesToGroup: (...a: unknown[]) => mockMoveActivitiesToGroup(...a),
    addActivityGroup: (...a: unknown[]) => mockAddActivityGroup(...a),
    addActivity: (...a: unknown[]) => mockAddActivity(...a),
    updateActivityPositions: (...a: unknown[]) => mockUpdateActivityPositions(...a),
    updateActivity: (...a: unknown[]) => mockUpdateActivity(...a),
    deleteActivity: (...a: unknown[]) => mockDeleteActivity(...a),
    moveActivityToGroup: (...a: unknown[]) => mockMoveActivityToGroup(...a),
}));

const mockDb = {
    getAllAsync: jest.fn().mockResolvedValue([]),
    getFirstAsync: jest.fn().mockResolvedValue(null),
    runAsync: jest.fn().mockResolvedValue({ lastInsertRowId: 1, changes: 1 }),
};
jest.mock('expo-sqlite', () => ({
    useSQLiteContext: () => mockDb,
}));

import { ActivitySelector } from '@/components/forms/ActivitySelector';
import type { Activity, ActivityGroup } from '@/components/types';

const GROUPS: ActivityGroup[] = [
    { id: 1, name: 'Exercise', sort_order: 1 },
    { id: 2, name: 'Social', sort_order: 2 },
    { id: 3, name: 'Chores', sort_order: 3 },
];

const ACTIVITIES: Activity[] = [
    { id: 10, name: 'Running', group_id: 1, position: 1, icon_family: 'Feather', icon_name: 'activity' },
    { id: 11, name: 'Yoga', group_id: 1, position: 2, icon_family: 'Feather', icon_name: 'sun' },
    { id: 12, name: 'Dinner out', group_id: 2, position: 1, icon_family: 'Feather', icon_name: 'coffee' },
] as Activity[];

const renderSelector = async () => {
    const view = await render(
        <ActivitySelector onSelectActivity={jest.fn()} selectedActivities={[]} />
    );
    // The mount effect loads groups + activities; let those promises settle.
    await waitFor(() => expect(view.getByText('Exercise')).toBeTruthy());
    return view;
};

/** The group header Pressable — the long-press target for move mode. */
const groupHeader = (view: Awaited<ReturnType<typeof renderSelector>>, name: string) =>
    view.getByLabelText(`${name} group. Hold to reorder groups.`);

/** Open a group's "..." menu (a plain tap on its header opens the same menu). */
const openGroupMenu = async (view: Awaited<ReturnType<typeof renderSelector>>, name: string) => {
    await fireEvent.press(view.getByLabelText(`${name} group options`));
};

beforeEach(() => {
    jest.clearAllMocks();
    gridsBox.current = [];
    mockGetActivityGroups.mockResolvedValue(GROUPS);
    mockGetActivities.mockResolvedValue(ACTIVITIES);
    mockReorderActivityGroups.mockResolvedValue(ok);
    mockRenameActivityGroup.mockResolvedValue(ok);
    mockDeleteActivityGroup.mockResolvedValue(ok);
    mockGetGroupDeletionImpact.mockResolvedValue({
        exists: true,
        activityCount: 2,
        entryCount: 5,
    });
    mockMoveActivitiesToGroup.mockResolvedValue({ ...ok, moved: 2, skipped: [] });
});

describe('groups are read through the ONE canonical ordered query', () => {
    it('loads groups via getActivityGroups, never a local SELECT on the db', async () => {
        const view = await renderSelector();

        expect(mockGetActivityGroups).toHaveBeenCalledWith(mockDb);
        // A stray `SELECT ... FROM activity_groups ORDER BY id` here is exactly
        // the drift this feature has to prevent — the reorder would not show up.
        const groupSelects = mockDb.getAllAsync.mock.calls.filter(
            (c) => typeof c[0] === 'string' && c[0].includes('activity_groups')
        );
        expect(groupSelects).toHaveLength(0);
        expect(view.getByText('Chores')).toBeTruthy();
    });

    it('renders the groups in the order the query returned them', async () => {
        mockGetActivityGroups.mockResolvedValue([GROUPS[2], GROUPS[0], GROUPS[1]]);
        const view = await renderSelector();

        const names = view
            .getAllByText(/^(Exercise|Social|Chores)$/)
            .map((n) => n.props.children);
        expect(names).toEqual(['Chores', 'Exercise', 'Social']);
    });
});

describe('MOVE MODE — hold a group name (Anti: "it should collapse down to just the group names")', () => {
    it('a LONG-PRESS on a group name collapses the selector to just group rows', async () => {
        const view = await renderSelector();

        // Before: the activity chips are on screen.
        expect(view.queryByText('Running')).toBeTruthy();

        await fireEvent(groupHeader(view, 'Exercise'), 'longPress');

        // After: only the group names remain — every chip and the add-group
        // button are UNMOUNTED, not merely hidden.
        expect(view.getByText('Reorder groups')).toBeTruthy();
        expect(view.queryByText('Running')).toBeNull();
        expect(view.queryByText('Yoga')).toBeNull();
        expect(view.queryByText('Dinner out')).toBeNull();
        expect(view.queryByText('Add New Activity Group')).toBeNull();
        expect(view.getByText('Exercise')).toBeTruthy();
        expect(view.getByText('Social')).toBeTruthy();
        expect(view.getByText('Chores')).toBeTruthy();
    });

    it('buzzes when the hold registers (the only feedback that the gesture took)', async () => {
        const view = await renderSelector();
        await fireEvent(groupHeader(view, 'Social'), 'longPress');
        expect(mockHapticDragStart).toHaveBeenCalledTimes(1);
    });

    it('a plain TAP on the group name opens the menu, it does NOT enter move mode', async () => {
        const view = await renderSelector();

        await fireEvent.press(groupHeader(view, 'Exercise'));

        // Menu opened (the header is a second, larger target for it)...
        expect(view.getByText('Delete Group')).toBeTruthy();
        // ...and move mode did NOT engage (its title/hint are absent, chips stay).
        expect(view.queryByText('Reorder groups')).toBeNull();
        expect(view.queryByText('Hold a group, then drag it up or down.')).toBeNull();
        expect(view.queryByText('Running')).toBeTruthy();
    });

    it('Done leaves move mode and brings the chips back', async () => {
        const view = await renderSelector();
        await fireEvent(groupHeader(view, 'Exercise'), 'longPress');

        await fireEvent.press(view.getByText('Done'));

        expect(view.queryByText('Reorder groups')).toBeNull();
        expect(view.getByText('Running')).toBeTruthy();
    });

    it('a DROP persists the new order immediately, in the dropped sequence', async () => {
        const view = await renderSelector();
        await fireEvent(groupHeader(view, 'Exercise'), 'longPress');

        const dropped = [GROUPS[1], GROUPS[2], GROUPS[0]];
        await act(async () => {
            gridsBox.current[gridsBox.current.length - 1].onDragEnd?.({ data: dropped });
        });

        expect(mockReorderActivityGroups).toHaveBeenCalledWith(mockDb, dropped);
        // ...and the list is re-read so every other surface sees the new order.
        expect(mockGetActivityGroups.mock.calls.length).toBeGreaterThan(1);
    });

    it('the "..." menu offers the same move mode for anyone who never finds the gesture', async () => {
        const view = await renderSelector();
        await openGroupMenu(view, 'Exercise');

        await fireEvent.press(view.getByLabelText('Reorder groups'));

        expect(view.getByText('Reorder groups')).toBeTruthy();
        expect(view.queryByText('Running')).toBeNull();
    });
});

describe('RENAME a group', () => {
    it('renames through the DB layer and reloads', async () => {
        const view = await renderSelector();
        await openGroupMenu(view, 'Exercise');
        await fireEvent.press(view.getByLabelText('Rename group'));

        // The field is pre-filled with the current name.
        const input = view.getByLabelText('Group name');
        expect(input.props.value).toBe('Exercise');

        await fireEvent.changeText(input, '  Movement  ');
        await fireEvent.press(view.getByLabelText('Save group name'));

        await waitFor(() =>
            // Trimming is the DB layer's job — the UI passes the raw text so the
            // one validation implementation stays authoritative.
            expect(mockRenameActivityGroup).toHaveBeenCalledWith(mockDb, 1, '  Movement  ')
        );
    });

    it('surfaces a rejected rename inline and keeps the dialog open', async () => {
        mockRenameActivityGroup.mockResolvedValue({
            success: false,
            message: 'A group with this name already exists',
        });
        const view = await renderSelector();
        await openGroupMenu(view, 'Exercise');
        await fireEvent.press(view.getByLabelText('Rename group'));
        await fireEvent.press(view.getByLabelText('Save group name'));

        await waitFor(() =>
            expect(view.getByText('A group with this name already exists')).toBeTruthy()
        );
        // Still open — the user can fix the name rather than start over.
        expect(view.getByLabelText('Group name')).toBeTruthy();
    });
});

describe('DELETE a group — the cascade warning and its escape hatch', () => {
    const openDelete = async (view: Awaited<ReturnType<typeof renderSelector>>) => {
        await openGroupMenu(view, 'Exercise');
        await fireEvent.press(view.getByText('Delete Group'));
        await waitFor(() => expect(view.getByLabelText('Delete group')).toBeTruthy());
    };

    it('MEASURES the impact before opening and states it precisely', async () => {
        const view = await renderSelector();
        await openDelete(view);

        expect(mockGetGroupDeletionImpact).toHaveBeenCalledWith(mockDb, 1);
        expect(
            view.getByText(
                'This permanently deletes 2 activities and removes their history from 5 entries. ' +
                    'Your entries stay, but those activity tags are gone for good.'
            )
        ).toBeTruthy();
    });

    it('offers moving the activities to every OTHER group as the safe alternative', async () => {
        const view = await renderSelector();
        await openDelete(view);

        expect(view.getByLabelText('Move activities to Social')).toBeTruthy();
        expect(view.getByLabelText('Move activities to Chores')).toBeTruthy();
        // Never offers the group being deleted as its own destination.
        expect(view.queryByLabelText('Move activities to Exercise')).toBeNull();
    });

    it('moving re-measures the impact so the delete decision uses CURRENT numbers', async () => {
        const view = await renderSelector();
        await openDelete(view);

        mockGetGroupDeletionImpact.mockResolvedValue({
            exists: true,
            activityCount: 0,
            entryCount: 0,
        });
        await fireEvent.press(view.getByLabelText('Move activities to Social'));

        await waitFor(() => expect(mockMoveActivitiesToGroup).toHaveBeenCalledWith(mockDb, 1, 2));
        await waitFor(() =>
            expect(
                view.getByText('This group is empty, so deleting it affects nothing else.')
            ).toBeTruthy()
        );
        // Still open: moving is not deleting, the user decides next.
        expect(mockDeleteActivityGroup).not.toHaveBeenCalled();
    });

    it('names the activities a move had to leave behind rather than silently dropping them', async () => {
        mockMoveActivitiesToGroup.mockResolvedValue({
            success: true,
            message: 'Moved 1 activity',
            moved: 1,
            skipped: ['Yoga'],
        });
        const view = await renderSelector();
        await openDelete(view);

        await fireEvent.press(view.getByLabelText('Move activities to Social'));

        await waitFor(() => expect(view.getByText(/Left behind.*Yoga/)).toBeTruthy());
    });

    it('hides the move option when there is nothing to save', async () => {
        mockGetGroupDeletionImpact.mockResolvedValue({
            exists: true,
            activityCount: 0,
            entryCount: 0,
        });
        const view = await renderSelector();
        await openDelete(view);

        expect(view.queryByLabelText('Move activities to Social')).toBeNull();
    });

    it('confirming deletes, closes, and reloads', async () => {
        const view = await renderSelector();
        await openDelete(view);

        await fireEvent.press(view.getByLabelText('Delete group'));

        await waitFor(() => expect(mockDeleteActivityGroup).toHaveBeenCalledWith(mockDb, 1));
        await waitFor(() => expect(view.queryByLabelText('Delete group')).toBeNull());
    });

    it('cancelling deletes nothing', async () => {
        const view = await renderSelector();
        await openDelete(view);

        await fireEvent.press(view.getByLabelText('Cancel deleting group'));

        expect(mockDeleteActivityGroup).not.toHaveBeenCalled();
        expect(view.queryByLabelText('Delete group')).toBeNull();
    });

    it('a failed delete keeps the dialog open with the reason', async () => {
        mockDeleteActivityGroup.mockResolvedValue({
            success: false,
            message: 'Failed to delete activity group',
        });
        const view = await renderSelector();
        await openDelete(view);

        await fireEvent.press(view.getByLabelText('Delete group'));

        await waitFor(() =>
            expect(view.getByText('Failed to delete activity group')).toBeTruthy()
        );
    });

    it('refuses to open at all when the impact cannot be measured (never a blind delete)', async () => {
        mockGetGroupDeletionImpact.mockResolvedValue({
            exists: false,
            activityCount: 0,
            entryCount: 0,
        });
        const view = await renderSelector();
        await openGroupMenu(view, 'Exercise');
        await fireEvent.press(view.getByText('Delete Group'));

        await waitFor(() => expect(mockGetGroupDeletionImpact).toHaveBeenCalled());
        expect(view.queryByLabelText('Delete group')).toBeNull();
    });
});
