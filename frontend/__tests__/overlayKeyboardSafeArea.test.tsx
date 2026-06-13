/**
 * OverlayModal keyboard + bottom-inset tests.
 *
 * Task 2: every overlay that hosts a TextInput must keep the focused input above
 * the keyboard. The systematic solution is a KeyboardAvoidingView built into
 * BOTH OverlayModal variants (dialog + fullScreen), so ActivityEditModal /
 * Add-Activity / Add-Group (dialog) and IconPicker (fullScreen) all inherit it.
 *
 * Task 1: the fullScreen variant pads its bottom by the safe-area inset so
 * footers/action rows clear the Android nav bar.
 *
 * The actual keyboard-occlusion BEHAVIOR is only verifiable on-device (jest has
 * no live keyboard). These tests assert the WIRING the device behavior depends
 * on: a KeyboardAvoidingView is present, its `behavior` is the Expo-sanctioned
 * per-platform value, and the fullScreen avoider carries the bottom inset.
 */
import React from 'react';
import { Platform, Text, StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';

// Non-zero bottom inset (3-button nav) so the fullScreen padding is assertable.
jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 48, left: 0, right: 0 }),
}));

// OverlayModal imports reanimated (worklets runtime is unavailable under jest).
// Shim exactly the surface it uses (Animated.View + FadeIn.duration), same as
// activityReorder.test.tsx / overlayPopover.test.tsx.
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
import { OverlayModal, keyboardBehavior } from '@/components/OverlayModal';

function renderOverlay(node: React.ReactElement) {
    return render(<OverlayProvider>{node}</OverlayProvider>);
}

// The KeyboardAvoidingView renders to a host View carrying its testID; that
// host node is what we assert presence + style on. (container.queryAll only
// exposes HOST nodes, not composite instances, so we target the testID rather
// than the KAV component type. The per-platform `behavior` value is covered by
// the keyboardBehavior() unit tests below — the components feed it that value.)
const flatStyle = (node: any) => StyleSheet.flatten(node?.props?.style) || {};

describe('OverlayModal — keyboard avoidance wiring', () => {
    it('dialog variant wraps content in a KeyboardAvoidingView', async () => {
        const view = await renderOverlay(
            <OverlayModal visible onClose={() => {}}>
                <Text>dialog-body</Text>
            </OverlayModal>
        );
        expect(view.getByTestId('overlay-kav-dialog')).toBeTruthy();
        expect(view.getByText('dialog-body')).toBeTruthy();
    });

    it('fullScreen variant wraps content in a KeyboardAvoidingView AND pads the bottom inset', async () => {
        const view = await renderOverlay(
            <OverlayModal visible onClose={() => {}} fullScreen>
                <Text>fullscreen-body</Text>
            </OverlayModal>
        );
        const kav = view.getByTestId('overlay-kav-fullscreen');
        // The fullScreen avoider must carry paddingBottom == insets.bottom (48)
        // so footers/action rows clear the Android nav bar.
        expect(flatStyle(kav).paddingBottom).toBe(48);
        expect(view.getByText('fullscreen-body')).toBeTruthy();
    });

    it('renders nothing when not visible (no avoider, no leak)', async () => {
        const view = await renderOverlay(
            <OverlayModal visible={false} onClose={() => {}}>
                <Text>hidden-body</Text>
            </OverlayModal>
        );
        expect(view.queryByTestId('overlay-kav-dialog')).toBeNull();
        expect(view.queryByTestId('overlay-kav-fullscreen')).toBeNull();
        expect(view.queryByText('hidden-body')).toBeNull();
    });
});

describe('keyboardBehavior — per-platform (Expo-sanctioned)', () => {
    // Flip Platform.OS directly (it's a plain data property, not a getter) and
    // restore it. We avoid jest.resetModules + deep Platform module mocking —
    // that fights jest-expo's setup, which re-requires expo modules that read
    // Platform at import.
    const realOS = Platform.OS;
    afterEach(() => {
        (Platform as { OS: string }).OS = realOS;
    });

    it("is 'padding' on iOS", () => {
        (Platform as { OS: string }).OS = 'ios';
        expect(keyboardBehavior()).toBe('padding');
    });

    it('is undefined on Android (just mounting the KAV avoids the keyboard under edge-to-edge)', () => {
        (Platform as { OS: string }).OS = 'android';
        expect(keyboardBehavior()).toBeUndefined();
    });
});
