/**
 * UndoSnackbar — the structural properties that decide whether a real finger can
 * actually USE it.
 *
 * Device QA (2026-09-03) found the UNDO button unresponsive to taps at
 * uiautomator-verified coordinates, while `timelineUndoDelete.test.tsx` proved
 * the whole JS callback chain (press -> restoreMoodEntry -> reload -> dismiss)
 * green. So the failure was below JS, in how this component presents itself to
 * Android's touch dispatch — and that layer is exactly what a component test
 * CAN'T simulate. What it can do is lock the three structural choices that were
 * the plausible causes, so none of them can quietly come back:
 *
 *   1. an action target that meets the 48dp platform minimum (it was ~60x28dp),
 *   2. `pointerEvents` declared on a plain View, never on the reanimated one —
 *      the snackbar was the only overlay in the app that did the latter, and
 *      the only one that was dead,
 *   3. no `exiting` layout animation keeping a reanimated-owned view alive on
 *      top of the UI after unmount.
 *
 * Real touch dispatch stays a device question; these keep the regression from
 * being re-introduced by a restyle. RNTL 14: `render` / `fireEvent` are ASYNC.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, act, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 48, left: 0, right: 0 }),
}));

// Reanimated's worklet runtime is unavailable under jest. The mock renders a
// plain View and — crucially — forwards every prop, so the assertions below can
// see whether an `exiting` animation was passed.
jest.mock('react-native-reanimated', () => {
    const ReactLocal = require('react');
    const { View } = require('react-native');
    const anim = { duration: () => anim };
    return {
        __esModule: true,
        default: {
            View: (props: Record<string, unknown>) => ReactLocal.createElement(View, props),
        },
        FadeIn: anim,
        FadeInDown: anim,
        FadeOutDown: anim,
    };
});

const THEME = {
    background: '#000',
    cardBackground: '#111',
    secondaryBackground: '#222',
    text: '#fff',
    textSecondary: '#aaa',
    border: '#333',
    accent: '#4CAF50',
    overlays: { tag: '#222', tagBorder: '#333', border: '#333', textSecondary: '#aaa' },
    elevation: { shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, elevation: 6 },
    isDark: true,
};
jest.mock('@/styles/global', () => ({ useThemeColors: () => THEME }));

import { OverlayProvider } from '@/context/OverlayHost';
import {
    MIN_TOUCH_TARGET,
    UNDO_SNACKBAR_DURATION_MS,
    UndoSnackbar,
} from '@/components/UndoSnackbar';

const flatStyle = (node: any) => StyleSheet.flatten(node?.props?.style) || {};

type Handlers = { onAction: jest.Mock; onDismiss: jest.Mock };

// RNTL 14's `render` is async — awaiting it is what makes the returned queries
// exist at all (an un-awaited render hands back a Promise and every `queryBy*`
// is "not a function").
const renderSnackbar = async (overrides: Partial<Handlers> = {}) => {
    const handlers: Handlers = {
        onAction: overrides.onAction ?? jest.fn(),
        onDismiss: overrides.onDismiss ?? jest.fn(),
    };
    const view = await render(
        <OverlayProvider>
            <UndoSnackbar
                visible
                message="Entry moved to the bin"
                actionLabel="Undo"
                onAction={handlers.onAction}
                onDismiss={handlers.onDismiss}
            />
        </OverlayProvider>
    );
    return { view, handlers };
};

afterEach(() => jest.useRealTimers());

describe('UndoSnackbar — touch target', () => {
    it('the action meets the 48dp minimum on BOTH axes', async () => {
        const { view } = await renderSnackbar();
        await waitFor(() => expect(view.queryByTestId('undo-snackbar-action')).not.toBeNull());

        const style = flatStyle(view.getByTestId('undo-snackbar-action'));
        // The regression: padding around a 14px label gave ~60x28dp. Horizontal
        // padding happened to clear it; the VERTICAL axis never did, which is
        // the axis a thumb reaching the bottom of the screen misses on.
        expect(style.minHeight).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
        expect(style.minWidth).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
        expect(MIN_TOUCH_TARGET).toBeGreaterThanOrEqual(44); // WCAG 2.5.5 floor
    });

    it('carries hit slop on every side, so a near-miss still registers', async () => {
        const { view } = await renderSnackbar();
        await waitFor(() => expect(view.queryByTestId('undo-snackbar-action')).not.toBeNull());

        const { hitSlop } = view.getByTestId('undo-snackbar-action').props;
        expect(hitSlop).toEqual(
            expect.objectContaining({
                top: expect.any(Number),
                bottom: expect.any(Number),
                left: expect.any(Number),
                right: expect.any(Number),
            })
        );
    });

    it('is reachable by its accessibility label (what device QA taps)', async () => {
        const { view, handlers } = await renderSnackbar();
        await waitFor(() => expect(view.queryByLabelText('Undo')).not.toBeNull());

        await act(async () => {
            await fireEvent.press(view.getByLabelText('Undo'));
        });

        // Both fire, and the action runs BEFORE the dismiss that tears the
        // snackbar down — reversing them would unmount the host state the
        // action reads.
        expect(handlers.onAction).toHaveBeenCalledTimes(1);
        expect(handlers.onDismiss).toHaveBeenCalledTimes(1);
        expect(handlers.onAction.mock.invocationCallOrder[0]).toBeLessThan(
            handlers.onDismiss.mock.invocationCallOrder[0]
        );
    });
});

describe('UndoSnackbar — overlay structure', () => {
    it('declares pointerEvents on a plain View, and leaves the bar itself hittable', async () => {
        const { view } = await renderSnackbar();
        await waitFor(() => expect(view.queryByTestId('undo-snackbar-slot')).not.toBeNull());

        // The positioned wrapper passes touches through to the screen behind…
        expect(view.getByTestId('undo-snackbar-slot').props.pointerEvents).toBe('box-none');
        // …but the bar itself must NOT, or its own button can never be a target.
        expect(view.getByTestId('undo-snackbar').props.pointerEvents).toBeUndefined();
    });

    it('has NO reanimated layout animations at all (entering OR exiting)', async () => {
        // `exiting` hands the view's removal to reanimated, which keeps it
        // mounted past unmount. `entering` is WORSE here and is the proven root
        // cause of the dead Undo button (device QA 2026-09-03): a reanimated
        // `entering` on this bar left the mounted view painted correctly with
        // correct uiautomator bounds, yet real taps fell through to views BEHIND
        // it and zero ReactNativeJS activity fired — Fabric hit-testing broke on
        // the entering-animated view while the same action through a plain-View
        // panel worked every time. Fade-in is RN core Animated on opacity only.
        const { view } = await renderSnackbar();
        await waitFor(() => expect(view.queryByTestId('undo-snackbar')).not.toBeNull());

        const bar = view.getByTestId('undo-snackbar');
        expect(bar.props.exiting).toBeUndefined();
        expect(bar.props.entering).toBeUndefined();
    });

    it('never imports react-native-reanimated (source-level ban for this component)', () => {
        // Jest is structurally blind to native hit-testing, so the device-proven
        // bug class is banned at the import layer: nothing in UndoSnackbar may
        // come from reanimated. The fade-in must stay RN core `Animated`.
        const fs = require('fs');
        const path = require('path');
        const src = fs.readFileSync(
            path.join(__dirname, '..', 'components', 'UndoSnackbar.tsx'),
            'utf8'
        );
        expect(src).not.toMatch(/react-native-reanimated/);
        expect(src).not.toMatch(/\bentering\s*=/);
        expect(src).not.toMatch(/\bexiting\s*=/);
    });

    it('mounts through the OverlayHost, never a react-native <Modal>', async () => {
        const { view } = await renderSnackbar();
        await waitFor(() => expect(view.queryByTestId('undo-snackbar')).not.toBeNull());
        expect(view.container.queryAll((n) => n.type === 'Modal')).toHaveLength(0);
    });

    it('unmounts cleanly when it goes invisible (no orphan left in the host)', async () => {
        const view = await render(
            <OverlayProvider>
                <UndoSnackbar
                    visible={false}
                    message="Entry moved to the bin"
                    actionLabel="Undo"
                    onAction={jest.fn()}
                    onDismiss={jest.fn()}
                />
            </OverlayProvider>
        );
        expect(view.queryByTestId('undo-snackbar')).toBeNull();
        expect(view.queryByTestId('undo-snackbar-slot')).toBeNull();
    });
});

describe('UndoSnackbar — dismissal window', () => {
    it('gives the user long enough to aim (>= 8s, Material\'s long end)', () => {
        // It was 6s. An undo for a DESTRUCTIVE action that expires while the
        // user is still reading it fails silently — the tap lands on whatever
        // is behind, which is exactly the "Undo does nothing" report.
        expect(UNDO_SNACKBAR_DURATION_MS).toBeGreaterThanOrEqual(8000);
        expect(UNDO_SNACKBAR_DURATION_MS).toBeLessThanOrEqual(10000); // Material's ceiling
    });

    it('auto-dismisses exactly once the window elapses, not before', async () => {
        jest.useFakeTimers();
        const onDismiss = jest.fn();
        await renderSnackbar({ onDismiss });

        await act(async () => {
            jest.advanceTimersByTime(UNDO_SNACKBAR_DURATION_MS - 1);
        });
        expect(onDismiss).not.toHaveBeenCalled();

        await act(async () => {
            jest.advanceTimersByTime(2);
        });
        expect(onDismiss).toHaveBeenCalledTimes(1);
    });
});
