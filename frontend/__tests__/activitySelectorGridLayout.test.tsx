/**
 * ActivitySelector — the entry form's activity grid must RESERVE its layout
 * height, so a group's chips can never be drawn on top of the next group's
 * header.
 *
 * REGRESSION (Pixel 3 QA, 2026-09-03, light theme): "Emotions" / "Social" /
 * "Activities" headers sat across the icon row of the group above them. Two
 * causes, both covered here:
 *
 *  1. `Sortable.Grid` lays itself out ABSOLUTELY and only knows its height after
 *     an async measurement pass; until then it occupies ~0dp while still painting
 *     its chips (its default `overflow` is 'visible'). The section now applies a
 *     `minHeight` computed from the item count, which is known on the first
 *     render. -> "reserves the grid's height".
 *  2. `loadActivities` awaited the groups and the activities separately, so React
 *     published a render with the groups present and their activities missing;
 *     every group mounted an EMPTY grid, which is exactly the state that primes
 *     the grid's container height at 0. -> "never renders a group before its
 *     activities".
 *
 * The overlap itself is only observable on a device (it needs the library's real
 * absolute layout), but BOTH of its causes are structural and asserted here.
 *
 * RNTL 14 is async-by-default in this repo (tasks/lessons.md 2026-08-29): every
 * render() below is awaited.
 */
import React from 'react';
import { Dimensions, StyleSheet } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';

// ── Sortable.Grid passthrough; records every grid render in order ─────────────
type GridProps = {
    data: unknown[];
    renderItem: (info: { item: unknown }) => React.ReactElement;
    keyExtractor?: (item: unknown) => string;
};
const gridRenders: { current: GridProps[] } = { current: [] };

jest.mock('react-native-sortables', () => {
    const ReactActual = require('react') as typeof React;
    const { View } = require('react-native');
    return {
        __esModule: true,
        default: {
            Grid: (props: GridProps) => {
                gridRenders.current.push(props);
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

jest.mock('@/components/OverlayModal', () => ({ OverlayModal: () => null }));
jest.mock('@/components/OverlayPopover', () => ({ OverlayPopover: () => null }));
jest.mock('@/lib/haptics', () => ({
    hapticDragStart: jest.fn(),
    hapticReorderTick: jest.fn(),
    hapticDragEnd: jest.fn(),
}));

const mockGetActivityGroups = jest.fn();
const mockGetActivities = jest.fn();
jest.mock('@/databases/database', () => ({
    getActivityGroups: (...a: unknown[]) => mockGetActivityGroups(...a),
    getActivities: (...a: unknown[]) => mockGetActivities(...a),
    addActivity: jest.fn(),
    addActivityGroup: jest.fn(),
    renameActivityGroup: jest.fn(),
    reorderActivityGroups: jest.fn(),
    deleteActivityGroup: jest.fn(),
    updateActivityPositions: jest.fn(),
    getGroupDeletionImpact: jest.fn(),
    moveActivitiesToGroup: jest.fn(),
}));

const mockDb = { getAllAsync: jest.fn().mockResolvedValue([]) };
jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => mockDb }));

import { ActivitySelector } from '@/components/forms/ActivitySelector';
import {
    ACTIVITY_CHIP_CIRCLE_SIZE,
    ACTIVITY_CHIP_LABEL_BLOCK,
    ACTIVITY_CHIP_LABEL_GAP,
    ACTIVITY_CHIP_LABEL_LINE_HEIGHT,
    activityGridReservedHeight,
} from '@/components/forms/activityGridMetrics';
import type { Activity, ActivityGroup } from '@/components/types';

const GROUPS: ActivityGroup[] = [
    { id: 1, name: 'Emotions', sort_order: 1 },
    { id: 2, name: 'Sleep', sort_order: 2 },
    { id: 3, name: 'Empty', sort_order: 3 },
];

/** 7 chips in group 1 (two rows), 3 in group 2 (one row), 0 in group 3. */
const ACTIVITIES: Activity[] = [
    ...Array.from({ length: 7 }, (_, i) => ({
        id: 100 + i,
        name: `Feeling ${i}`,
        group_id: 1,
        position: i + 1,
        icon_family: 'Feather',
        icon_name: 'circle',
    })),
    ...Array.from({ length: 3 }, (_, i) => ({
        id: 200 + i,
        name: `Sleep ${i}`,
        group_id: 2,
        position: i + 1,
        icon_family: 'Feather',
        icon_name: 'moon',
    })),
] as Activity[];

const renderSelector = async () => {
    const view = await render(
        <ActivitySelector onSelectActivity={jest.fn()} selectedActivities={[]} />
    );
    await waitFor(() => expect(view.getByText('Emotions')).toBeTruthy());
    return view;
};

beforeEach(() => {
    jest.clearAllMocks();
    gridRenders.current = [];
    mockGetActivityGroups.mockResolvedValue(GROUPS);
    mockGetActivities.mockResolvedValue(ACTIVITIES);
});

describe('the grid reserves its own layout height', () => {
    it('gives each group a minHeight matching its chip count', async () => {
        const view = await renderSelector();

        const minHeightOf = (groupId: number) =>
            StyleSheet.flatten(view.getByTestId(`activity-grid-${groupId}`).props.style)
                .minHeight;

        // The selector reserves at the LIVE OS font scale (useWindowDimensions),
        // so the expectation has to be taken at the same scale — asserting a bare
        // number here would only be testing the harness's simulated density.
        const { fontScale } = Dimensions.get('window');

        expect(minHeightOf(1)).toBe(activityGridReservedHeight(7, fontScale));
        expect(minHeightOf(2)).toBe(activityGridReservedHeight(3, fontScale));
        // Nothing to spill, nothing to reserve.
        expect(minHeightOf(3)).toBe(0);
    });

    it('reserves strictly more room for a group that wraps onto a second row', async () => {
        const view = await renderSelector();

        const two = StyleSheet.flatten(
            view.getByTestId('activity-grid-1').props.style
        ).minHeight as number;
        const one = StyleSheet.flatten(
            view.getByTestId('activity-grid-2').props.style
        ).minHeight as number;

        expect(two).toBeGreaterThan(one);
        expect(one).toBeGreaterThan(0);
    });

    /**
     * ANTI-DRIFT: the reservation is only correct while the chip is actually the
     * size the metrics claim. Assert the RENDERED chip styles against the same
     * constants, so restyling the chip without re-deriving the reservation fails
     * here instead of on a device.
     */
    it('renders chips at the size the reservation assumes', async () => {
        const view = await renderSelector();

        const label = StyleSheet.flatten(view.getByText('Feeling 0').props.style);
        expect(label.lineHeight).toBe(ACTIVITY_CHIP_LABEL_LINE_HEIGHT);
        // A one-line and a two-line label must occupy the same box, or rows stop
        // being uniform and the reservation stops being derivable from the count.
        expect(label.minHeight).toBe(ACTIVITY_CHIP_LABEL_BLOCK);

        const circle = StyleSheet.flatten(
            view.getByTestId('activity-chip-icon-100').props.style
        );
        expect(circle.height).toBe(ACTIVITY_CHIP_CIRCLE_SIZE);
        expect(circle.width).toBe(ACTIVITY_CHIP_CIRCLE_SIZE);

        const wrapper = StyleSheet.flatten(
            view.getByTestId('activity-chip-icon-100').parent?.props.style
        );
        expect(wrapper.gap).toBe(ACTIVITY_CHIP_LABEL_GAP);
        // Row spacing belongs to the grid's rowGap alone: a margin here would sit
        // outside the measured chip and desync the reservation from reality.
        expect(wrapper.marginBottom).toBeUndefined();
    });
});

describe('a group is never rendered before its activities', () => {
    /**
     * The activities read is deliberately made SLOWER than the groups read. With
     * the two reads awaited one after the other, that ordering is what published
     * a groups-only render — every group mounting an empty grid. Awaiting them
     * together makes the gap unobservable no matter which read wins.
     */
    it('never mounts a grid for a populated group with no data in it', async () => {
        mockGetActivities.mockImplementation(
            () => new Promise((resolve) => setTimeout(() => resolve(ACTIVITIES), 10))
        );

        await renderSelector();

        expect(mockGetActivityGroups).toHaveBeenCalledTimes(1);
        expect(mockGetActivities).toHaveBeenCalledTimes(1);

        // Groups 1 and 2 have activities, group 3 legitimately has none — so every
        // render pass must contribute exactly two populated grids and one empty
        // one. A groups-before-activities render shows up as a pass of three
        // empty grids, which breaks that 2:1 ratio.
        expect(gridRenders.current.length).toBeGreaterThan(0);
        const sizes = gridRenders.current.map((g) => g.data.length);
        expect(sizes.filter((n) => n > 0)).toHaveLength(
            2 * sizes.filter((n) => n === 0).length
        );
        expect(new Set(sizes)).toEqual(new Set([7, 3, 0]));
    });
});
