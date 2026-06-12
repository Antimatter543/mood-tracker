/**
 * Tests for ActivityReorder — the per-group activity-management HUB reached via
 * the group "..." -> "Edit Activities" menu. It is the (only) path to EDIT an
 * activity now that the main-grid drag gesture swallows the chip long-press that
 * used to open the editor (react-native-sortables dragActivationDelay races and
 * cancels a Pressable long-press). The hub keeps the up/down reorder arrows as an
 * accessible fallback AND makes each row tappable to open the big edit modal.
 *
 * Uses @testing-library/react-native. useThemeColors() resolves to the default
 * theme without a SettingsProvider (SettingsContext has a non-null default), and
 * @expo/vector-icons render fine under jest-expo, so no extra mocking is needed.
 */
import React from 'react';
import { render, act, fireEvent } from '@testing-library/react-native';

// ActivityReorder pulls IconPicker -> OverlayModal -> react-native-reanimated,
// which initializes the native worklets runtime at import (unavailable under
// jest). We only exercise Feather/MaterialIcons rendering + presses, never a
// real animation, so shim exactly the surface OverlayModal uses (Animated.View
// + FadeIn.duration). Same pattern as overlayPopover.test.tsx, scoped here.
jest.mock('react-native-reanimated', () => {
    const ReactLocal = require('react');
    const { View } = require('react-native');
    const entering = { duration: () => entering };
    return {
        __esModule: true,
        default: {
            View: (props: Record<string, unknown>) => ReactLocal.createElement(View, props),
        },
        FadeIn: entering,
    };
});

import ActivityReorder from '@/components/forms/ActivityReorder';
import type { Activity } from '@/components/types';

const act1: Activity = { id: 1, name: 'Running', group_id: 1, position: 1, icon_family: 'Feather', icon_name: 'activity' } as Activity;
const act2: Activity = { id: 2, name: 'Reading', group_id: 1, position: 2, icon_family: 'Feather', icon_name: 'book' } as Activity;
const act3: Activity = { id: 3, name: 'Coding', group_id: 1, position: 3, icon_family: 'Feather', icon_name: 'code' } as Activity;

// render() is async in this project's jest-expo / concurrent-React setup (same
// reason overlayPopover.test.tsx awaits render + act), so the helper is async
// and returns the awaited query bundle.
const renderHub = async (overrides: Partial<React.ComponentProps<typeof ActivityReorder>> = {}) => {
    const onReorder = jest.fn();
    const onClose = jest.fn();
    const onEditActivity = jest.fn();
    const view = await render(
        <ActivityReorder
            activities={[act1, act2, act3]}
            onReorder={onReorder}
            onClose={onClose}
            onEditActivity={onEditActivity}
            {...overrides}
        />
    );
    return { view, onReorder, onClose, onEditActivity };
};

describe('ActivityReorder — edit hub', () => {
    it('renders one tappable, clearly-editable row per activity', async () => {
        const { view } = await renderHub();
        // Each row exposes an accessible "Edit <name>" affordance.
        expect(view.getByLabelText('Edit Running')).toBeTruthy();
        expect(view.getByLabelText('Edit Reading')).toBeTruthy();
        expect(view.getByLabelText('Edit Coding')).toBeTruthy();
        // The header now reads "Edit Activities" (drag owns reordering on the grid).
        expect(view.getByText('Edit Activities')).toBeTruthy();
    });

    it('tapping a row opens the editor for THAT activity', async () => {
        const { view, onEditActivity } = await renderHub();
        await act(async () => {
            fireEvent.press(view.getByLabelText('Edit Reading'));
        });
        expect(onEditActivity).toHaveBeenCalledTimes(1);
        expect(onEditActivity).toHaveBeenCalledWith(act2);
    });

    it('keeps the up/down arrows as a working reorder fallback (Save persists the new order)', async () => {
        const { view, onReorder, onClose } = await renderHub();
        // Move "Coding" (last) up one: order becomes Running, Coding, Reading.
        await act(async () => {
            fireEvent.press(view.getByLabelText('Move Coding up'));
        });
        await act(async () => {
            fireEvent.press(view.getByLabelText('Save activity order'));
        });
        expect(onReorder).toHaveBeenCalledTimes(1);
        const newOrder = onReorder.mock.calls[0][0] as Activity[];
        expect(newOrder.map((a) => a.id)).toEqual([1, 3, 2]);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not call onEditActivity when only reordering', async () => {
        const { view, onEditActivity } = await renderHub();
        await act(async () => {
            fireEvent.press(view.getByLabelText('Move Running down'));
        });
        expect(onEditActivity).not.toHaveBeenCalled();
    });
});
