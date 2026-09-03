/**
 * GROUP MOVE MODE (components/forms/GroupReorder.tsx) — the collapsed
 * drag-to-reorder view entered by holding a group's name.
 *
 * `react-native-sortables` is mocked with a passthrough that renders every row
 * AND captures the drag callbacks, so the test can fire a "drop" without a real
 * gesture (a worklet/RNGH drag is not drivable in jest). That is the honest
 * boundary here: this suite proves the WIRING — what the component renders, what
 * it hands back on drop, and that the haptics fire at the right moments — while
 * the gesture itself is device-QA territory.
 *
 * RNTL 14 is async-by-default in this repo (tasks/lessons.md 2026-08-29): every
 * render() and fireEvent.*() below is awaited.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

// Captures the props the real Sortable.Grid would have received, so a test can
// invoke onDragStart / onOrderChange / onDragEnd directly.
type GridProps = {
    data: unknown[];
    renderItem: (info: { item: unknown }) => React.ReactElement;
    keyExtractor?: (item: unknown) => string;
    onDragStart?: () => void;
    onOrderChange?: () => void;
    onDragEnd?: (params: { data: unknown[] }) => void;
    columns?: number;
    dragActivationDelay?: number;
    autoScrollEnabled?: boolean;
};
const gridBox: { current: GridProps | null } = { current: null };

jest.mock('react-native-sortables', () => {
    const ReactActual = require('react') as typeof React;
    const { View } = require('react-native');
    return {
        __esModule: true,
        default: {
            Grid: (props: GridProps) => {
                gridBox.current = props;
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

const mockHapticDragStart = jest.fn();
const mockHapticReorderTick = jest.fn();
const mockHapticDragEnd = jest.fn();
jest.mock('@/lib/haptics', () => ({
    hapticDragStart: () => mockHapticDragStart(),
    hapticReorderTick: () => mockHapticReorderTick(),
    hapticDragEnd: () => mockHapticDragEnd(),
}));

import GroupReorder from '@/components/forms/GroupReorder';
import type { ActivityGroup } from '@/components/types';

const groups: ActivityGroup[] = [
    { id: 1, name: 'Exercise', sort_order: 1 },
    { id: 2, name: 'Social', sort_order: 2 },
    { id: 3, name: 'Chores', sort_order: 3 },
];

const grid = () => {
    if (!gridBox.current) throw new Error('Sortable.Grid was never rendered');
    return gridBox.current;
};

const renderReorder = async (overrides: Partial<React.ComponentProps<typeof GroupReorder>> = {}) => {
    const onReorder = jest.fn();
    const onDone = jest.fn();
    const view = await render(
        <GroupReorder groups={groups} onReorder={onReorder} onDone={onDone} {...overrides} />
    );
    return { view, onReorder, onDone };
};

beforeEach(() => {
    gridBox.current = null;
    jest.clearAllMocks();
});

describe('GroupReorder — the collapsed move-mode surface', () => {
    it('renders ONLY the group names (no activity chips) plus the exit affordance', async () => {
        const { view } = await renderReorder();

        expect(view.getByText('Exercise')).toBeTruthy();
        expect(view.getByText('Social')).toBeTruthy();
        expect(view.getByText('Chores')).toBeTruthy();
        expect(view.getByText('Done')).toBeTruthy();
        expect(view.getByText('Reorder groups')).toBeTruthy();
    });

    it('tells the user HOW to move a row (the gesture is invisible otherwise)', async () => {
        const { view } = await renderReorder();
        expect(view.getByText(/hold a group/i)).toBeTruthy();
    });

    it('hands the grid the groups in the supplied order, one per row', async () => {
        await renderReorder();
        expect(grid().columns).toBe(1);
        expect(grid().data).toEqual(groups);
    });

    it('keys rows by group id so a reorder animates rows rather than recycling them', async () => {
        await renderReorder();
        expect(grid().keyExtractor?.(groups[1])).toBe('2');
    });

    it('Done exits move mode and NEVER writes (the order already persisted on drop)', async () => {
        const { view, onDone, onReorder } = await renderReorder();

        await fireEvent.press(view.getByText('Done'));

        expect(onDone).toHaveBeenCalledTimes(1);
        expect(onReorder).not.toHaveBeenCalled();
    });

    it('persists ON DROP, handing back the fully reordered array', async () => {
        const { onReorder } = await renderReorder();

        const dropped = [groups[2], groups[0], groups[1]];
        grid().onDragEnd?.({ data: dropped });

        expect(onReorder).toHaveBeenCalledTimes(1);
        expect(onReorder).toHaveBeenCalledWith(dropped);
    });

    it('buzzes on pickup, ticks on each order change, and buzzes on release', async () => {
        await renderReorder();

        grid().onDragStart?.();
        expect(mockHapticDragStart).toHaveBeenCalledTimes(1);

        grid().onOrderChange?.();
        grid().onOrderChange?.();
        expect(mockHapticReorderTick).toHaveBeenCalledTimes(2);

        grid().onDragEnd?.({ data: groups });
        expect(mockHapticDragEnd).toHaveBeenCalledTimes(1);
    });

    it('renders an empty-state instead of a bare grid when there are no groups', async () => {
        const { view } = await renderReorder({ groups: [] });
        expect(view.getByText('No groups to reorder yet.')).toBeTruthy();
        expect(gridBox.current).toBeNull();
    });

    it('only enables auto-scroll when a scroll container was actually provided', async () => {
        await renderReorder();
        expect(grid().autoScrollEnabled).toBe(false);
    });
});
