/**
 * OverlayModal keyboard + bottom-inset tests.
 *
 * The empirical failure: under enforced edge-to-edge (SDK 56 / RN 0.85 /
 * targetSdk 36) a KeyboardAvoidingView with behavior=undefined is a no-op on
 * Android, so a focused TextInput stayed behind the keyboard. The fix consumes
 * the IME inset in JS — useKeyboardHeight feeds a paddingBottom that lifts the
 * centered dialog (and gives the fullScreen panel scroll range).
 *
 * Task 1 (still holds): the fullScreen variant also pads by the safe-area inset
 * so footers clear the Android nav bar.
 *
 * Real occlusion is release-APK only; these assert the WIRING it depends on:
 * the card layer / fullScreen inner carry paddingBottom == (inset +) keyboard
 * height, and that it tracks the live keyboard height.
 */
import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

// Non-zero bottom inset (3-button nav) so the fullScreen padding is assertable.
jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 48, left: 0, right: 0 }),
}));

// Mock the keyboard-height hook so we can assert the padding math without a
// real keyboard. Default 300; tests override per-case via mockReturnValue.
const mockKeyboardHeight = jest.fn(() => 300);
jest.mock('@/hooks/useKeyboardHeight', () => ({
    useKeyboardHeight: () => mockKeyboardHeight(),
}));

// OverlayModal imports reanimated (worklets runtime is unavailable under jest).
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

import { OverlayProvider } from '@/context/OverlayHost';
import { OverlayModal } from '@/components/OverlayModal';

function renderOverlay(node: React.ReactElement) {
    return render(<OverlayProvider>{node}</OverlayProvider>);
}

const flatStyle = (node: any) => StyleSheet.flatten(node?.props?.style) || {};

afterEach(() => mockKeyboardHeight.mockReturnValue(300));

describe('OverlayModal — keyboard avoidance (deterministic JS inset)', () => {
    it('dialog variant pads the card layer by the keyboard height (lifts the centered card)', async () => {
        mockKeyboardHeight.mockReturnValue(804);
        const view = await renderOverlay(
            <OverlayModal visible onClose={() => {}}>
                <Text>dialog-body</Text>
            </OverlayModal>
        );
        const layer = view.getByTestId('overlay-card-layer');
        expect(flatStyle(layer).paddingBottom).toBe(804);
        expect(view.getByText('dialog-body')).toBeTruthy();
    });

    it('dialog card layer padding is 0 when the keyboard is hidden (no-op)', async () => {
        mockKeyboardHeight.mockReturnValue(0);
        const view = await renderOverlay(
            <OverlayModal visible onClose={() => {}}>
                <Text>dialog-body</Text>
            </OverlayModal>
        );
        expect(flatStyle(view.getByTestId('overlay-card-layer')).paddingBottom).toBe(0);
    });

    it('fullScreen variant pads by safe-area inset PLUS keyboard height', async () => {
        mockKeyboardHeight.mockReturnValue(804);
        const view = await renderOverlay(
            <OverlayModal visible onClose={() => {}} fullScreen>
                <Text>fullscreen-body</Text>
            </OverlayModal>
        );
        const inner = view.getByTestId('overlay-fullscreen-inner');
        // 48 (nav-bar inset) + 804 (keyboard) so footers clear the nav bar AND
        // inputs gain scroll range above the keyboard.
        expect(flatStyle(inner).paddingBottom).toBe(48 + 804);
        expect(view.getByText('fullscreen-body')).toBeTruthy();
    });

    it('fullScreen padding is just the safe-area inset when keyboard hidden', async () => {
        mockKeyboardHeight.mockReturnValue(0);
        const view = await renderOverlay(
            <OverlayModal visible onClose={() => {}} fullScreen>
                <Text>fullscreen-body</Text>
            </OverlayModal>
        );
        expect(flatStyle(view.getByTestId('overlay-fullscreen-inner')).paddingBottom).toBe(48);
    });

    it('renders nothing when not visible (no leak)', async () => {
        const view = await renderOverlay(
            <OverlayModal visible={false} onClose={() => {}}>
                <Text>hidden-body</Text>
            </OverlayModal>
        );
        expect(view.queryByTestId('overlay-card-layer')).toBeNull();
        expect(view.queryByTestId('overlay-fullscreen-inner')).toBeNull();
        expect(view.queryByText('hidden-body')).toBeNull();
    });
});

describe('OverlayModal — the fullScreen opaque surface', () => {
    // REGRESSION (device QA 2026-09-03): the "Recently deleted" panel let the
    // live Timeline show through below its content — entry cards, their delete
    // icons, the FAB — because the ONLY opaque surface was the child panel's own
    // `flex: 1` background, and that child is laid out INSIDE the inner
    // wrapper's `paddingBottom`. Padding shrinks the child's box, so the bottom
    // strip of the window stayed transparent and touch-permeable: always the
    // safe-area inset (~48dp), and the entire keyboard height whenever the IME
    // was up.
    //
    // A full-screen overlay is modal over the WHOLE window, so its surface must
    // be sized by the window and never by the padded content box.

    it('paints an opaque themed surface over the whole window', async () => {
        const view = await renderOverlay(
            <OverlayModal visible onClose={() => {}} fullScreen>
                <Text>fullscreen-body</Text>
            </OverlayModal>
        );
        const surface = flatStyle(view.getByTestId('overlay-fullscreen-surface'));

        // Window-sized, not content-sized.
        expect(surface.position).toBe('absolute');
        expect([surface.top, surface.left, surface.right, surface.bottom]).toEqual([0, 0, 0, 0]);
        // Opaque: a real colour, and never a transparent one — the whole point
        // is that nothing behind it can be seen.
        expect(typeof surface.backgroundColor).toBe('string');
        expect(surface.backgroundColor).not.toMatch(/^transparent$/);
    });

    it('the surface is NOT shrunk by the keyboard or the safe-area inset', async () => {
        // The exact failure: 48 (nav inset) + 804 (keyboard) of see-through,
        // tappable window at the bottom. The inner CONTENT keeps that padding
        // (footers must clear the nav bar / IME) — the surface must not have it.
        mockKeyboardHeight.mockReturnValue(804);
        const view = await renderOverlay(
            <OverlayModal visible onClose={() => {}} fullScreen>
                <Text>fullscreen-body</Text>
            </OverlayModal>
        );

        expect(flatStyle(view.getByTestId('overlay-fullscreen-inner')).paddingBottom).toBe(48 + 804);
        const surface = flatStyle(view.getByTestId('overlay-fullscreen-surface'));
        expect(surface.paddingBottom).toBeUndefined();
        expect(surface.bottom).toBe(0);
        expect(surface.height).toBeUndefined();
    });

    it('the surface swallows taps rather than letting them reach the screen behind', async () => {
        const onClose = jest.fn();
        const view = await renderOverlay(
            <OverlayModal visible onClose={onClose} fullScreen>
                <Text>fullscreen-body</Text>
            </OverlayModal>
        );

        // Pressing it must NOT close the panel: a full-screen panel closes via
        // its own back affordance / Android hardware-back, never a stray tap on
        // the nav-bar strip. (RNTL only presses a real touch responder, so this
        // passing at all is the evidence that the layer consumes touches.)
        await fireEvent.press(view.getByTestId('overlay-fullscreen-surface'));

        expect(onClose).not.toHaveBeenCalled();
        expect(view.getByText('fullscreen-body')).toBeTruthy();
    });

    it('the dialog variant grows no such surface (it has its own dimmed backdrop)', async () => {
        const view = await renderOverlay(
            <OverlayModal visible onClose={() => {}}>
                <Text>dialog-body</Text>
            </OverlayModal>
        );
        expect(view.queryByTestId('overlay-fullscreen-surface')).toBeNull();
    });

    it('renders no surface when not visible', async () => {
        const view = await renderOverlay(
            <OverlayModal visible={false} onClose={() => {}} fullScreen>
                <Text>hidden-body</Text>
            </OverlayModal>
        );
        expect(view.queryByTestId('overlay-fullscreen-surface')).toBeNull();
    });
});
