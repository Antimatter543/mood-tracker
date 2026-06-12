import React, { useEffect, useRef, useState } from 'react';
import {
    BackHandler,
    Dimensions,
    LayoutChangeEvent,
    Pressable,
    StyleSheet,
} from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { useOverlay } from '@/context/OverlayHost';

/**
 * Anchored popover rendered through the root OverlayProvider (in-tree, NOT a
 * native <Modal> — see context/OverlayHost.tsx for why native modals are banned
 * on this app's RN/Fabric stack).
 *
 * Unlike `OverlayModal` (a centered dialog / full-screen panel), a popover must
 * float at a free absolute position next to an on-screen anchor (e.g. the group
 * "..." button) while a tap ANYWHERE else dismisses it. We get dismiss-anywhere
 * for free from a single full-window transparent backdrop Pressable, and we clamp
 * the card to the window so it never renders off-screen.
 *
 * Usage: measure the anchor with `measureInWindow` on press, then mount this with
 * the resulting `{ x, y, width, height }` as `anchor`. Mount/unmount on `visible`.
 */

export type PopoverAnchor = {
    /** Anchor's top-left X in window coordinates (from measureInWindow). */
    x: number;
    /** Anchor's top-left Y in window coordinates. */
    y: number;
    /** Anchor width. */
    width: number;
    /** Anchor height. */
    height: number;
};

type OverlayPopoverProps = {
    visible: boolean;
    onClose: () => void;
    anchor: PopoverAnchor;
    children: React.ReactNode;
    /** Popover card width. Default 200. */
    width?: number;
    /** Gap between the anchor's bottom edge and the card's top. Default 4. */
    gap?: number;
    /** Margin kept between the card and the window edges when clamping. Default 8. */
    edgeMargin?: number;
};

export const OverlayPopover: React.FC<OverlayPopoverProps> = ({
    visible,
    onClose,
    anchor,
    children,
    width = 200,
    gap = 4,
    edgeMargin = 8,
}) => {
    const { mount } = useOverlay();
    const handleRef = useRef<ReturnType<typeof mount> | null>(null);

    const content = (
        <OverlayPopoverContent
            onClose={onClose}
            anchor={anchor}
            width={width}
            gap={gap}
            edgeMargin={edgeMargin}
        >
            {children}
        </OverlayPopoverContent>
    );

    // Mount/unmount strictly on `visible`; refresh content in place otherwise so a
    // parent re-render doesn't tear down and remount (restarting the fade).
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
    }, [visible, onClose, children, anchor.x, anchor.y, anchor.width, anchor.height, width, gap, edgeMargin]);

    return null;
};

/**
 * Pure layout helper (exported for unit testing): given the anchor and the
 * measured card size, compute the on-screen top/left of the card, clamped so it
 * stays within the window. Prefers right-aligning the card to the anchor's right
 * edge (menus open from the "..." on the right of a row) and dropping below the
 * anchor; flips above if there isn't room below.
 */
export function computePopoverPosition(args: {
    anchor: PopoverAnchor;
    cardWidth: number;
    cardHeight: number;
    windowWidth: number;
    windowHeight: number;
    gap: number;
    edgeMargin: number;
}): { top: number; left: number } {
    const { anchor, cardWidth, cardHeight, windowWidth, windowHeight, gap, edgeMargin } = args;

    // Horizontal: right-align the card to the anchor's right edge, then clamp.
    const anchorRight = anchor.x + anchor.width;
    let left = anchorRight - cardWidth;
    const maxLeft = windowWidth - edgeMargin - cardWidth;
    left = Math.min(left, maxLeft);
    left = Math.max(edgeMargin, left);

    // Vertical: drop below the anchor; if the card would overflow the bottom and
    // there's more room above, flip above the anchor instead.
    const below = anchor.y + anchor.height + gap;
    const overflowsBottom = below + cardHeight + edgeMargin > windowHeight;
    const above = anchor.y - gap - cardHeight;
    let top = below;
    if (overflowsBottom && above >= edgeMargin) {
        top = above;
    }
    // Final clamp so it never sits off either vertical edge.
    const maxTop = windowHeight - edgeMargin - cardHeight;
    top = Math.min(top, Math.max(edgeMargin, maxTop));
    top = Math.max(edgeMargin, top);

    return { top, left };
}

const OverlayPopoverContent: React.FC<{
    onClose: () => void;
    anchor: PopoverAnchor;
    width: number;
    gap: number;
    edgeMargin: number;
    children: React.ReactNode;
}> = ({ onClose, anchor, width, gap, edgeMargin, children }) => {
    // Measured card height; until first layout we render with the computed
    // below-anchor position assuming height 0 (then settle once measured).
    const [cardHeight, setCardHeight] = useState(0);
    const window = Dimensions.get('window');

    useEffect(() => {
        const sub = BackHandler.addEventListener('hardwareBackPress', () => {
            onClose();
            return true;
        });
        return () => sub.remove();
    }, [onClose]);

    const { top, left } = computePopoverPosition({
        anchor,
        cardWidth: width,
        cardHeight,
        windowWidth: window.width,
        windowHeight: window.height,
        gap,
        edgeMargin,
    });

    const onCardLayout = (e: LayoutChangeEvent) => {
        const h = e.nativeEvent.layout.height;
        if (h && h !== cardHeight) setCardHeight(h);
    };

    return (
        <Animated.View entering={FadeIn.duration(120)} style={StyleSheet.absoluteFill}>
            {/* Full-window transparent backdrop: a tap ANYWHERE outside the card
                dismisses the popover. */}
            <Pressable
                style={StyleSheet.absoluteFill}
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Close menu"
            />
            {/* The card. Its own Pressable swallows taps so they don't fall
                through to the backdrop. */}
            <Pressable
                onLayout={onCardLayout}
                style={[styles.card, { top, left, width }]}
                onPress={() => {}}
            >
                {children}
            </Pressable>
        </Animated.View>
    );
};

const styles = StyleSheet.create({
    card: {
        position: 'absolute',
    },
});
