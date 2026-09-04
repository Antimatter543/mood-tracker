/**
 * ActivitySelector, a chip label must never break INSIDE a word.
 *
 * REGRESSION (Pixel 3 QA, 2026-09-04, store capture `10-entry-form.png`): the
 * entry form's "What did you do?" grid rendered "Unmotivated" as
 * "Unmotivate / d" and "Overwhelmed" as "Overwhelm / ed". The chip cell is
 * ~59dp wide and `numberOfLines={2}` lets Android split a word it cannot fit on
 * one line, so any name with a word past ~10 characters shredded, and a
 * user-created activity name can be arbitrarily long.
 *
 * The fix computes the label's size (see `activityGridMetrics.ts`) rather than
 * asking React Native to autosize it: `adjustsFontSizeToFit` only engages on
 * text that OVERFLOWS its line budget, and a mid-word break means the text
 * already "fits" two lines, it would never have fired on this bug.
 *
 * These assertions read the RENDERED chip, so they also lock the wiring: the
 * cell width has to reach the label for the shrink to happen at all.
 *
 * RNTL 14 is async-by-default in this repo (tasks/lessons.md 2026-08-29): every
 * render() below is awaited.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { Dimensions, StyleSheet } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';

// ── Sortable.Grid passthrough (same shape as activitySelectorGridLayout) ──────
type GridProps = {
    data: unknown[];
    renderItem: (info: { item: unknown }) => React.ReactElement;
    keyExtractor?: (item: unknown) => string;
};

jest.mock('react-native-sortables', () => {
    const ReactActual = require('react') as typeof React;
    const { View } = require('react-native');
    return {
        __esModule: true,
        default: {
            Grid: (props: GridProps) =>
                ReactActual.createElement(
                    View,
                    null,
                    props.data.map((item, i) =>
                        ReactActual.createElement(
                            View,
                            { key: props.keyExtractor?.(item) ?? String(i) },
                            props.renderItem({ item })
                        )
                    )
                ),
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
    ACTIVITY_CHIP_LABEL_BLOCK,
    ACTIVITY_CHIP_LABEL_FONT_SIZE,
    ACTIVITY_CHIP_LABEL_LINE_HEIGHT,
    ACTIVITY_CHIP_LABEL_LINES,
    ACTIVITY_GRID_HORIZONTAL_INSET,
    activityChipCellWidth,
    activityChipLabelLayout,
} from '@/components/forms/activityGridMetrics';
import type { Activity, ActivityGroup } from '@/components/types';

/** Pixel 3, portrait: 1080px at density 2.75, the device that shredded them. */
const PIXEL_3 = { width: 392.7, height: 786.4, scale: 2.75, fontScale: 1 };

const GROUPS: ActivityGroup[] = [{ id: 1, name: 'Emotions', sort_order: 1 }];

/** Two names that broke on the device, one two-word name, one short name. */
const NAMES = ['Unmotivated', 'Overwhelmed', 'Social event', 'Happy'];
const ACTIVITIES: Activity[] = NAMES.map((name, i) => ({
    id: 100 + i,
    name,
    group_id: 1,
    position: i + 1,
    icon_family: 'Feather',
    icon_name: 'circle',
})) as Activity[];

const renderSelector = async () => {
    const view = await render(
        <ActivitySelector onSelectActivity={jest.fn()} selectedActivities={[]} />
    );
    await waitFor(() => expect(view.getByText('Emotions')).toBeTruthy());
    return view;
};

beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Dimensions, 'get').mockReturnValue(PIXEL_3 as never);
    mockGetActivityGroups.mockResolvedValue(GROUPS);
    mockGetActivities.mockResolvedValue(ACTIVITIES);
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe('long activity labels shrink instead of splitting a word', () => {
    it('renders each label at the size the metrics compute for this cell', async () => {
        const view = await renderSelector();
        const cellWidth = activityChipCellWidth(PIXEL_3.width);

        for (const name of NAMES) {
            const label = view.getByText(name);
            const expected = activityChipLabelLayout(name, cellWidth, PIXEL_3.fontScale);

            // NON-VACUOUS: a composite node would swallow these props and pass
            // forever (tasks/lessons.md, RNTL 14). Assert we hold the host Text
            // and that it really carries the prop before believing its value.
            expect(typeof label.type).toBe('string');
            expect(label.props.numberOfLines).toBeDefined();

            expect(label.props.numberOfLines).toBe(expected.numberOfLines);
            expect(StyleSheet.flatten(label.props.style).fontSize).toBe(expected.fontSize);
            expect(label.props.ellipsizeMode).toBe('tail');
        }
    });

    it('shrinks the two that shredded and leaves the rest at full size', async () => {
        const view = await renderSelector();
        const fontSizeOf = (name: string) =>
            StyleSheet.flatten(view.getByText(name).props.style).fontSize as number;

        expect(fontSizeOf('Unmotivated')).toBeLessThan(ACTIVITY_CHIP_LABEL_FONT_SIZE);
        expect(fontSizeOf('Overwhelmed')).toBeLessThan(ACTIVITY_CHIP_LABEL_FONT_SIZE);
        // A two-word name wraps at the SPACE, which was never the problem, it
        // must not be shrunk as collateral.
        expect(fontSizeOf('Social event')).toBe(ACTIVITY_CHIP_LABEL_FONT_SIZE);
        expect(fontSizeOf('Happy')).toBe(ACTIVITY_CHIP_LABEL_FONT_SIZE);
    });

    it('keeps every chip in the row exactly the same height', async () => {
        const view = await renderSelector();

        for (const name of NAMES) {
            const style = StyleSheet.flatten(view.getByText(name).props.style);
            // The label box is fixed at two lines regardless of the font size, so
            // a shrunk chip cannot make its row shorter than its neighbours (and
            // `activityGridReservedHeight` stays derivable from the item count).
            expect(style.lineHeight).toBe(ACTIVITY_CHIP_LABEL_LINE_HEIGHT);
            expect(style.minHeight).toBe(ACTIVITY_CHIP_LABEL_BLOCK);
            expect(view.getByText(name).props.numberOfLines).toBeLessThanOrEqual(
                ACTIVITY_CHIP_LABEL_LINES
            );
        }
    });

    it('lets the OS font scale grow the label until the cell runs out', async () => {
        jest.spyOn(Dimensions, 'get').mockReturnValue({
            ...PIXEL_3,
            fontScale: 1.3,
        } as never);
        const view = await renderSelector();
        const cellWidth = activityChipCellWidth(PIXEL_3.width);

        for (const name of NAMES) {
            const style = StyleSheet.flatten(view.getByText(name).props.style);
            expect(style.fontSize).toBe(
                activityChipLabelLayout(name, cellWidth, 1.3).fontSize
            );
            // allowFontScaling stays ON (never disabled to buy room), so React
            // Native multiplies whatever is in the style by 1.3 on screen.
            expect(view.getByText(name).props.allowFontScaling).not.toBe(false);
        }
        // A larger system font still costs the longest words some size.
        expect(
            StyleSheet.flatten(view.getByText('Unmotivated').props.style).fontSize
        ).toBeLessThan(
            StyleSheet.flatten(view.getByText('Happy').props.style).fontSize as number
        );
    });
});

/**
 * SOURCE-LEVEL GUARD. The cell width is derived, not measured, so it depends on
 * the padding of the ONE screen that mounts this grid. If the entry form's
 * content padding changes, the constant has to change with it, otherwise every
 * label silently sizes itself against a cell that no longer exists.
 */
describe('the derived cell width matches the screen that renders it', () => {
    it('accounts for the entry form padding plus the grid padding', async () => {
        const view = await renderSelector();
        const gridPadding = StyleSheet.flatten(
            view.getByTestId('activity-grid-1').props.style
        ).paddingHorizontal as number;

        const entryForm = fs.readFileSync(
            path.join(__dirname, '..', 'components', 'forms', 'EntryForm.tsx'),
            'utf8'
        );
        const contentContainer = /contentContainer:\s*\{[\s\S]*?\n\s{8}\}/.exec(entryForm);
        expect(contentContainer).not.toBeNull();
        const formPadding = Number(
            /paddingHorizontal:\s*(\d+(?:\.\d+)?)/.exec(contentContainer![0])?.[1]
        );
        expect(Number.isFinite(formPadding)).toBe(true);

        expect(gridPadding + formPadding).toBe(ACTIVITY_GRID_HORIZONTAL_INSET);
    });
});
