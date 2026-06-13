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
import { render } from '@testing-library/react-native';

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
