/**
 * Shared platform mocks, installed for EVERY suite by jest.setup.ts:
 *
 *   react-native-reanimated          the real package cannot load in jest (its
 *                                    native worklets runtime throws on import),
 *                                    so one superset stub covers the app's usage
 *   react-native-safe-area-context   useSafeAreaInsets() returns the settable
 *                                    insets below (default NONE)
 *   @/hooks/useKeyboardHeight        returns the settable height (default 0)
 *
 * Steer them from a test, no per-file jest.mock needed:
 *
 *   import { setInsets, INSETS, setKeyboardHeight, animatedScroll } from '@/testing/platform';
 *   setInsets(INSETS.THREE_BUTTON_NAV);
 *   setKeyboardHeight(804);
 *   expect(animatedScroll.toEnd).toHaveBeenCalled();
 *
 * State resets before every test (jest.afterEnv.ts calls resetPlatform).
 * A suite that needs the REAL module opts out with jest.unmock(...).
 * After jest.resetModules() re-import this module: the mocks read the fresh instance.
 */
import type { EdgeInsets } from 'react-native-safe-area-context';

// ── safe area ───────────────────────────────────────────────────────────────

/** Named device conditions (Pixel 3 dp values). */
export const INSETS = {
    /** No system bars drawn over the app (the jest default). */
    NONE: { top: 0, bottom: 0, left: 0, right: 0 },
    /** Edge-to-edge with gesture navigation: status bar only. */
    GESTURE_NAV: { top: 24, bottom: 0, left: 0, right: 0 },
    /** Edge-to-edge with the 3-button navigation bar. */
    THREE_BUTTON_NAV: { top: 24, bottom: 48, left: 0, right: 0 },
} as const satisfies Record<string, EdgeInsets>;

let insets: EdgeInsets = { ...INSETS.NONE };

/** Set the insets useSafeAreaInsets() returns; unspecified edges are 0. */
export function setInsets(next: Partial<EdgeInsets>): void {
    insets = { ...INSETS.NONE, ...next };
}

export function currentInsets(): EdgeInsets {
    return insets;
}

export function safeAreaMock() {
    const React = require('react');
    const { View } = require('react-native');
    const passthrough = ({ children }: { children?: unknown }) => children ?? null;
    return {
        __esModule: true,
        useSafeAreaInsets: () => insets,
        useSafeAreaFrame: () => ({ x: 0, y: 0, width: 393, height: 786 }),
        SafeAreaProvider: passthrough,
        SafeAreaView: (props: Record<string, unknown>) => React.createElement(View, props),
        SafeAreaInsetsContext: React.createContext(insets),
        initialWindowMetrics: {
            insets: INSETS.NONE,
            frame: { x: 0, y: 0, width: 393, height: 786 },
        },
    };
}

// ── keyboard ────────────────────────────────────────────────────────────────

let keyboardHeight = 0;

/** Set the height useKeyboardHeight() returns (0 = keyboard closed). */
export function setKeyboardHeight(h: number): void {
    keyboardHeight = h;
}

export function keyboardHeightMock() {
    return { __esModule: true, useKeyboardHeight: () => keyboardHeight };
}

// ── reanimated ──────────────────────────────────────────────────────────────

/** Spies behind Animated.ScrollView's imperative handle. */
export const animatedScroll = {
    toEnd: jest.fn(),
    to: jest.fn(),
};

/** A layout-animation builder (FadeIn.duration(200).delay(50) ...): every modifier returns itself. */
function layoutAnimation(): Record<string, unknown> {
    const anim: Record<string, unknown> = {};
    for (const m of ['duration', 'delay', 'easing', 'springify', 'damping', 'stiffness', 'withCallback', 'reduceMotion']) {
        anim[m] = () => anim;
    }
    return anim;
}

export function reanimatedMock() {
    const React = require('react');
    const RN = require('react-native');
    const passthrough = (Comp: unknown) => (props: Record<string, unknown>) =>
        React.createElement(Comp, props);
    const ScrollView = React.forwardRef((props: Record<string, unknown>, ref: unknown) => {
        React.useImperativeHandle(ref, () => ({
            scrollToEnd: (...args: unknown[]) => animatedScroll.toEnd(...args),
            scrollTo: (...args: unknown[]) => animatedScroll.to(...args),
        }));
        return React.createElement(RN.ScrollView, props);
    });
    const Animated = {
        View: passthrough(RN.View),
        Text: passthrough(RN.Text),
        Image: passthrough(RN.Image),
        ScrollView,
        createAnimatedComponent: <T,>(Comp: T) => Comp,
    };
    const identity = <T,>(v: T) => v;
    const ease = (x: number) => x;
    return {
        __esModule: true,
        default: Animated,
        ...Animated,
        useSharedValue: <T,>(value: T) => ({ value }),
        useAnimatedStyle: <T,>(fn: () => T) => fn(),
        useAnimatedProps: <T,>(fn: () => T) => fn(),
        useDerivedValue: <T,>(fn: () => T) => ({ value: fn() }),
        useAnimatedRef: () => React.useRef(null),
        useAnimatedReaction: () => {},
        useAnimatedKeyboard: () => ({ height: { value: keyboardHeight }, state: { value: 0 } }),
        useAnimatedScrollHandler: () => () => {},
        withTiming: identity,
        withSpring: identity,
        withDelay: (_ms: number, v: unknown) => v,
        withSequence: (...vs: unknown[]) => vs[vs.length - 1],
        withRepeat: identity,
        cancelAnimation: () => {},
        runOnJS: identity,
        runOnUI: identity,
        Easing: {
            linear: ease, ease, quad: ease, cubic: ease, sin: ease, exp: ease,
            in: identity, out: identity, inOut: identity,
            bezier: () => ease,
        },
        FadeIn: layoutAnimation(),
        FadeOut: layoutAnimation(),
        FadeInDown: layoutAnimation(),
        FadeOutDown: layoutAnimation(),
        FadeInUp: layoutAnimation(),
        FadeOutUp: layoutAnimation(),
        LinearTransition: layoutAnimation(),
    };
}

// ── reset ───────────────────────────────────────────────────────────────────

/** Back to defaults: no insets, keyboard closed, scroll spies cleared. Runs before every test. */
export function resetPlatform(): void {
    insets = { ...INSETS.NONE };
    keyboardHeight = 0;
    animatedScroll.toEnd.mockReset();
    animatedScroll.to.mockReset();
}
