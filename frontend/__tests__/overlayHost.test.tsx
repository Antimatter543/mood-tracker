/**
 * Unit tests for the in-tree overlay host (the native-<Modal> replacement).
 * Uses @testing-library/react-native (test-renderer under the hood) — we only
 * assert the mount/unmount/update + stacking contract, not pixels.
 */
import React from 'react';
import { Text } from 'react-native';
import { render, act } from '@testing-library/react-native';
import type { RenderResult } from '@testing-library/react-native';

import { OverlayProvider, useOverlay } from '@/context/OverlayHost';

// Captures the overlay API so a test can drive mount/unmount imperatively.
// A container object (not a reassigned module `let`) avoids react-hooks 7.x's
// `globals` rule; writing `.current` from the component trips `immutability`,
// which is downgraded to a warning project-wide (see .eslintrc.js).
const apiBox: { current: ReturnType<typeof useOverlay> | null } = { current: null };
function CaptureApi() {
    apiBox.current = useOverlay();
    return null;
}
const api = () => {
    if (!apiBox.current) throw new Error('overlay api not captured');
    return apiBox.current;
};

// All <Text> children strings, in render order — the stacking contract is the
// order/set of these. test-renderer's container.queryAll replaces RTR's
// findAllByType (queryAll traverses the whole host tree, whereas `root` is the
// element node and misses descendants). Host elements are exposed by their
// string type name ("Text"), so match that and read the string children.
const overlayTexts = (screen: RenderResult): string[] =>
    screen.container
        .queryAll((node) => node.type === 'Text')
        .map((n) => n.props.children)
        .filter((c): c is string => typeof c === 'string');

describe('OverlayHost', () => {
    it('mounts content above children and removes it on unmount', async () => {
        const screen = await render(
            <OverlayProvider>
                <CaptureApi />
                <Text>app-content</Text>
            </OverlayProvider>
        );

        // Nothing mounted yet.
        expect(overlayTexts(screen)).toEqual(['app-content']);

        let handle: ReturnType<ReturnType<typeof api>['mount']>;
        await act(async () => {
            handle = api().mount(<Text>overlay-A</Text>);
        });
        expect(overlayTexts(screen)).toContain('overlay-A');

        await act(async () => {
            handle.unmount();
        });
        expect(overlayTexts(screen)).not.toContain('overlay-A');
        // App content is untouched throughout.
        expect(overlayTexts(screen)).toContain('app-content');
    });

    it('stacks multiple overlays in mount order', async () => {
        const screen = await render(
            <OverlayProvider>
                <CaptureApi />
            </OverlayProvider>
        );

        await act(async () => {
            api().mount(<Text>first</Text>);
            api().mount(<Text>second</Text>);
        });

        const texts = overlayTexts(screen);
        expect(texts).toEqual(['first', 'second']);
    });

    it('update() swaps an overlay node in place without affecting siblings', async () => {
        const screen = await render(
            <OverlayProvider>
                <CaptureApi />
            </OverlayProvider>
        );

        let a: ReturnType<ReturnType<typeof api>['mount']>;
        await act(async () => {
            a = api().mount(<Text>A1</Text>);
            api().mount(<Text>B1</Text>);
        });
        expect(overlayTexts(screen)).toEqual(['A1', 'B1']);

        await act(async () => {
            a.update(<Text>A2</Text>);
        });
        // A swapped, B unchanged, order preserved.
        expect(overlayTexts(screen)).toEqual(['A2', 'B1']);
    });

    it('useOverlay throws outside a provider (loud failure, not a dead modal)', async () => {
        const Bad = () => {
            useOverlay();
            return null;
        };
        // render() is async; the render error surfaces as a rejected promise, so
        // assert via rejects.toThrow.
        await expect(render(<Bad />)).rejects.toThrow(
            /useOverlay must be used within an <OverlayProvider>/
        );
    });
});
