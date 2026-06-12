/**
 * Tests for OverlayPopover — the anchored, dismiss-anywhere popover used by the
 * activity group "..." menu. Covers the pure clamping/flip math
 * (computePopoverPosition) and the in-tree dismiss-on-outside-tap behaviour.
 * Uses @testing-library/react-native (async — render/act return promises).
 */
import React from 'react';
import { Text } from 'react-native';
import { render, act, fireEvent, screen as rtlScreen } from '@testing-library/react-native';

// OverlayPopover imports react-native-reanimated (FadeIn / Animated.View). The
// real module — and reanimated's own mock.js — initialize the native worklets
// runtime at import time, which isn't available under jest. We only use
// `Animated.View` (a plain View) and `FadeIn.duration()` (an animation-config
// builder), so shim exactly that surface and skip the worklets import chain.
// Scoped to this suite so other suites are unaffected.
jest.mock('react-native-reanimated', () => {
    const React = require('react');
    const { View } = require('react-native');
    const entering = { duration: () => entering };
    return {
        __esModule: true,
        default: {
            View: (props: Record<string, unknown>) => React.createElement(View, props),
        },
        FadeIn: entering,
    };
});

import { OverlayProvider } from '@/context/OverlayHost';
import {
    OverlayPopover,
    computePopoverPosition,
    PopoverAnchor,
} from '@/components/OverlayPopover';

const WINDOW = { width: 400, height: 800 };

describe('computePopoverPosition', () => {
    const base = {
        cardWidth: 200,
        windowWidth: WINDOW.width,
        windowHeight: WINDOW.height,
        gap: 4,
        edgeMargin: 8,
    };

    it('right-aligns the card to the anchor and drops below it', () => {
        // "..." button near the right edge: x=360..400, y=100..140.
        const anchor: PopoverAnchor = { x: 360, y: 100, width: 40, height: 40 };
        const { top, left } = computePopoverPosition({ ...base, anchor, cardHeight: 150 });
        // Right edge of the card lines up with the anchor's right edge (400), but
        // clamped to windowWidth - edgeMargin - cardWidth = 400-8-200 = 192.
        expect(left).toBe(192);
        // Below the anchor: y + height + gap = 100+40+4 = 144.
        expect(top).toBe(144);
    });

    it('clamps the left so a card never runs off the left edge', () => {
        // Anchor on the far left — naive right-align would push left negative.
        const anchor: PopoverAnchor = { x: 0, y: 100, width: 40, height: 40 };
        const { left } = computePopoverPosition({ ...base, anchor, cardHeight: 150 });
        expect(left).toBe(base.edgeMargin); // clamped to the left margin
    });

    it('flips above the anchor when there is no room below', () => {
        // Anchor near the bottom; a tall card below would overflow the window.
        const anchor: PopoverAnchor = { x: 360, y: 740, width: 40, height: 40 };
        const cardHeight = 150;
        const { top } = computePopoverPosition({ ...base, anchor, cardHeight });
        // Flipped above: anchor.y - gap - cardHeight = 740 - 4 - 150 = 586.
        expect(top).toBe(586);
    });

    it('keeps the card on-screen even when it cannot fit either side', () => {
        // Pathological: card taller than the window — clamp to the top margin.
        const anchor: PopoverAnchor = { x: 360, y: 400, width: 40, height: 40 };
        const { top } = computePopoverPosition({
            ...base,
            anchor,
            cardHeight: 1000,
        });
        expect(top).toBe(base.edgeMargin);
        expect(top).toBeGreaterThanOrEqual(0);
    });
});

describe('OverlayPopover dismiss behaviour', () => {
    const anchor: PopoverAnchor = { x: 360, y: 100, width: 40, height: 40 };

    it('renders its content while visible and a tap outside dismisses it', async () => {
        const onClose = jest.fn();

        const Harness = ({ visible }: { visible: boolean }) => (
            <OverlayProvider>
                <Text>app-content</Text>
                <OverlayPopover visible={visible} onClose={onClose} anchor={anchor}>
                    <Text>menu-item</Text>
                </OverlayPopover>
            </OverlayProvider>
        );

        const view = await render(<Harness visible />);

        // Menu content is mounted through the overlay host.
        expect(rtlScreen.queryByText('menu-item')).not.toBeNull();

        // Tapping the full-window backdrop ("Close menu") fires onClose.
        const backdrop = rtlScreen.getByLabelText('Close menu');
        await act(async () => {
            fireEvent.press(backdrop);
        });
        expect(onClose).toHaveBeenCalledTimes(1);

        // Simulate the parent reacting to onClose by flipping visible=false:
        // the popover content is then removed from the tree.
        await act(async () => {
            await view.rerender(<Harness visible={false} />);
        });
        expect(rtlScreen.queryByText('menu-item')).toBeNull();
        // App content is never affected.
        expect(rtlScreen.queryByText('app-content')).not.toBeNull();
    });

    it('does not mount content while hidden', async () => {
        await render(
            <OverlayProvider>
                <OverlayPopover visible={false} onClose={jest.fn()} anchor={anchor}>
                    <Text>hidden-item</Text>
                </OverlayPopover>
            </OverlayProvider>
        );
        expect(rtlScreen.queryByText('hidden-item')).toBeNull();
    });
});
