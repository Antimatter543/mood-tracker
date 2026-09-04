/**
 * usePeriodSwipe — the GESTURE + MOTION layer for paging the Statistics screen
 * through periods by swiping it sideways.
 *
 * The period model already exists (TimeframeContext: `offset`, `goBack`,
 * `goForward`, `canGoBack`, `canGoForward`); this hook only adds a second way
 * to drive it. The chevrons in PeriodNavigator remain the accessible path — the
 * swipe is purely additive, and every rule it obeys lives in the pure
 * `transforms/periodSwipe.ts` so it can be tested without a touchscreen.
 *
 *
 * ── WHY RN's `Animated` AND NOT `reanimated` ────────────────────────────────
 * DO NOT "modernise" this to `useAnimatedStyle`. `components/PageContainer.tsx`
 * documents the on-device root cause at length: a live reanimated
 * `useAnimatedStyle` attached to a container that the Statistics charts
 * re-lay-out under (the ~8 charts each resolve their async query over ~3s after
 * mount) makes reanimated apply animated props against a stale measured frame
 * and shove the whole subtree ~1.6k px off-screen — a blank Statistics tab with
 * no JS re-render at all. That was a shipped P0, root-caused on device
 * 2026-07-13, and the animated view here sits in exactly that position: an
 * ancestor of every chart, re-laid-out repeatedly after mount.
 *
 * RN's built-in `Animated` with `useNativeDriver: true` does not have that bug:
 * the transform is applied by the platform animation module to the view's own
 * node, and is never recomputed from a JS-side measured layout.
 *
 * The gesture is declared `.runOnJS(true)` so RNGH delivers its callbacks on
 * the JS thread as plain functions. That removes the worklet boundary entirely
 * — no `runOnJS` bridging, and no reanimated import anywhere in this file. A
 * page-step drag is a coarse gesture (we sample a damped translation, not a
 * 1:1 carousel), so JS-thread delivery is comfortably good enough.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, useWindowDimensions } from 'react-native';
import { Gesture, type PanGesture } from 'react-native-gesture-handler';

import { useTimeframe } from '@/context/TimeframeContext';
import { hapticPageStep } from '@/lib/haptics';
import {
    dragOffsetForBounds,
    resolveSwipe,
    type SwipeDirection,
} from '@/components/visualisations/transforms/periodSwipe';

/**
 * Horizontal travel before the pan wins arbitration against vertical scrolling.
 *
 * 24px is also the CONTRACT with the mood chart's hold-to-scrub gesture
 * (`Gesture.Pan().activateAfterLongPress(220)` inside this same ScrollView):
 * RNGH cancels a non-simultaneous handler that is still BEGAN when another
 * activates, so a still hold arms the scrub long before this pan reaches 24px,
 * and a quick horizontal flick activates this pan first and fails the scrub.
 * Do NOT lower it, and do NOT mark this gesture simultaneous with anything —
 * either change collapses that arbitration.
 */
export const ACTIVE_OFFSET_X = 24;

/** Vertical travel that fails the pan outright, handing the drag to the scroll. */
export const FAIL_OFFSET_Y = 12;

/** Slide-out on commit. Short — it is the "leaving" half of a page turn. */
const SLIDE_OUT_MS = 150;

/** Slide-in of the new period. Longer + eased out so it settles, not snaps. */
const SLIDE_IN_MS = 200;

/** Spring used when a drag does not commit. Stiff: nothing happened, go back. */
const SPRING_BACK = { stiffness: 220, damping: 26, mass: 0.6 } as const;

/** Fallback slide distance when the window width is unavailable (0 under test). */
const FALLBACK_SLIDE_DISTANCE = 360;

/** What the gesture calls. Split out so tests can drive it without a touchscreen. */
export interface PeriodSwipeApi {
    /** Pan gesture for a `<GestureDetector>`. Stable identity for the mount's life. */
    gesture: PanGesture;
    /** Transform style for the `Animated.View` wrapping the paged content. */
    animatedStyle: { transform: { translateX: Animated.Value }[] };
    /** Live drag feedback while the finger is down. */
    onSwipeMove: (dx: number) => void;
    /**
     * Decide, dispatch and animate on release. Returns the committed direction
     * (or `null` when the drag sprang back) so tests can assert the decision as
     * well as its side effect.
     */
    onSwipeEnd: (dx: number, vx: number) => SwipeDirection | null;
}

export const usePeriodSwipe = (): PeriodSwipeApi => {
    const { goBack, goForward, canGoBack, canGoForward } = useTimeframe();
    const { width } = useWindowDimensions();

    // A lazy state initialiser, not `useRef(new Animated.Value(0))`: the value
    // must be constructed once and stay identical for the mount's life (the
    // animations and the style both close over it), and reading `.current`
    // during render is the pattern React 19's compiler rules reject.
    const [translateX] = useState(() => new Animated.Value(0));
    // A commit owns the animated value from slide-out through slide-in. A second
    // gesture landing inside that window would interleave two timings on one
    // value and could leave the content parked off-screen, so it is ignored.
    const isSteppingRef = useRef(false);

    const springBack = useCallback(() => {
        Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: true,
            ...SPRING_BACK,
        }).start();
    }, [translateX]);

    const onSwipeMove = useCallback(
        (dx: number) => {
            if (isSteppingRef.current) return;
            translateX.setValue(dragOffsetForBounds(dx, canGoBack, canGoForward));
        },
        [translateX, canGoBack, canGoForward],
    );

    const onSwipeEnd = useCallback(
        (dx: number, vx: number): SwipeDirection | null => {
            if (isSteppingRef.current) return null;

            const direction = resolveSwipe({ dx, vx, canGoBack, canGoForward });
            if (direction === null) {
                // Includes the blocked case: a swipe past the earliest entry (or
                // forward from the present) rubber-banded on the way out and now
                // springs back, with no haptic — nothing happened.
                springBack();
                return null;
            }

            hapticPageStep();
            isSteppingRef.current = true;

            // Content leaves the way the finger was going, the period steps while
            // it is off-screen, then the new period enters from the opposite edge.
            const slideDistance = width > 0 ? width : FALLBACK_SLIDE_DISTANCE;
            const exitTo = direction === 'back' ? slideDistance : -slideDistance;

            Animated.timing(translateX, {
                toValue: exitTo,
                duration: SLIDE_OUT_MS,
                easing: Easing.in(Easing.quad),
                useNativeDriver: true,
            }).start(() => {
                if (direction === 'back') goBack();
                else goForward();

                translateX.setValue(-exitTo);
                Animated.timing(translateX, {
                    toValue: 0,
                    duration: SLIDE_IN_MS,
                    easing: Easing.out(Easing.cubic),
                    useNativeDriver: true,
                }).start(() => {
                    isSteppingRef.current = false;
                });
            });

            return direction;
        },
        [canGoBack, canGoForward, goBack, goForward, springBack, translateX, width],
    );

    // The gesture is built ONCE and reads the current handlers through a ref.
    // Rebuilding it whenever `canGoBack`/`offset` change would hand
    // GestureDetector a new handler mid-drag and drop the gesture in progress.
    const handlersRef = useRef({ onSwipeMove, onSwipeEnd });
    useEffect(() => {
        handlersRef.current = { onSwipeMove, onSwipeEnd };
    }, [onSwipeMove, onSwipeEnd]);

    // The ref is only ever DEREFERENCED inside the gesture callbacks, which run
    // on touch and never during render — that indirection is the whole point.
    // The lint rule can't see that through the closure.
    /* eslint-disable react-hooks/refs */
    const gesture = useMemo(
        () =>
            Gesture.Pan()
                .runOnJS(true)
                .maxPointers(1)
                .activeOffsetX([-ACTIVE_OFFSET_X, ACTIVE_OFFSET_X])
                .failOffsetY([-FAIL_OFFSET_Y, FAIL_OFFSET_Y])
                .onUpdate((e) => handlersRef.current.onSwipeMove(e.translationX))
                .onEnd((e, success) => {
                    // A cancelled/failed gesture is reported as a zero drag, which
                    // resolves to "no commit" and springs the content back — one
                    // release path instead of two.
                    handlersRef.current.onSwipeEnd(
                        success ? e.translationX : 0,
                        success ? e.velocityX : 0,
                    );
                }),
        [],
    );
    /* eslint-enable react-hooks/refs */

    const animatedStyle = useMemo(() => ({ transform: [{ translateX }] }), [translateX]);

    return { gesture, animatedStyle, onSwipeMove, onSwipeEnd };
};
