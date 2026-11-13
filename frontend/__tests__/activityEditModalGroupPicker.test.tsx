/**
 * Tests for the "move this activity to another group" picker added to
 * ActivityEditModal. Covers:
 *  - the current group's name is displayed on the trigger row;
 *  - opening the picker lists every other group;
 *  - selecting another group then pressing Update calls updateActivity AND
 *    THEN moveActivityToGroup, in that order (see the write-ordering comment
 *    in ActivityEditModal.handleUpdate — the rename must land first so
 *    moveActivityToGroup validates the NEW name against the target group);
 *  - pressing Update without changing the group never calls moveActivityToGroup;
 *  - a failing updateActivity never calls moveActivityToGroup;
 *  - a failing moveActivityToGroup surfaces its message and does not close;
 *  - keyboard closed: Delete / Update are pinned below the scrolling fields;
 *    keyboard open: they move to the end of the scrolling fields, so the name
 *    field gets the whole card (#51 device QA, 360x640 at font 1.3).
 *
 * `@/components/OverlayModal` is mocked to a plain visible/hidden passthrough
 * (same pattern as dbViewerEntryFormMount.test.tsx) so neither the top-level
 * dialog, the nested group picker, nor IconPicker's own internal OverlayModal
 * ever imports react-native-reanimated — no worklets-runtime shim needed.
 *
 * RNTL 14 is async-by-default in this repo (see tasks/lessons.md 2026-08-29):
 * every render() and fireEvent.*() below is awaited.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, act, fireEvent, within } from '@testing-library/react-native';

jest.mock('@/components/OverlayModal', () => {
    const ReactActual = require('react') as typeof React;
    const { View } = require('react-native');
    return {
        OverlayModal: ({
            children,
            visible,
        }: {
            children: React.ReactNode;
            visible: boolean;
        }) => (visible ? ReactActual.createElement(View, null, children) : null),
    };
});

const mockUpdateActivity = jest.fn();
const mockDeleteActivity = jest.fn();
const mockMoveActivityToGroup = jest.fn();
jest.mock('@/databases/database', () => ({
    updateActivity: (...args: unknown[]) => mockUpdateActivity(...args),
    deleteActivity: (...args: unknown[]) => mockDeleteActivity(...args),
    moveActivityToGroup: (...args: unknown[]) => mockMoveActivityToGroup(...args),
}));

const mockRefetchEntries = jest.fn();
jest.mock('@/context/DataContext', () => ({
    useDataContext: () => ({ refetchEntries: mockRefetchEntries }),
}));

import { ActivityEditModal } from '@/components/forms/ActivityEditModal';
import { OverlayProvider } from '@/context/OverlayHost';
import { INSETS, setInsets, setKeyboardHeight } from '@/testing/platform';
import type { Activity, ActivityGroup } from '@/components/types';

const runningActivity: Activity = {
    id: 1,
    name: 'Running',
    group_id: 1,
    position: 1,
    icon_family: 'Feather',
    icon_name: 'activity',
} as Activity;

const groups: ActivityGroup[] = [
    { id: 1, name: 'Exercise', sort_order: 1 },
    { id: 2, name: 'Social', sort_order: 2 },
    { id: 3, name: 'Chores', sort_order: 3 },
];

// The component doesn't touch `db` in the paths under test (updateActivity /
// moveActivityToGroup are mocked at the module level), so a stub is enough.
const mockDb = {} as any;

const renderModal = async (overrides: Partial<React.ComponentProps<typeof ActivityEditModal>> = {}) => {
    const onClose = jest.fn();
    const onUpdate = jest.fn();
    const view = await render(
        <ActivityEditModal
            visible
            activity={runningActivity}
            onClose={onClose}
            onUpdate={onUpdate}
            db={mockDb}
            groups={groups}
            {...overrides}
        />,
        { wrapper: OverlayProvider }
    );
    return { view, onClose, onUpdate };
};

beforeEach(() => {
    jest.clearAllMocks();
    mockUpdateActivity.mockResolvedValue({ success: true, message: 'ok' });
    mockMoveActivityToGroup.mockResolvedValue({ success: true, message: 'ok' });
});

describe('ActivityEditModal — group picker', () => {
    it("shows the activity's current group name on the trigger row", async () => {
        const { view } = await renderModal();
        expect(view.getByLabelText('Move activity to another group')).toBeTruthy();
        expect(view.getByText('Exercise')).toBeTruthy();
    });

    it('opening the picker lists every other group', async () => {
        const { view } = await renderModal();
        await act(async () => {
            fireEvent.press(view.getByLabelText('Move activity to another group'));
        });
        expect(view.getByLabelText('Move to Exercise')).toBeTruthy();
        expect(view.getByLabelText('Move to Social')).toBeTruthy();
        expect(view.getByLabelText('Move to Chores')).toBeTruthy();
    });

    it('selecting another group then pressing Update calls updateActivity THEN moveActivityToGroup', async () => {
        const { view, onUpdate, onClose } = await renderModal();

        await act(async () => {
            fireEvent.press(view.getByLabelText('Move activity to another group'));
        });
        await act(async () => {
            fireEvent.press(view.getByLabelText('Move to Social'));
        });
        // The trigger row now reflects the local selection immediately.
        expect(view.getByText('Social')).toBeTruthy();

        await act(async () => {
            fireEvent.press(view.getByText('Update'));
        });

        expect(mockUpdateActivity).toHaveBeenCalledWith(mockDb, 1, 'Running', 'Feather', 'activity');
        expect(mockMoveActivityToGroup).toHaveBeenCalledWith(mockDb, 1, 2);
        // updateActivity must have been called BEFORE moveActivityToGroup.
        const updateOrder = mockUpdateActivity.mock.invocationCallOrder[0];
        const moveOrder = mockMoveActivityToGroup.mock.invocationCallOrder[0];
        expect(updateOrder).toBeLessThan(moveOrder);

        expect(onUpdate).toHaveBeenCalled();
        expect(onClose).toHaveBeenCalled();
        expect(mockRefetchEntries).toHaveBeenCalled();
    });

    it('pressing Update without changing the group never calls moveActivityToGroup', async () => {
        const { view, onUpdate, onClose } = await renderModal();

        await act(async () => {
            fireEvent.press(view.getByText('Update'));
        });

        expect(mockUpdateActivity).toHaveBeenCalledTimes(1);
        expect(mockMoveActivityToGroup).not.toHaveBeenCalled();
        expect(onUpdate).toHaveBeenCalled();
        expect(onClose).toHaveBeenCalled();
    });

    it('selecting the current group is a no-op (still never calls moveActivityToGroup)', async () => {
        const { view } = await renderModal();

        await act(async () => {
            fireEvent.press(view.getByLabelText('Move activity to another group'));
        });
        await act(async () => {
            fireEvent.press(view.getByLabelText('Move to Exercise'));
        });
        await act(async () => {
            fireEvent.press(view.getByText('Update'));
        });

        expect(mockMoveActivityToGroup).not.toHaveBeenCalled();
    });

    it('a failing updateActivity never calls moveActivityToGroup', async () => {
        mockUpdateActivity.mockResolvedValue({ success: false, message: 'Name already exists' });
        const { view, onUpdate, onClose } = await renderModal();

        await act(async () => {
            fireEvent.press(view.getByLabelText('Move activity to another group'));
        });
        await act(async () => {
            fireEvent.press(view.getByLabelText('Move to Social'));
        });
        await act(async () => {
            fireEvent.press(view.getByText('Update'));
        });

        expect(mockMoveActivityToGroup).not.toHaveBeenCalled();
        expect(view.getByText('Name already exists')).toBeTruthy();
        expect(onUpdate).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
    });

    it('a failing moveActivityToGroup surfaces its message and does not close', async () => {
        mockMoveActivityToGroup.mockResolvedValue({
            success: false,
            message: 'An activity with this name already exists in that group',
        });
        const { view, onUpdate, onClose } = await renderModal();

        await act(async () => {
            fireEvent.press(view.getByLabelText('Move activity to another group'));
        });
        await act(async () => {
            fireEvent.press(view.getByLabelText('Move to Social'));
        });
        await act(async () => {
            fireEvent.press(view.getByText('Update'));
        });

        expect(mockUpdateActivity).toHaveBeenCalledTimes(1);
        expect(mockMoveActivityToGroup).toHaveBeenCalledTimes(1);
        expect(
            view.getByText('An activity with this name already exists in that group')
        ).toBeTruthy();
        // The rename DID land, so the caller must still refresh...
        expect(onUpdate).toHaveBeenCalled();
        // ...but the dialog stays open so the user sees the group didn't change.
        expect(onClose).not.toHaveBeenCalled();
    });
});

describe('ActivityEditModal: fits any screen, keyboard up or down', () => {
    it('lets the card shrink (no window-computed cap) and scrolls the fields with taps kept', async () => {
        setInsets(INSETS.THREE_BUTTON_NAV);
        const { view } = await renderModal();
        const card = StyleSheet.flatten(view.getByTestId('activity-edit-dialog').props.style);
        expect(card.flexShrink).toBe(1);
        expect(card.maxHeight).toBeUndefined();
        expect(card.marginTop).toBe(24 + 16);
        expect(card.marginBottom).toBe(48 + 16);
        expect(view.getByTestId('activity-edit-fields').props.keyboardShouldPersistTaps).toBe('handled');
    });

    it('keyboard closed: Delete and Update are pinned below the scrolling fields', async () => {
        setKeyboardHeight(0);
        const { view } = await renderModal();
        const fields = view.getByTestId('activity-edit-fields');
        expect(within(fields).getByLabelText('Activity name')).toBeTruthy();
        expect(within(fields).queryByText('Update')).toBeNull();
        expect(within(fields).queryByText('Delete')).toBeNull();
        expect(view.getByText('Update')).toBeTruthy();
    });

    it('keyboard open: Delete and Update scroll with the fields; the title stays pinned', async () => {
        setInsets(INSETS.THREE_BUTTON_NAV);
        setKeyboardHeight(300);
        const { view, onClose } = await renderModal();
        const fields = view.getByTestId('activity-edit-fields');
        expect(within(fields).getByText('Update')).toBeTruthy();
        expect(within(fields).getByText('Delete')).toBeTruthy();
        expect(within(fields).queryByText('Edit Activity')).toBeNull();
        expect(view.getAllByText('Update')).toHaveLength(1);
        expect(StyleSheet.flatten(view.getByTestId('activity-edit-dialog').props.style).marginBottom).toBe(16);

        // Update still saves from inside the scroll.
        await act(async () => {
            fireEvent.press(within(fields).getByText('Update'));
        });
        expect(mockUpdateActivity).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalled();
    });
});
