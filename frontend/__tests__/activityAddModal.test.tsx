/**
 * The Add activity dialog (ActivityAddModal), reached from the activity
 * selector's per-group "+" and from the explorer's Add activity button (#51).
 *
 * Pins what review-51 found missing:
 *  - nothing is written for a blank name or with no group picked;
 *  - the name is trimmed before it is written;
 *  - a duplicate name in the group shows an inline message and keeps the
 *    dialog open (driven by the DatabaseResult `code`, not by error text);
 *  - any other failure shows a plain alert, never the raw database error;
 *  - success calls onAdd, onClose and refetchEntries;
 *  - closing writes nothing;
 *  - the group picker sets the target group and the title follows it;
 *  - the card is height-capped (a number, so it resolves) and its fields sit in
 *    a ScrollView that keeps taps while the keyboard is up.
 *
 * OverlayModal is a plain visible/hidden passthrough (activityEditModalGroupPicker
 * pattern), so the nested pickers render inline. RNTL 14 is async: every
 * render/fireEvent is awaited.
 */
import React from 'react';
import { Alert, StyleSheet } from 'react-native';
import { act, fireEvent, render, within } from '@testing-library/react-native';

jest.mock('@/components/OverlayModal', () => {
    const ReactActual = require('react') as typeof React;
    const { View } = require('react-native');
    return {
        OverlayModal: ({ children, visible }: { children: React.ReactNode; visible: boolean }) =>
            visible ? ReactActual.createElement(View, null, children) : null,
    };
});

const mockAddActivity = jest.fn();
jest.mock('@/databases/database', () => ({
    addActivity: (...args: unknown[]) => mockAddActivity(...args),
}));

const mockRefetchEntries = jest.fn();
jest.mock('@/context/DataContext', () => ({
    useDataContext: () => ({ refetchEntries: mockRefetchEntries }),
}));

import { AddActivityModal } from '@/components/forms/ActivityAddModal';
import { ACTIVITY_NAME_TAKEN } from '@/databases/activities';
import type { ActivityGroup } from '@/components/types';

const groups: ActivityGroup[] = [
    { id: 1, name: 'Exercise', sort_order: 1 },
    { id: 2, name: 'Social', sort_order: 2 },
];
const mockDb = {} as any;

let alertSpy: jest.SpyInstance;
let errorSpy: jest.SpyInstance;

beforeEach(() => {
    jest.clearAllMocks();
    mockAddActivity.mockResolvedValue({ success: true, message: 'ok' });
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    alertSpy.mockRestore();
    errorSpy.mockRestore();
});

async function renderAdd(groupId: number | null = 1) {
    const onClose = jest.fn();
    const onAdd = jest.fn();
    const view = await render(
        <AddActivityModal
            visible
            groupId={groupId}
            onClose={onClose}
            onAdd={onAdd}
            db={mockDb}
            groups={groups}
        />
    );
    return { view, onClose, onAdd };
}

async function typeName(view: Awaited<ReturnType<typeof renderAdd>>['view'], name: string) {
    await act(async () => {
        // By placeholder: the label is asserted once, in the layout test below.
        fireEvent.changeText(view.getByPlaceholderText('Activity Name'), name);
    });
}

async function pressAdd(view: Awaited<ReturnType<typeof renderAdd>>['view']) {
    await act(async () => {
        fireEvent.press(view.getByText('Add Activity'));
    });
}

describe('AddActivityModal: what gets written', () => {
    it.each(['', '   '])('never writes a blank name (%j)', async (name) => {
        const { view, onAdd, onClose } = await renderAdd();
        await typeName(view, name);
        await pressAdd(view);

        expect(mockAddActivity).not.toHaveBeenCalled();
        expect(alertSpy).toHaveBeenCalledWith('Activity Not Complete', 'Activity name is missing.');
        expect(onAdd).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
    });

    it('never writes without a group (the explorer opens it with none picked)', async () => {
        const { view, onAdd } = await renderAdd(null);
        await typeName(view, 'Walk');
        await pressAdd(view);

        expect(mockAddActivity).not.toHaveBeenCalled();
        expect(alertSpy).toHaveBeenCalledWith('Activity Not Complete', 'Activity group is missing.');
        expect(onAdd).not.toHaveBeenCalled();
    });

    it('trims the name and writes it to the chosen group with the default icon', async () => {
        const { view } = await renderAdd(2);
        await typeName(view, '  Board games  ');
        await pressAdd(view);

        expect(mockAddActivity).toHaveBeenCalledWith(mockDb, 'Board games', 2, 'Feather', 'circle');
    });

    it('on success calls onAdd, onClose and refetchEntries', async () => {
        const { view, onAdd, onClose } = await renderAdd();
        await typeName(view, 'Walk');
        await pressAdd(view);

        expect(onAdd).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(mockRefetchEntries).toHaveBeenCalledTimes(1);
        expect(alertSpy).not.toHaveBeenCalled();
    });

    it('closing with the X writes nothing', async () => {
        const { view, onClose, onAdd } = await renderAdd();
        await typeName(view, 'Walk');
        await act(async () => {
            fireEvent.press(view.getByLabelText('Close without adding'));
        });

        expect(onClose).toHaveBeenCalledTimes(1);
        expect(mockAddActivity).not.toHaveBeenCalled();
        expect(onAdd).not.toHaveBeenCalled();
    });
});

describe('AddActivityModal: failures', () => {
    it('a duplicate name shows an inline message and keeps the dialog open', async () => {
        mockAddActivity.mockResolvedValue({
            success: false,
            code: ACTIVITY_NAME_TAKEN,
            message: 'An activity with this name already exists in this group',
        });
        const { view, onAdd, onClose } = await renderAdd();
        await typeName(view, 'Walk');
        await pressAdd(view);

        expect(view.getByText('An activity with this name already exists in this group.')).toBeTruthy();
        expect(alertSpy).not.toHaveBeenCalled();
        expect(onAdd).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
        expect(mockRefetchEntries).not.toHaveBeenCalled();
    });

    it('editing the name clears the duplicate message', async () => {
        mockAddActivity.mockResolvedValue({ success: false, code: ACTIVITY_NAME_TAKEN, message: 'x' });
        const { view } = await renderAdd();
        await typeName(view, 'Walk');
        await pressAdd(view);
        await typeName(view, 'Walk 2');

        expect(view.queryByText('An activity with this name already exists in this group.')).toBeNull();
    });

    it('any other failed result shows a plain alert, never the database text', async () => {
        mockAddActivity.mockResolvedValue({
            success: false,
            message: 'Failed to add activity: SQLITE_BUSY database is locked',
        });
        const { view, onAdd, onClose } = await renderAdd();
        await typeName(view, 'Walk');
        await pressAdd(view);

        expect(alertSpy).toHaveBeenCalledTimes(1);
        expect(alertSpy).toHaveBeenCalledWith("Couldn't add activity", 'Something went wrong. Please try again.');
        expect(JSON.stringify(view.toJSON())).not.toMatch(/SQLITE|locked/);
        expect(onAdd).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
    });

    it('a thrown write shows the same plain alert', async () => {
        mockAddActivity.mockRejectedValue(new Error('disk I/O error'));
        const { view, onClose } = await renderAdd();
        await typeName(view, 'Walk');
        await pressAdd(view);

        expect(alertSpy).toHaveBeenCalledWith("Couldn't add activity", 'Something went wrong. Please try again.');
        expect(JSON.stringify(alertSpy.mock.calls)).not.toMatch(/disk/);
        expect(onClose).not.toHaveBeenCalled();
    });
});

describe('AddActivityModal: group picker and title', () => {
    it('the title names the starting group', async () => {
        const { view } = await renderAdd(2);
        expect(view.getByText('Add New Social Activity')).toBeTruthy();
    });

    it('with no group picked the title is generic and the field asks for one', async () => {
        const { view } = await renderAdd(null);
        expect(view.getByText('Add New Activity')).toBeTruthy();
        expect(view.getByText('Select a group')).toBeTruthy();
    });

    it('picking a group sets where it is written and updates the title', async () => {
        const { view } = await renderAdd(null);
        await act(async () => {
            fireEvent.press(view.getByLabelText('Select group'));
        });
        await act(async () => {
            fireEvent.press(view.getByLabelText('Add to Social'));
        });

        expect(view.getByText('Add New Social Activity')).toBeTruthy();
        expect(view.queryByLabelText('Add to Exercise')).toBeNull(); // picker closed

        await typeName(view, 'Walk');
        await pressAdd(view);
        expect(mockAddActivity).toHaveBeenCalledWith(mockDb, 'Walk', 2, 'Feather', 'circle');
    });

    it('marks the current group as selected in the picker', async () => {
        const { view } = await renderAdd(1);
        await act(async () => {
            fireEvent.press(view.getByLabelText('Select group'));
        });
        expect(view.getByLabelText('Add to Exercise').props.accessibilityState).toEqual({ selected: true });
        expect(view.getByLabelText('Add to Social').props.accessibilityState).toEqual({ selected: false });
    });
});

describe('AddActivityModal: fits a short screen', () => {
    it('caps the card with a numeric maxHeight and scrolls the fields with taps kept', async () => {
        const { view } = await renderAdd();
        const card = view.getByTestId('activity-add-dialog');
        expect(typeof StyleSheet.flatten(card.props.style).maxHeight).toBe('number');

        const fields = view.getByTestId('activity-add-fields');
        expect(fields.props.keyboardShouldPersistTaps).toBe('handled');
        expect(within(fields).getByLabelText('Activity name')).toBeTruthy();
        // The title and the Add button stay outside the scrolling body, so
        // neither is ever scrolled or clipped out of reach.
        expect(within(fields).queryByText('Add Activity')).toBeNull();
        expect(within(fields).queryByText('Add New Exercise Activity')).toBeNull();
        expect(view.getByText('Add Activity')).toBeTruthy();
    });
});
