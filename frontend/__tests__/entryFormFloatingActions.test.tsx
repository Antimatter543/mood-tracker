/**
 * EntryForm (details step): the floating Back / Save pair (#23).
 *
 * When a long entry pushes the inline Back + Submit row below the fold, a
 * floating pair stands in for it. These tests pin:
 *   - WHEN it shows: only while the inline row is not fully visible, worked out
 *     from layout + scroll + keyboard (no polling sensor), only on step 2;
 *   - the floating Save is the SAME guarded write as the inline Submit: a
 *     double-tap in one frame saves once (useSingleFlight), and it is disabled +
 *     busy while the write is in flight;
 *   - both buttons are labelled for screen readers, Save shows a check icon;
 *   - Back always sits LEFT of Save, for both fab_position sides.
 */
import { render, fireEvent, act } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { deferred } from '@/testing/async';

import {
    FLOATING_ACTION_EDGE_GAP,
    FLOATING_ACTION_SIZE,
    FLOATING_ACTION_BOTTOM_GAP,
    floatingActionBottom,
    floatingActionOffsets,
    isRowFullyVisible,
} from '@/components/forms/floatingActions';

jest.mock('@/styles/global', () => require('@/testing/theme').mockThemeModule());
const mockFabPosition = jest.fn(() => 'right');
jest.mock('@/context/SettingsContext', () => ({
    useSettings: () => ({
        settings: { mood_precision: 'integer', show_mood_benchmarks: false, fab_position: mockFabPosition() },
    }),
}));
jest.mock('../components/forms/MoodSelector', () => {
    const ReactActual = require('react');
    const { Text } = require('react-native');
    return { __esModule: true, default: () => ReactActual.createElement(Text, null, 'mood-selector') };
});
jest.mock('../components/forms/DatePicker', () => {
    const ReactActual = require('react');
    const { Text } = require('react-native');
    return { DatePicker: () => ReactActual.createElement(Text, null, 'date-picker') };
});
jest.mock('../components/forms/ActivitySelector', () => {
    const ReactActual = require('react');
    const { Text } = require('react-native');
    return { ActivitySelector: () => ReactActual.createElement(Text, null, 'activity-selector') };
});
// Record the icon name so the test can assert Save shows a check.
jest.mock('@expo/vector-icons/Feather', () => {
    const ReactActual = require('react');
    const { Text } = require('react-native');
    return { __esModule: true, default: ({ name }: { name: string }) => ReactActual.createElement(Text, null, `icon:${name}`) };
});

import { EntryForm } from '@/components/forms/EntryForm';

const VIEWPORT = 600;
const ROW = { y: 900, height: 50 }; // below a 600dp viewport until scrolled ~350

function scrollNode(view: any) {
    const matches = view.container.queryAll(
        (n: any) => n.props?.keyboardShouldPersistTaps === 'handled' && typeof n.props?.onScroll === 'function'
    );
    expect(matches).toHaveLength(1);
    return matches[0];
}

async function renderDetailsStepWithRowBelowFold(onSubmit: (data: any) => Promise<void> = jest.fn(async () => {})) {
    const view = await render(<EntryForm onSubmit={onSubmit} onCancel={jest.fn()} />);
    await act(async () => {
        await fireEvent.press(view.getByText('Continue'));
    });
    await act(async () => {
        await fireEvent(scrollNode(view), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 400, height: VIEWPORT } } });
        await fireEvent(view.getByTestId('entry-form-button-row'), 'layout', {
            nativeEvent: { layout: { x: 0, ...ROW, width: 360 } },
        });
    });
    return view;
}

describe('floatingActions geometry (pure)', () => {
    it('treats an unmeasured row as visible so the pair never flashes up early', () => {
        expect(isRowFullyVisible({ row: null, scrollY: 0, viewportHeight: VIEWPORT, keyboardHeight: 0 })).toBe(true);
        expect(isRowFullyVisible({ row: ROW, scrollY: 0, viewportHeight: 0, keyboardHeight: 0 })).toBe(true);
    });

    it('is hidden below the fold, visible once scrolled fully into view', () => {
        expect(isRowFullyVisible({ row: ROW, scrollY: 0, viewportHeight: VIEWPORT, keyboardHeight: 0 })).toBe(false);
        // Half on screen still counts as not visible: the floating pair stays.
        expect(isRowFullyVisible({ row: ROW, scrollY: 325, viewportHeight: VIEWPORT, keyboardHeight: 0 })).toBe(false);
        expect(isRowFullyVisible({ row: ROW, scrollY: 350, viewportHeight: VIEWPORT, keyboardHeight: 0 })).toBe(true);
        // Scrolled past it (content above the row hidden, row above the band).
        expect(isRowFullyVisible({ row: ROW, scrollY: 901, viewportHeight: VIEWPORT, keyboardHeight: 0 })).toBe(false);
    });

    it('counts the part of the viewport under the keyboard as hidden', () => {
        expect(isRowFullyVisible({ row: ROW, scrollY: 350, viewportHeight: VIEWPORT, keyboardHeight: 300 })).toBe(false);
        expect(isRowFullyVisible({ row: ROW, scrollY: 650, viewportHeight: VIEWPORT, keyboardHeight: 300 })).toBe(true);
    });

    it.each(['left', 'right'] as const)('puts Back LEFT of Save and hugs the %s edge', (side) => {
        const W = 400;
        const xOf = (o: { left: number } | { right: number }) =>
            'left' in o ? o.left : W - o.right - FLOATING_ACTION_SIZE;
        const { back, save } = floatingActionOffsets(side);
        expect(xOf(back)).toBeLessThan(xOf(save));
        // No overlap between the two buttons.
        expect(xOf(save) - xOf(back)).toBeGreaterThanOrEqual(FLOATING_ACTION_SIZE);
        if (side === 'left') expect(back).toEqual({ left: FLOATING_ACTION_EDGE_GAP });
        else expect(save).toEqual({ right: FLOATING_ACTION_EDGE_GAP });
    });

    it('sits above the nav bar, or above the keyboard when it is up', () => {
        expect(floatingActionBottom(48, 0)).toBe(48 + FLOATING_ACTION_BOTTOM_GAP);
        expect(floatingActionBottom(48, 804)).toBe(804 + FLOATING_ACTION_BOTTOM_GAP);
    });
});

describe('EntryForm floating Back / Save', () => {
    beforeEach(() => mockFabPosition.mockReturnValue('right'));

    it('mood step: no duplicate Cancel button, Continue keeps its full-width look', async () => {
        const view = await render(<EntryForm onSubmit={jest.fn()} onCancel={jest.fn()} />);
        expect(view.queryByText('Cancel')).toBeNull();
        const continueStyle = StyleSheet.flatten(
            view.getByLabelText('Continue to the details step').props.style
        );
        expect(continueStyle.width).toBe('100%');
        expect(continueStyle.borderRadius).toBe(25);
    });

    it('stays hidden while the inline row is on screen, shows when it is below the fold', async () => {
        const view = await render(<EntryForm onSubmit={jest.fn()} onCancel={jest.fn()} />);
        await act(async () => {
            await fireEvent.press(view.getByText('Continue'));
        });
        // Measured and fully visible: no floating pair.
        await act(async () => {
            await fireEvent(scrollNode(view), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 400, height: VIEWPORT } } });
            await fireEvent(view.getByTestId('entry-form-button-row'), 'layout', {
                nativeEvent: { layout: { x: 0, y: 300, width: 360, height: 50 } },
            });
        });
        expect(view.queryByTestId('entry-form-floating-save')).toBeNull();

        // A longer entry pushes the row below the fold: the pair appears.
        await act(async () => {
            await fireEvent(view.getByTestId('entry-form-button-row'), 'layout', {
                nativeEvent: { layout: { x: 0, ...ROW, width: 360 } },
            });
        });
        expect(view.getByTestId('entry-form-floating-save')).toBeTruthy();
        expect(view.getByTestId('entry-form-floating-back')).toBeTruthy();
    });

    it('hides again once the user scrolls the inline row into view', async () => {
        const view = await renderDetailsStepWithRowBelowFold();
        expect(view.getByTestId('entry-form-floating-save')).toBeTruthy();
        await act(async () => {
            await fireEvent.scroll(scrollNode(view), {
                nativeEvent: { contentOffset: { x: 0, y: 400 }, layoutMeasurement: { width: 400, height: VIEWPORT } },
            });
        });
        expect(view.queryByTestId('entry-form-floating-save')).toBeNull();
    });

    it('labels both buttons, and Save shows a check (not a forward chevron)', async () => {
        const view = await renderDetailsStepWithRowBelowFold();
        const save = view.getByLabelText('Save entry');
        const back = view.getByLabelText('Back to mood');
        expect(save.props.accessibilityRole).toBe('button');
        expect(back.props.accessibilityRole).toBe('button');
        expect(view.getByTestId('entry-form-floating-save')).toHaveTextContent('icon:check');
    });

    it('floating Save writes ONCE on a double-tap in the same frame', async () => {
        const gate = deferred();
        const onSubmit = jest.fn(() => gate.promise);
        const view = await renderDetailsStepWithRowBelowFold(onSubmit);
        const save = view.getByTestId('entry-form-floating-save');

        await act(async () => {
            const first = fireEvent.press(save);
            const second = fireEvent.press(save);
            gate.resolve();
            await Promise.all([first, second]);
        });

        expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    it('floating Save is disabled + busy while the write is in flight', async () => {
        const gate = deferred();
        const onSubmit = jest.fn(() => gate.promise);
        const view = await renderDetailsStepWithRowBelowFold(onSubmit);
        expect(view.getByTestId('entry-form-floating-save').props.accessibilityState).toEqual({
            disabled: false,
            busy: false,
        });

        let pressed!: Promise<void>;
        await act(async () => {
            pressed = fireEvent.press(view.getByTestId('entry-form-floating-save'));
        });
        expect(view.getByTestId('entry-form-floating-save').props.accessibilityState).toEqual({
            disabled: true,
            busy: true,
        });

        await act(async () => {
            gate.resolve();
            await pressed;
        });
    });

    it('floating Back returns to the mood step and the pair goes away', async () => {
        const view = await renderDetailsStepWithRowBelowFold();
        await act(async () => {
            await fireEvent.press(view.getByTestId('entry-form-floating-back'));
        });
        expect(view.getByText('How were you?')).toBeTruthy();
        expect(view.queryByTestId('entry-form-floating-back')).toBeNull();
        expect(view.queryByTestId('entry-form-floating-save')).toBeNull();
    });

    it.each(['left', 'right'] as const)('renders Back left of Save with fab_position=%s', async (side) => {
        mockFabPosition.mockReturnValue(side);
        const view = await renderDetailsStepWithRowBelowFold();
        const style = (id: string) => StyleSheet.flatten(view.getByTestId(id).props.style);
        const { back, save } = floatingActionOffsets(side);
        expect(style('entry-form-floating-back')).toMatchObject(back);
        expect(style('entry-form-floating-save')).toMatchObject(save);
        // Never both sides at once (the old `[fabPosition]` key + a stale one).
        const other = side === 'left' ? 'right' : 'left';
        expect(style('entry-form-floating-back')[other]).toBeUndefined();
        expect(style('entry-form-floating-save')[other]).toBeUndefined();
    });
});
