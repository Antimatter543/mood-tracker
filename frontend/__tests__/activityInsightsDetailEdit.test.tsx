/**
 * Editing an activity from its detail page (ActivityInsightsDetail, #51).
 *
 * Pins the two blockers review-51 found on the PR as first pushed, plus the
 * round trip the feature exists for:
 *  (a) the page with entries renders no stray text outside a <Text> (a `;`
 *      after the edit-modal block was a bare string under a View: on a device
 *      that is a red-screen "Text strings must be rendered within a <Text>");
 *  (b) with 0 entries the pencil still opens the editor (the editor was only
 *      mounted in the with-entries branch, so the pencil did nothing);
 *  (c) rename + move: the page title and the group subtitle follow the edit;
 *  (d) delete: the detail page closes itself (the activity is gone).
 *
 * Real ActivityInsightsDetail + real ActivityEditModal + the real getActivity /
 * getActivityGroups reads over a fake database whose rows the test mutates.
 * The three writes the editor makes are mocked at '@/databases/database' (their
 * SQL is covered in activities.test.ts); a mocked write also changes the fake
 * rows, so the re-read after it sees what a real write would leave.
 */
import React from 'react';
import { Alert, StyleSheet } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ENTRIES_FOR_ACTIVITY_IN_RANGE } from '@/components/visualisations/queries';
import type { Activity, ActivityGroup } from '@/components/types';
import { freezeNow } from '@/testing/clock';
import { makeDb, resetWriteLayer, type MockDb } from '@/testing/fakeDb';

jest.mock('@/components/OverlayModal', () => {
    const ReactActual = require('react') as typeof React;
    const { View } = require('react-native');
    return {
        OverlayModal: ({ children, visible }: { children: React.ReactNode; visible: boolean }) =>
            visible ? ReactActual.createElement(View, null, children) : null,
    };
});

// `useDataRefresh` calls `useFocusEffect`; outside a navigator it is "run this effect".
jest.mock('expo-router', () => {
    const ReactLocal = require('react');
    return { useFocusEffect: (cb: () => void) => ReactLocal.useEffect(cb, [cb]) };
});

jest.mock('@/styles/global', () => require('@/testing/theme').mockThemeModule('dark'));

let mockCurrentDb: MockDb;
jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => mockCurrentDb }));

const mockUpdateActivity = jest.fn();
const mockMoveActivityToGroup = jest.fn();
const mockDeleteActivity = jest.fn();
jest.mock('@/databases/database', () => ({
    updateActivity: (...args: unknown[]) => mockUpdateActivity(...args),
    moveActivityToGroup: (...args: unknown[]) => mockMoveActivityToGroup(...args),
    deleteActivity: (...args: unknown[]) => mockDeleteActivity(...args),
}));

const mockRefetchEntries = jest.fn();
jest.mock('@/context/DataContext', () => ({
    useDataContext: () => ({ refetchEntries: mockRefetchEntries }),
}));

import { ActivityInsightsDetail } from '@/components/ActivityInsightsDetail';

const groups: ActivityGroup[] = [
    { id: 1, name: 'Exercise', sort_order: 1 },
    { id: 2, name: 'Social', sort_order: 2 },
];

/** The fake database's activities table, mutated by the mocked writes. */
let rows: Map<number, Activity>;
let entryRows: { id: number; date: string; mood: number }[];

const walk: Activity = {
    id: 5,
    name: 'Walk',
    group_id: 1,
    position: 1,
    icon_family: 'Feather',
    icon_name: 'activity',
} as Activity;

function readActivity(params: unknown[]): Activity | null {
    const id = Number(Array.isArray(params) ? params[0] : params);
    const row = rows.get(id);
    return row ? { ...row } : null;
}

function installDb(): MockDb {
    const db = makeDb();
    db.getAllAsync.mockImplementation(async (sql: string) => {
        if (sql === ENTRIES_FOR_ACTIVITY_IN_RANGE) return entryRows;
        if (/FROM activity_groups/.test(sql)) return groups;
        return [];
    });
    const first = (sql: string, ...rest: unknown[]) => {
        if (/FROM activities WHERE id = \?/.test(sql)) {
            return readActivity(rest.length === 1 && Array.isArray(rest[0]) ? (rest[0] as unknown[]) : rest);
        }
        if (/COUNT\(\*\)/.test(sql)) return { count: entryRows.length };
        return null;
    };
    db.getFirstAsync.mockImplementation(async (sql: string, ...rest: unknown[]) => first(sql, ...rest));
    // The detail page as first pushed read the activity synchronously; answer
    // both so the counterfactual run fails for the PR's bugs, not for the fake.
    (db as any).getFirstSync = jest.fn((sql: string, ...rest: unknown[]) => first(sql, ...rest));
    return db;
}

/** Any string rendered as a direct child of a non-Text host node. */
function bareStrings(node: any, parentType: string | null = null, out: string[] = []): string[] {
    if (node == null) return out;
    if (Array.isArray(node)) {
        node.forEach((n) => bareStrings(n, parentType, out));
        return out;
    }
    if (typeof node === 'string') {
        if (parentType !== 'Text') out.push(node);
        return out;
    }
    (node.children ?? []).forEach((c: any) => bareStrings(c, node.type, out));
    return out;
}

const editButton = () => screen.getByRole('button', { name: /^edit/i });

async function renderDetail() {
    const onClose = jest.fn();
    await render(<ActivityInsightsDetail activity={walk} onClose={onClose} />);
    return { onClose };
}

let alertSpy: jest.SpyInstance;

beforeEach(() => {
    jest.clearAllMocks();
    resetWriteLayer();
    freezeNow();
    rows = new Map([[walk.id, { ...walk }]]);
    entryRows = [
        { id: 1, date: '2026-06-10T12:00:00.000Z', mood: 7 },
        { id: 2, date: '2026-06-12T12:00:00.000Z', mood: 8 },
    ];
    mockCurrentDb = installDb();
    mockUpdateActivity.mockImplementation(async (_db, id: number, name: string) => {
        rows.set(id, { ...rows.get(id)!, name });
        return { success: true, message: 'ok' };
    });
    mockMoveActivityToGroup.mockImplementation(async (_db, id: number, groupId: number) => {
        rows.set(id, { ...rows.get(id)!, group_id: groupId });
        return { success: true, message: 'ok' };
    });
    mockDeleteActivity.mockImplementation(async (_db, id: number) => {
        rows.delete(id);
        return { success: true, message: 'ok' };
    });
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => {
    alertSpy.mockRestore();
});

describe('ActivityInsightsDetail: edit from the detail page', () => {
    it('(a) with entries it renders the page and no bare text outside a <Text>', async () => {
        await renderDetail();
        await waitFor(() => expect(screen.getByText('Mood when logging Walk')).toBeTruthy());

        expect(bareStrings(screen.toJSON())).toEqual([]);
    });

    it('(b) with 0 entries the pencil opens the editor', async () => {
        entryRows = [];
        await renderDetail();
        await waitFor(() => expect(screen.getByText('No Walk entries yet')).toBeTruthy());

        await act(async () => {
            fireEvent.press(editButton());
        });

        expect(screen.getByText('Edit Activity')).toBeTruthy();
        expect(bareStrings(screen.toJSON())).toEqual([]);
    });

    it('(c) rename + move: the title and the group subtitle follow the edit', async () => {
        await renderDetail();
        await waitFor(() => expect(screen.getByText('Exercise')).toBeTruthy());

        await act(async () => {
            fireEvent.press(editButton());
        });
        await act(async () => {
            fireEvent.changeText(screen.getByDisplayValue('Walk'), 'Evening walk');
        });
        await act(async () => {
            fireEvent.press(screen.getByLabelText('Move activity to another group'));
        });
        await act(async () => {
            fireEvent.press(screen.getByLabelText('Move to Social'));
        });
        await act(async () => {
            fireEvent.press(screen.getByText('Update'));
        });

        expect(mockUpdateActivity).toHaveBeenCalledWith(mockCurrentDb, 5, 'Evening walk', 'Feather', 'activity');
        expect(mockMoveActivityToGroup).toHaveBeenCalledWith(mockCurrentDb, 5, 2);
        await waitFor(() => expect(screen.queryByText('Edit Activity')).toBeNull());
        await waitFor(() => expect(screen.getByText('Social')).toBeTruthy());
        expect(screen.getAllByText('Evening walk').length).toBeGreaterThan(0);
        expect(screen.queryByText('Exercise')).toBeNull();
    });

    it('(d) delete: the detail page closes', async () => {
        const { onClose } = await renderDetail();
        await waitFor(() => expect(screen.getByText('Mood when logging Walk')).toBeTruthy());

        await act(async () => {
            fireEvent.press(editButton());
        });
        await act(async () => {
            fireEvent.press(screen.getByText('Delete'));
        });

        // Confirm in the native alert: press its destructive button.
        const confirm = alertSpy.mock.calls.find((c) => c[0] === 'Delete Activity');
        expect(confirm).toBeTruthy();
        const destructive = (confirm![2] as { text: string; onPress?: () => unknown }[]).find(
            (b) => b.text === 'Delete'
        );
        await act(async () => {
            await destructive!.onPress!();
        });

        expect(mockDeleteActivity).toHaveBeenCalledWith(mockCurrentDb, 5);
        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    });
});

describe('ActivityInsightsDetail: header', () => {
    it('the title is one line and its block can shrink, so the pencil and X stay on screen', async () => {
        rows.set(5, { ...walk, name: 'A really quite long activity name here!!' });
        await render(
            <ActivityInsightsDetail activity={{ ...walk, name: 'A really quite long activity name here!!' }} onClose={jest.fn()} />
        );
        await waitFor(() => expect(screen.getByText('Exercise')).toBeTruthy());

        const titles = screen.getAllByText('A really quite long activity name here!!');
        const topTitle = titles[0];
        expect(topTitle.props.numberOfLines).toBe(1);
        // Its wrapper shrinks (instead of pushing the buttons off the edge)
        // and the pencil never does.
        const block = StyleSheet.flatten(topTitle.parent!.props.style);
        expect(block).toMatchObject({ flexShrink: 1, minWidth: 0 });
        expect(StyleSheet.flatten(editButton().props.style)).toMatchObject({ flexShrink: 0 });
        expect(screen.getByText('Exercise').props.numberOfLines).toBe(1);
        expect(editButton()).toBeTruthy();
        expect(screen.getByLabelText('Close activity insights')).toBeTruthy();
    });

    it('the pencil is disabled until the page has loaded', async () => {
        let release!: () => void;
        const gate = new Promise<void>((r) => (release = r));
        const realAll = mockCurrentDb.getAllAsync.getMockImplementation()!;
        mockCurrentDb.getAllAsync.mockImplementation(async (sql: string, ...rest: unknown[]) => {
            await gate;
            return realAll(sql, ...rest);
        });
        await renderDetail();

        expect(editButton().props.accessibilityState).toMatchObject({ disabled: true });
        await act(async () => {
            release();
        });
        await waitFor(() =>
            expect(editButton().props.accessibilityState).toMatchObject({ disabled: false })
        );
    });
});
