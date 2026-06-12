/**
 * Unit tests for the in-tree overlay host (the native-<Modal> replacement).
 * Uses react-test-renderer directly (no @testing-library dep) since we only
 * assert the mount/unmount/update + stacking contract, not pixels.
 */
import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

import { OverlayProvider, useOverlay } from '@/context/OverlayHost';

// Captures the overlay API so a test can drive mount/unmount imperatively.
let api: ReturnType<typeof useOverlay>;
function CaptureApi() {
    api = useOverlay();
    return null;
}

const overlayTexts = (root: TestRenderer.ReactTestRenderer): string[] =>
    root.root
        .findAllByType(Text)
        .map((n) => n.props.children)
        .filter((c): c is string => typeof c === 'string');

describe('OverlayHost', () => {
    it('mounts content above children and removes it on unmount', () => {
        // React 19's react-test-renderer commits the initial tree inside act();
        // a bare create() leaves the renderer uncommitted (root inaccessible) and
        // never runs the effect that captures the overlay api. Wrap the create.
        let root!: TestRenderer.ReactTestRenderer;
        act(() => {
            root = TestRenderer.create(
                <OverlayProvider>
                    <CaptureApi />
                    <Text>app-content</Text>
                </OverlayProvider>
            );
        });

        // Nothing mounted yet.
        expect(overlayTexts(root)).toEqual(['app-content']);

        let handle: ReturnType<typeof api.mount>;
        act(() => {
            handle = api.mount(<Text>overlay-A</Text>);
        });
        expect(overlayTexts(root)).toContain('overlay-A');

        act(() => {
            handle.unmount();
        });
        expect(overlayTexts(root)).not.toContain('overlay-A');
        // App content is untouched throughout.
        expect(overlayTexts(root)).toContain('app-content');
    });

    it('stacks multiple overlays in mount order', () => {
        let root!: TestRenderer.ReactTestRenderer;
        act(() => {
            root = TestRenderer.create(
                <OverlayProvider>
                    <CaptureApi />
                </OverlayProvider>
            );
        });

        act(() => {
            api.mount(<Text>first</Text>);
            api.mount(<Text>second</Text>);
        });

        const texts = overlayTexts(root);
        expect(texts).toEqual(['first', 'second']);
    });

    it('update() swaps an overlay node in place without affecting siblings', () => {
        let root!: TestRenderer.ReactTestRenderer;
        act(() => {
            root = TestRenderer.create(
                <OverlayProvider>
                    <CaptureApi />
                </OverlayProvider>
            );
        });

        let a: ReturnType<typeof api.mount>;
        act(() => {
            a = api.mount(<Text>A1</Text>);
            api.mount(<Text>B1</Text>);
        });
        expect(overlayTexts(root)).toEqual(['A1', 'B1']);

        act(() => {
            a.update(<Text>A2</Text>);
        });
        // A swapped, B unchanged, order preserved.
        expect(overlayTexts(root)).toEqual(['A2', 'B1']);
    });

    it('useOverlay throws outside a provider (loud failure, not a dead modal)', () => {
        const Bad = () => {
            useOverlay();
            return null;
        };
        // react-test-renderer surfaces the thrown render error, but under React 19
        // the throw propagates during the act()-flushed commit, so the create must
        // run inside act() for expect(...).toThrow to observe it.
        expect(() =>
            act(() => {
                TestRenderer.create(<Bad />);
            })
        ).toThrow(/useOverlay must be used within an <OverlayProvider>/);
    });
});
