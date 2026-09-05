/**
 * Regression guard for the app's recurring blank-screen class: a live reanimated
 * style on the container that wraps a page's content.
 *
 * ROOT CAUSE: `Layout` (components/PageContainer.tsx) wrapped its children in a
 * reanimated `Animated.View` driving an entrance fade + slide (`opacity` +
 * `transform:[{translateY}]`). On Fabric + reanimated 4, a live animatedStyle on
 * a container whose children re-lay-out AFTER mount corrupts that container's
 * layout: reanimated applies the animated props against a stale measured frame
 * and shoves the whole subtree off-screen, blanking the page with NO JS
 * re-render, no thrown error, and no recovery short of a process restart (a tab
 * switch re-renders the screen, but the native views stay displaced). Verified
 * on-device that the animated PROPERTY is irrelevant, an opacity-only
 * animatedStyle blanked it too.
 *
 * It has now bitten twice:
 *   - 2026-07-13, Statistics (`useScrollView={false}`): ~8 charts each resolve
 *     async data and re-render over ~3s; one of those re-layouts pushed the
 *     subtree ~1.6k px off-screen. Fixed by making THAT branch static.
 *   - 2026-09-05, Home (`useScrollView={true}`): submitting an entry fires a
 *     post-write refresh, Home's cards/chart/ActivityExplorer all re-lay-out,
 *     and everything inside the wrapper vanished while the FAB and tab bar, 
 *     the only Home chrome rendered OUTSIDE it, survived. The 2026-07-13 fix
 *     had blamed `flex: 1` and deliberately left the scrolling branch animated;
 *     that reading was too narrow.
 *
 * The invariant is therefore about BOTH branches, not just the full-height one:
 * nothing Layout renders around a page's content may carry a live reanimated
 * style. These tests FAIL against the pre-fix code and PASS against the fix.
 * They are NOT a full reproduction, the off-screen push is native
 * Fabric+reanimated behaviour jest cannot run, but they deterministically catch
 * any reintroduction of an animated content container.
 */
import { render } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';
import { readFileSync } from 'fs';
import { join } from 'path';

const THEME = { background: '#000', isDark: true };

jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// reanimated's worklet runtime is unavailable under jest. Passthrough
// Animated.View and resolve useAnimatedStyle inline, so whatever style the
// component WOULD drive on the UI thread surfaces as a plain style we can assert
// on. That is exactly how the pre-fix `opacity`/`transform` appeared, which is
// what makes these guards real rather than vacuous.
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

/**
 * The two style props the entrance animation drove. `transform` alone is not
 * enough of an assertion: on-device, an opacity-only animatedStyle blanked the
 * screen just the same, so a future "safe" opacity-only entrance must trip this
 * too.
 */
const ANIMATED_PROPS = ['transform', 'opacity'] as const;

describe('Layout, neither content branch is reanimated-animated', () => {
    it.each([
        ['full-height (useScrollView={false})', false, 'fh-child'],
        ['scrolling (useScrollView={true})', true, 'sv-child'],
    ])('%s renders children with no animated style anywhere', async (_label, useScrollView, testID) => {
        const view = await render(
            <Layout useScrollView={useScrollView}>
                <Text testID={testID}>content</Text>
            </Layout>,
        );

        // The children must still be there, a "fix" that drops content is not a fix.
        expect(view.getByTestId(testID)).toBeTruthy();

        for (const prop of ANIMATED_PROPS) {
            const offenders = view.container.queryAll(
                (node: any) => flat(node)[prop] !== undefined,
            );
            expect(offenders).toHaveLength(0);
        }
    });

    it('keeps the full-height branch filling the screen (flex:1), just statically', async () => {
        const view = await render(
            <Layout useScrollView={false}>
                <Text testID="fh-child">content</Text>
            </Layout>,
        );
        const flexFill = view.container.queryAll((node: any) => flat(node).flex === 1);
        expect(flexFill.length).toBeGreaterThan(0);
    });

    /**
     * Source-level guard. The rendered-tree assertions above depend on the
     * reanimated mock resolving `useAnimatedStyle` inline; a future animation
     * introduced through a different reanimated API (a layout animation, an
     * `entering`/`exiting` prop, `useAnimatedProps`) could drive the native view
     * without surfacing a plain style here, and would slip past them. Layout is
     * the ONE component in the app that must own no reanimated at all, so ban the
     * import outright and keep the rung deterministic.
     */
    it('components/PageContainer.tsx imports nothing from react-native-reanimated', () => {
        const src = readFileSync(
            join(__dirname, '..', 'components', 'PageContainer.tsx'),
            'utf8',
        );
        const code = src
            // Strip comments, the file DOCUMENTS the banned import at length.
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, '');
        expect(code).not.toMatch(/react-native-reanimated/);
        expect(code).not.toMatch(/\bAnimated\./);
    });
});
