/**
 * WIRING tests for swipe-to-page on the Statistics screen.
 *
 * periodSwipe.test.ts already proves the decision rules. What can still break is
 * everything between a finger and `goBack()`:
 *   - the pan is configured with the exact thresholds that make it lose to a
 *     vertical scroll and to the chart's hold-to-scrub, and win on a flick,
 *   - a committed swipe actually calls goBack/goForward — the right one,
 *   - a blocked or half-hearted swipe calls NEITHER, and buzzes nothing,
 *   - the gesture object survives a re-render, so a drag isn't dropped the
 *     instant the context updates underneath it,
 *   - PeriodSwipe renders its children inside a translated view within a
 *     scroller (the structure the blank-screen P0 constrains).
 *
 * A real Pan gesture cannot be driven from jest, so the hook deliberately
 * exposes the plain `onSwipeMove` / `onSwipeEnd` functions its handlers call —
 * these tests drive those, and separately assert that the gesture is wired to
 * them with the right activation config.
 */
import React from 'react';
import { Text } from 'react-native';
import { act, render, renderHook } from '@testing-library/react-native';
import { Gesture } from 'react-native-gesture-handler';

const mockGoBack = jest.fn();
const mockGoForward = jest.fn();
let mockCanGoBack = true;
let mockCanGoForward = true;

jest.mock('@/context/TimeframeContext', () => ({
    useTimeframe: () => ({
        goBack: mockGoBack,
        goForward: mockGoForward,
        canGoBack: mockCanGoBack,
        canGoForward: mockCanGoForward,
    }),
}));

const mockHapticPageStep = jest.fn();
jest.mock('@/lib/haptics', () => ({ hapticPageStep: () => mockHapticPageStep() }));

import PeriodSwipe from '@/components/PeriodSwipe';
import {
    ACTIVE_OFFSET_X,
    FAIL_OFFSET_Y,
    usePeriodSwipe,
} from '@/hooks/usePeriodSwipe';
import { MAX_DRAG_OFFSET } from '@/components/visualisations/transforms/periodSwipe';

/** Long enough to outlast the slide-out + slide-in of a committed step. */
const AFTER_ANIMATION_MS = 1000;

beforeEach(() => {
    jest.clearAllMocks();
    mockCanGoBack = true;
    mockCanGoForward = true;
    jest.useFakeTimers();
});

afterEach(() => {
    jest.useRealTimers();
});

const mountHook = async () => {
    const { result, rerender } = await renderHook(() => usePeriodSwipe());
    return { result, rerender };
};

/**
 * Releases a swipe and lets the commit animation run to completion. The period
 * step is dispatched from the slide-out's completion callback (so the content is
 * off-screen when the charts swap), which is why the timers must be advanced
 * before asserting on goBack/goForward.
 */
const releaseSwipe = async (
    result: { current: ReturnType<typeof usePeriodSwipe> },
    dx: number,
    vx = 0,
) => {
    let decision: ReturnType<typeof result.current.onSwipeEnd> = null;
    await act(async () => {
        decision = result.current.onSwipeEnd(dx, vx);
    });
    await act(async () => {
        jest.advanceTimersByTime(AFTER_ANIMATION_MS);
    });
    return decision;
};

describe('usePeriodSwipe — gesture configuration', () => {
    it('activates only past 24px horizontally and fails past 12px vertically', async () => {
        const { result } = await mountHook();
        const { config } = result.current.gesture as unknown as {
            config: Record<string, unknown>;
        };

        // These four numbers ARE the arbitration contract: vertical drags stay
        // with the ScrollView, and the chart's activateAfterLongPress(220) scrub
        // arms long before a still finger travels 24px.
        expect(config.activeOffsetXStart).toBe(-ACTIVE_OFFSET_X);
        expect(config.activeOffsetXEnd).toBe(ACTIVE_OFFSET_X);
        expect(config.failOffsetYStart).toBe(-FAIL_OFFSET_Y);
        expect(config.failOffsetYEnd).toBe(FAIL_OFFSET_Y);
        expect(ACTIVE_OFFSET_X).toBe(24);
        expect(FAIL_OFFSET_Y).toBe(12);
    });

    it('is single-pointer and JS-thread, and claims simultaneity with nothing', async () => {
        const { result } = await mountHook();
        const { config } = result.current.gesture as unknown as {
            config: Record<string, unknown>;
        };

        expect(config.maxPointers).toBe(1);
        // runOnJS keeps the handlers off the worklet thread, which is what lets
        // this file drive RN's Animated directly — see the reanimated note in
        // hooks/usePeriodSwipe.ts. Do not flip it without reading that.
        expect(config.runOnJS).toBe(true);

        // Marking it simultaneous would break the mood chart's scrub
        // arbitration: RNGH only cancels a still-BEGAN handler when the winner
        // is NOT simultaneous with it. The positive control below keeps this
        // assertion from silently passing on a renamed config key.
        expect(config.simultaneousWith).toBeUndefined();
        const control = Gesture.Pan().simultaneousWithExternalGesture(Gesture.Tap());
        expect(
            (control as unknown as { config: Record<string, unknown> }).config
                .simultaneousWith,
        ).toBeDefined();
    });

    it('keeps ONE gesture object across re-renders, so a live drag is not dropped', async () => {
        const { result, rerender } = await mountHook();
        const first = result.current.gesture;

        mockCanGoBack = false;
        await act(async () => {
            rerender(undefined);
        });

        expect(result.current.gesture).toBe(first);
    });
});

describe('usePeriodSwipe — a committed swipe steps the period', () => {
    it('swiping RIGHT goes to the previous period', async () => {
        const { result } = await mountHook();

        expect(await releaseSwipe(result, 200)).toBe('back');
        expect(mockGoBack).toHaveBeenCalledTimes(1);
        expect(mockGoForward).not.toHaveBeenCalled();
    });

    it('swiping LEFT goes to the next period', async () => {
        const { result } = await mountHook();

        expect(await releaseSwipe(result, -200)).toBe('forward');
        expect(mockGoForward).toHaveBeenCalledTimes(1);
        expect(mockGoBack).not.toHaveBeenCalled();
    });

    it('a short fast flick pages too — velocity, not just distance', async () => {
        const { result } = await mountHook();

        expect(await releaseSwipe(result, 30, 900)).toBe('back');
        expect(mockGoBack).toHaveBeenCalledTimes(1);
    });

    it('buzzes once on commit', async () => {
        const { result } = await mountHook();

        await releaseSwipe(result, 200);
        expect(mockHapticPageStep).toHaveBeenCalledTimes(1);
    });

    it('ignores a second swipe while the step animation is still running', async () => {
        const { result } = await mountHook();

        await act(async () => {
            result.current.onSwipeEnd(200, 0);
        });
        // Mid-flight: the content is sliding out and the value is spoken for.
        let second: ReturnType<typeof result.current.onSwipeEnd> = 'back';
        await act(async () => {
            second = result.current.onSwipeEnd(-200, 0);
        });
        expect(second).toBeNull();

        await act(async () => {
            jest.advanceTimersByTime(AFTER_ANIMATION_MS);
        });
        expect(mockGoBack).toHaveBeenCalledTimes(1);
        expect(mockGoForward).not.toHaveBeenCalled();
    });

    it('accepts a new swipe once the previous step has settled', async () => {
        const { result } = await mountHook();

        await releaseSwipe(result, 200);
        await releaseSwipe(result, 200);
        expect(mockGoBack).toHaveBeenCalledTimes(2);
    });
});

describe('usePeriodSwipe — a swipe that must NOT step', () => {
    it('springs back from a half-hearted drag without paging', async () => {
        const { result } = await mountHook();

        expect(await releaseSwipe(result, 40)).toBeNull();
        expect(mockGoBack).not.toHaveBeenCalled();
        expect(mockGoForward).not.toHaveBeenCalled();
        expect(mockHapticPageStep).not.toHaveBeenCalled();
    });

    it('rubber-bands instead of paging past the earliest entry', async () => {
        mockCanGoBack = false;
        const { result } = await mountHook();

        expect(await releaseSwipe(result, 300, 1200)).toBeNull();
        expect(mockGoBack).not.toHaveBeenCalled();
        // No buzz — a haptic here would claim something happened.
        expect(mockHapticPageStep).not.toHaveBeenCalled();
    });

    it('rubber-bands instead of paging into the future from the present', async () => {
        mockCanGoForward = false;
        const { result } = await mountHook();

        expect(await releaseSwipe(result, -300, -1200)).toBeNull();
        expect(mockGoForward).not.toHaveBeenCalled();
        expect(mockHapticPageStep).not.toHaveBeenCalled();
    });

    it('treats a cancelled gesture (reported as a zero drag) as a spring-back', async () => {
        const { result } = await mountHook();

        expect(await releaseSwipe(result, 0, 0)).toBeNull();
        expect(mockGoBack).not.toHaveBeenCalled();
        expect(mockGoForward).not.toHaveBeenCalled();
    });
});

describe('usePeriodSwipe — the live drag', () => {
    /** Reads the Animated.Value behind the transform without a native driver. */
    const currentTranslate = (result: {
        current: ReturnType<typeof usePeriodSwipe>;
    }): number =>
        (
            result.current.animatedStyle.transform[0].translateX as unknown as {
                __getValue: () => number;
            }
        ).__getValue();

    it('follows the finger, damped and capped', async () => {
        const { result } = await mountHook();

        await act(async () => result.current.onSwipeMove(100));
        const followed = currentTranslate(result);
        expect(followed).toBeGreaterThan(0);
        expect(followed).toBeLessThan(100);

        await act(async () => result.current.onSwipeMove(5000));
        expect(currentTranslate(result)).toBe(MAX_DRAG_OFFSET);
    });

    it('moves the content the same way as the finger, both directions', async () => {
        const { result } = await mountHook();

        await act(async () => result.current.onSwipeMove(-100));
        expect(currentTranslate(result)).toBeLessThan(0);
    });

    it('barely moves at a bound — that stiffness IS the "nothing there" signal', async () => {
        mockCanGoBack = false;
        const { result } = await mountHook();

        await act(async () => result.current.onSwipeMove(300));
        const blocked = currentTranslate(result);

        // Same drag, the other way, where a step IS possible.
        await act(async () => result.current.onSwipeMove(-300));
        expect(Math.abs(blocked)).toBeLessThan(Math.abs(currentTranslate(result)));
    });
});

describe('PeriodSwipe — structure', () => {
    it('renders its children inside a translated view within the scroller', async () => {
        const view = await render(
            <PeriodSwipe>
                <Text>a chart</Text>
            </PeriodSwipe>,
        );

        // The pan is attached to the wrapper, an ANCESTOR of the scroller —
        // not to the scroller itself. See the note in PeriodSwipe.tsx.
        expect(view.getByTestId('period-swipe')).toBeTruthy();
        expect(view.getByTestId('period-swipe-scroll')).toBeTruthy();
        const content = view.getByTestId('period-swipe-content');
        expect(content).toBeTruthy();
        expect(view.getByText('a chart')).toBeTruthy();

        // The translate must be on the CONTENT, not on a flex:1 ancestor of the
        // charts — see the blank-screen note in hooks/usePeriodSwipe.ts.
        const style = ([] as unknown[])
            .concat(content.props.style)
            .filter(Boolean) as Record<string, unknown>[];
        expect(style.some((s) => Array.isArray(s.transform))).toBe(true);
    });
});
