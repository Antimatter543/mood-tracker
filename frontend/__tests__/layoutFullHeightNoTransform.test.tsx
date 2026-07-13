/**
 * Regression guard for the Statistics blank-screen P0 (root-caused on-device
 * 2026-07-13).
 *
 * ROOT CAUSE: `Layout` (components/PageContainer.tsx) used to wrap the
 * full-height content branch (`useScrollView={false}`) in a reanimated
 * `Animated.View` whose `useAnimatedStyle` returned a `transform:[{translateY}]`.
 * On Fabric + reanimated 4, a live animated `transform` on a `flex: 1` container
 * corrupts that container's layout once its children re-lay-out after mount — the
 * Statistics screen's ~8 charts each resolve async data and re-render over ~3s,
 * and on one of those re-layouts the whole subtree got shoved ~1.6k px off-screen,
 * blanking the tab with NO JS re-render. (Verified on-device that the animated
 * PROPERTY is irrelevant — even opacity-only blanked it; only removing the
 * animatedStyle from the flex:1 view fixed it.) The fix renders the full-height
 * branch as a plain static `View`.
 *
 * This test locks the invariant: the `useScrollView={false}` branch must render
 * its children with NO `transform` style anywhere in the tree. It FAILS against
 * the pre-fix code (the Animated.View applied `transform:[{translateY}]`) and
 * PASSES against the fix. It is NOT a full reproduction — the off-screen push is
 * native Fabric+reanimated behaviour that jest can't run — but it deterministically
 * catches any reintroduction of a transform-animated full-height container.
 */
import { render } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';

const THEME = { background: '#000', isDark: true };

jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// reanimated worklets runtime is unavailable under jest. Passthrough Animated.View
// and resolve useAnimatedStyle inline, so whatever style the component would drive
// on the UI thread shows up as a plain style we can assert on (this is exactly how
// the pre-fix `transform` would surface, which is what makes the guard real).
jest.mock('react-native-reanimated', () => {
    const ReactLocal = require('react');
    const { View } = require('react-native');
    return {
        __esModule: true,
        default: {
            View: (props: Record<string, unknown>) => ReactLocal.createElement(View, props),
        },
        useSharedValue: (v: unknown) => ({ value: v }),
        useAnimatedStyle: (fn: () => unknown) => fn(),
        withTiming: (v: unknown) => v,
        Easing: { out: (e: unknown) => e, cubic: (x: unknown) => x },
    };
});

jest.mock('@/styles/global', () => {
    const actual = jest.requireActual('@/styles/global');
    return { ...actual, useThemeColors: () => THEME };
});

// The FAB pulls sqlite + contexts + the entry form; irrelevant to layout geometry.
jest.mock('@/components/AddEntryButton', () => ({ AddEntryButton: () => null }));

import { Layout } from '@/components/PageContainer';

const flat = (node: any) => StyleSheet.flatten(node?.props?.style) || {};

describe('Layout — full-height (useScrollView=false) content is not transform-animated', () => {
    it('renders children with NO transform style anywhere (Statistics blank-screen regression)', async () => {
        const view = await render(
            <Layout useScrollView={false}>
                <Text testID="fh-child">content</Text>
            </Layout>,
        );

        // Content is present (the fix must not drop children).
        expect(view.getByTestId('fh-child')).toBeTruthy();

        // No element in the tree carries a `transform` — a reanimated translateY on
        // the flex:1 container is precisely what pushed Statistics off-screen.
        const withTransform = view.container.queryAll(
            (node: any) => flat(node).transform !== undefined,
        );
        expect(withTransform).toHaveLength(0);

        // The full-height wrapper still fills the screen (flex:1), just statically.
        const flexFill = view.container.queryAll((node: any) => flat(node).flex === 1);
        expect(flexFill.length).toBeGreaterThan(0);
    });

    it('still renders children in the scrolling (useScrollView=true) branch', async () => {
        // Control: the content-sized Animated.View inside the ScrollView is safe to
        // animate (Home/Insights). We only assert content survives here.
        const view = await render(
            <Layout>
                <Text testID="sv-child">content</Text>
            </Layout>,
        );
        expect(view.getByTestId('sv-child')).toBeTruthy();
    });
});
