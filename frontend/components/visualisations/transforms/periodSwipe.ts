// periodSwipe.ts
//
// The DECISION layer for "the user dragged the Statistics page sideways, does
// that step the period, and which way?".
//
// Deliberately pure and RN-free: the gesture layer (hooks/usePeriodSwipe.ts)
// owns the Animated value and the RNGH handler, this file owns every threshold
// and every rule. That split is what makes the rules testable at all, a Pan
// gesture cannot be driven from jest, but `resolveSwipe(dx, vx, …)` can be
// tabled exhaustively.
//
// DIRECTION CONVENTION, the content follows the finger, like paging a book:
// dragging RIGHT (dx > 0) pulls the PAST in from the left edge, so it is a
// 'back' step. Dragging LEFT (dx < 0) is 'forward', toward the present. This is
// the same mapping as the ‹ › chevrons in PeriodNavigator (‹ = back, on the
// left), so the two input methods never contradict each other.

/** Which way a committed swipe steps the period. Mirrors TimeframeContext. */
export type SwipeDirection = 'back' | 'forward';

/** Everything the decision needs: the gesture, plus the current bounds. */
export interface SwipeInput {
    /** Total horizontal translation of the gesture, in px. Positive = rightward. */
    dx: number;
    /** Horizontal velocity at release, in px/s. Positive = rightward. */
    vx: number;
    canGoBack: boolean;
    canGoForward: boolean;
}

export interface SwipeThresholds {
    /** Distance at which a slow, deliberate drag commits, in px. */
    distance: number;
    /** Velocity at which a short flick commits, in px/s. */
    velocity: number;
}

/**
 * Commit thresholds.
 *
 * `distance: 72`, comfortably past the 24px `activeOffsetX` that lets the pan
 * win against vertical scrolling in the first place, so an accidental
 * activation while scrolling can still be abandoned; and roughly a fifth of a
 * phone's width, which is the range Android's own ViewPager-style paging uses
 * for a "you clearly meant this" drag.
 *
 * `velocity: 600` px/s, a flick. Below this a fast-but-short movement is more
 * likely a scroll that skidded sideways than an intent to page.
 */
export const SWIPE_THRESHOLDS: SwipeThresholds = {
    distance: 72,
    velocity: 600,
};

/**
 * How much of the finger's travel the content follows while the gesture is
 * still live. Well under 1 on purpose: this is a page STEP, not a carousel, so
 * the content should acknowledge the drag without implying the next period is
 * already rendered just off-screen.
 */
export const DRAG_FOLLOW_RATIO = 0.35;

/** Follow ratio when that direction is out of bounds, a stiff rubber band. */
export const DRAG_RUBBER_BAND_RATIO = 0.12;

/** Cap on the live follow, in px. Keeps a long drag from emptying the screen. */
export const MAX_DRAG_OFFSET = 96;

/** Cap on the rubber band, in px. Deliberately tiny: it means "nothing there". */
export const MAX_RUBBER_BAND_OFFSET = 28;

const clamp = (value: number, min: number, max: number): number =>
    Math.max(min, Math.min(max, value));

/** Guards against NaN/Infinity reaching the animation layer as a translate. */
const finite = (value: number): number => (Number.isFinite(value) ? value : 0);

/**
 * Which way a translation of `dx` points, or `null` for no movement at all.
 * Shared by the decision and the drag-follow so they can never disagree about
 * which bound applies to the drag in progress.
 */
export const swipeDirection = (dx: number): SwipeDirection | null => {
    const d = finite(dx);
    if (d === 0) return null;
    return d > 0 ? 'back' : 'forward';
};

/** Is a step in `direction` currently possible? */
const canStepIn = (
    direction: SwipeDirection,
    canGoBack: boolean,
    canGoForward: boolean,
): boolean => (direction === 'back' ? canGoBack : canGoForward);

/**
 * The decision. Returns the direction to step, or `null` to spring back.
 *
 * Committing takes EITHER a long-enough drag OR a fast-enough flick in the same
 * direction. The two are alternatives because they describe different gestures:
 * a slow deliberate drag never builds velocity, and a flick is over before it
 * covers 72px.
 *
 * A fast flick that OPPOSES the drag cancels outright, even past the distance
 * threshold, dragging out and then whipping back is how a user says "no, not
 * that" mid-gesture, and honouring the distance there would page anyway.
 *
 * Bounds are enforced last, so a committed-but-blocked swipe returns `null` and
 * the caller rubber-bands instead of silently no-opping.
 */
export const resolveSwipe = (
    { dx, vx, canGoBack, canGoForward }: SwipeInput,
    thresholds: SwipeThresholds = SWIPE_THRESHOLDS,
): SwipeDirection | null => {
    const distance = finite(dx);
    const velocity = finite(vx);
    const direction = swipeDirection(distance);
    if (direction === null) return null;

    const fastEnough = Math.abs(velocity) >= thresholds.velocity;
    const agrees = Math.sign(velocity) === Math.sign(distance);

    // A fast reversal is an explicit cancel, whatever the distance says.
    if (fastEnough && !agrees) return null;

    const committed = Math.abs(distance) >= thresholds.distance || fastEnough;
    if (!committed) return null;

    return canStepIn(direction, canGoBack, canGoForward) ? direction : null;
};

/**
 * Live translate for the content while the finger is down: a damped follow when
 * that direction can step, a much stiffer and tightly-capped rubber band when
 * it cannot (so "there is nothing further back" is felt, not just ignored).
 */
export const dragOffset = (dx: number, canStep: boolean): number => {
    const distance = finite(dx);
    const ratio = canStep ? DRAG_FOLLOW_RATIO : DRAG_RUBBER_BAND_RATIO;
    const cap = canStep ? MAX_DRAG_OFFSET : MAX_RUBBER_BAND_OFFSET;
    return clamp(distance * ratio, -cap, cap);
};

/**
 * Convenience for the gesture layer: the live translate for `dx` given the
 * current bounds, picking the bound that matches the drag's own direction.
 */
export const dragOffsetForBounds = (
    dx: number,
    canGoBack: boolean,
    canGoForward: boolean,
): number => {
    const direction = swipeDirection(dx);
    if (direction === null) return 0;
    return dragOffset(dx, canStepIn(direction, canGoBack, canGoForward));
};
