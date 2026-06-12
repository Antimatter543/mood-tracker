import React, { useEffect } from 'react';
import { BackHandler, Pressable, StyleSheet } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { useOverlay } from '@/context/OverlayHost';

/**
 * Drop-in replacement for a transparent, centered `<Modal>` (dialog style).
 *
 * Renders its children through the root OverlayProvider (an in-tree, full-window
 * overlay) instead of a native `<Modal>`, because native modals open a second
 * native window whose touch dispatch is broken on RN 0.76 Android new arch — the
 * controls inside are dead to a real finger. See context/OverlayHost.tsx.
 *
 * Behaviour parity with the `<Modal transparent>` it replaces:
 *  - dimmed backdrop that closes on tap (set `dismissOnBackdropPress={false}` to
 *    opt out, e.g. for a required choice),
 *  - Android hardware-back closes it (and is swallowed so the route isn't popped),
 *  - a fade-in, centered content.
 *
 * Callers keep their existing `visible` / `onClose` props and wrap whatever they
 * previously put inside `<Modal>`'s centered card.
 */
export const OverlayModal: React.FC<{
    visible: boolean;
    onClose: () => void;
    children: React.ReactNode;
    /** Tap outside the content closes it (dialog variant only). Default true. */
    dismissOnBackdropPress?: boolean;
    /**
     * Render edge-to-edge with no dimmed backdrop / centering (a full-screen
     * panel, e.g. the icon picker) instead of a centered dialog card. The
     * children are expected to fill the window themselves. Default false.
     */
    fullScreen?: boolean;
}> = ({ visible, onClose, children, dismissOnBackdropPress = true, fullScreen = false }) => {
    const { mount } = useOverlay();

    useEffect(() => {
        if (!visible) return;

        const handle = mount(
            <OverlayModalContent
                onClose={onClose}
                dismissOnBackdropPress={dismissOnBackdropPress}
                fullScreen={fullScreen}
            >
                {children}
            </OverlayModalContent>
        );
        return () => handle.unmount();
    }, [visible, mount, onClose, children, dismissOnBackdropPress, fullScreen]);

    return null;
};

const OverlayModalContent: React.FC<{
    onClose: () => void;
    dismissOnBackdropPress: boolean;
    fullScreen: boolean;
    children: React.ReactNode;
}> = ({ onClose, dismissOnBackdropPress, fullScreen, children }) => {
    useEffect(() => {
        const sub = BackHandler.addEventListener('hardwareBackPress', () => {
            onClose();
            return true;
        });
        return () => sub.remove();
    }, [onClose]);

    if (fullScreen) {
        // Edge-to-edge panel: children fill the window, no backdrop / centering.
        return (
            <Animated.View entering={FadeIn.duration(150)} style={StyleSheet.absoluteFill}>
                {children}
            </Animated.View>
        );
    }

    return (
        <Animated.View entering={FadeIn.duration(150)} style={StyleSheet.absoluteFill}>
            <Pressable
                style={styles.backdrop}
                onPress={dismissOnBackdropPress ? onClose : undefined}
            >
                {/* Inner Pressable becomes the touch responder so taps on the
                    content don't trigger the backdrop's onPress. */}
                <Pressable onPress={() => {}}>{children}</Pressable>
            </Pressable>
        </Animated.View>
    );
};

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
    },
});
