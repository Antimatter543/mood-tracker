import React, { useEffect, useRef } from 'react';
import { BackHandler, Pressable, StyleSheet, View } from 'react-native';
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
    const handleRef = useRef<ReturnType<typeof mount> | null>(null);

    const content = (
        <OverlayModalContent
            onClose={onClose}
            dismissOnBackdropPress={dismissOnBackdropPress}
            fullScreen={fullScreen}
        >
            {children}
        </OverlayModalContent>
    );

    // Mount/unmount strictly on `visible`; refresh content in place otherwise, so a
    // parent re-render (new children / onClose identity) doesn't tear down and
    // remount the dialog (which would drop its internal state + restart the fade).
    useEffect(() => {
        if (!visible) return;
        const handle = mount(content);
        handleRef.current = handle;
        return () => {
            handle.unmount();
            handleRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- mount on visibility only; content refreshed below
    }, [visible, mount]);

    useEffect(() => {
        if (!visible) return;
        handleRef.current?.update(content);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `content` rebuilt each render from these
    }, [visible, onClose, children, dismissOnBackdropPress, fullScreen]);

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
            {/* Backdrop: a full-screen dimmed layer. A tap on it (outside the card)
                closes the dialog, unless dismissOnBackdropPress is false. */}
            <Pressable
                style={[StyleSheet.absoluteFill, styles.backdrop]}
                onPress={dismissOnBackdropPress ? onClose : undefined}
            />
            {/* Card layer, ABOVE the backdrop and pinned to the same full-screen
                box (absoluteFill). It is `pointerEvents="box-none"`, so only the
                card itself takes touches and every tap in the surrounding gutters
                passes THROUGH to the backdrop below (preserving tap-outside-to-
                close). `justifyContent/alignItems: center` positions the card.

                Why a full-screen sibling instead of nesting the card inside the
                backdrop Pressable: the card (`modalContent`) sizes itself in % (e.g.
                `width: '94%'`). A %-width child only resolves against a parent with
                a concrete width — and the previous structure wrapped the card in a
                STYLELESS `<Pressable>` whose width was `auto`, so it shrink-wrapped
                to the card and the `94%` resolved against that shrunken width,
                collapsing the card to ~49% of the screen. This full-screen layer
                gives the card's `%` the real screen width as its basis -> 94%. */}
            <View
                style={[StyleSheet.absoluteFill, styles.cardLayer]}
                pointerEvents="box-none"
            >
                {/* The inner no-op `<Pressable>` is the card's own touch responder,
                    so a tap anywhere on the card (including its 24px padding) is
                    swallowed and does NOT reach the backdrop's onClose. It is
                    `alignSelf: 'stretch'` (full width) and centers the card, so it
                    does NOT shrink-wrap — the card still resolves its `%` against the
                    full screen width (94%). It only spans the card's HEIGHT, so taps
                    in the top/bottom margins fall through to the backdrop and close;
                    the X button and Android hardware-back are the always-available
                    close affordances. */}
                <Pressable style={styles.cardPress} onPress={() => {}}>
                    {children}
                </Pressable>
            </View>
        </Animated.View>
    );
};

const styles = StyleSheet.create({
    backdrop: {
        // Full-screen dimmed, tappable layer (the close-on-outside-tap target).
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
    },
    // Full-screen layer that holds + centers the card. It sits above the backdrop
    // and (via `pointerEvents="box-none"` on the element) is transparent to touches
    // except over the card, so gutter taps reach the backdrop. Centering it here
    // gives the card's percentage width the full screen as its basis.
    cardLayer: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    // The card's touch responder. Full width (`alignSelf: 'stretch'`) so it does
    // NOT shrink-wrap the card (which would collapse the card's `%` width); it only
    // hugs the card's height and centers it. Swallows taps on the card.
    cardPress: {
        alignSelf: 'stretch',
        alignItems: 'center',
    },
});
