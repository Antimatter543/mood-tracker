/**
 * The DECISION layer for swiping the Statistics screen between periods.
 *
 * Every rule the gesture obeys lives in `transforms/periodSwipe.ts` precisely so
 * it can be tabled here — a Pan gesture cannot be driven from jest, so if these
 * rules lived inside the handler they would be untested forever. The tables
 * below are the contract `hooks/usePeriodSwipe.ts` is wired to.
 */
import {
    DRAG_FOLLOW_RATIO,
    DRAG_RUBBER_BAND_RATIO,
    MAX_DRAG_OFFSET,
    MAX_RUBBER_BAND_OFFSET,
    SWIPE_THRESHOLDS,
    dragOffset,
    dragOffsetForBounds,
    resolveSwipe,
    swipeDirection,
    type SwipeDirection,
} from '@/components/visualisations/transforms/periodSwipe';

const OPEN = { canGoBack: true, canGoForward: true };

describe('swipeDirection', () => {
    it('maps a rightward drag to back and a leftward one to forward', () => {
        // Dragging right pulls the PAST in from the left edge — same mapping as
        // the ‹ chevron, which also sits on the left.
        expect(swipeDirection(1)).toBe('back');
        expect(swipeDirection(240)).toBe('back');
        expect(swipeDirection(-1)).toBe('forward');
        expect(swipeDirection(-240)).toBe('forward');
    });

    it('has no direction for no movement, or for a non-finite one', () => {
        expect(swipeDirection(0)).toBeNull();
        expect(swipeDirection(NaN)).toBeNull();
        expect(swipeDirection(Infinity)).toBeNull();
    });
});

describe('resolveSwipe — the commit table', () => {
    type Case = {
        name: string;
        dx: number;
        vx: number;
        canGoBack?: boolean;
        canGoForward?: boolean;
        expected: SwipeDirection | null;
    };

    const cases: Case[] = [
        // ── distance commits, both directions, both sides of the threshold ──
        { name: 'long drag right pages back', dx: 200, vx: 0, expected: 'back' },
        { name: 'long drag left pages forward', dx: -200, vx: 0, expected: 'forward' },
        { name: 'exactly at the distance threshold commits', dx: 72, vx: 0, expected: 'back' },
        { name: 'exactly at the threshold commits leftward too', dx: -72, vx: 0, expected: 'forward' },
        { name: 'one pixel short does not commit', dx: 71, vx: 0, expected: null },
        { name: 'one pixel short leftward does not commit', dx: -71, vx: 0, expected: null },

        // ── velocity commits: a flick is over before it covers 72px ──────────
        { name: 'fast rightward flick pages back on velocity alone', dx: 30, vx: 900, expected: 'back' },
        { name: 'fast leftward flick pages forward on velocity alone', dx: -30, vx: -900, expected: 'forward' },
        { name: 'exactly at the velocity threshold commits', dx: 30, vx: 600, expected: 'back' },
        { name: 'just under the velocity threshold does not', dx: 30, vx: 599, expected: null },

        // ── tiny drags: the noise floor ──────────────────────────────────────
        { name: 'a 2px twitch is not a swipe', dx: 2, vx: 10, expected: null },
        { name: 'a dead-still release is not a swipe', dx: 0, vx: 0, expected: null },

        // ── sign mismatch: dragging out then whipping back is a cancel ───────
        {
            name: 'a fast reversal cancels even past the distance threshold',
            dx: 200,
            vx: -900,
            expected: null,
        },
        {
            name: 'a fast reversal cancels the other way too',
            dx: -200,
            vx: 900,
            expected: null,
        },
        {
            name: 'a SLOW drift back does not cancel — only a real flick does',
            dx: 200,
            vx: -300,
            expected: 'back',
        },
        {
            name: 'velocity with no drag at all has no direction to commit to',
            dx: 0,
            vx: 900,
            expected: null,
        },

        // ── bounds: a committed swipe with nowhere to go is refused ──────────
        {
            name: 'no history behind us: a back swipe is refused',
            dx: 200,
            vx: 0,
            canGoBack: false,
            expected: null,
        },
        {
            name: 'no history behind us: a back FLICK is refused too',
            dx: 30,
            vx: 900,
            canGoBack: false,
            expected: null,
        },
        {
            name: 'already at the present: a forward swipe is refused',
            dx: -200,
            vx: 0,
            canGoForward: false,
            expected: null,
        },
        {
            name: 'a blocked back bound does not block going forward',
            dx: -200,
            vx: 0,
            canGoBack: false,
            expected: 'forward',
        },
        {
            name: 'a blocked forward bound does not block going back',
            dx: 200,
            vx: 0,
            canGoForward: false,
            expected: 'back',
        },
        {
            name: 'both bounds shut (All Time): nothing commits',
            dx: 200,
            vx: 900,
            canGoBack: false,
            canGoForward: false,
            expected: null,
        },

        // ── garbage in ───────────────────────────────────────────────────────
        { name: 'NaN translation is inert', dx: NaN, vx: NaN, expected: null },
        { name: 'Infinite velocity with no drag is inert', dx: 0, vx: Infinity, expected: null },
    ];

    it.each(cases)('$name', ({ dx, vx, canGoBack, canGoForward, expected }) => {
        expect(
            resolveSwipe({
                dx,
                vx,
                canGoBack: canGoBack ?? true,
                canGoForward: canGoForward ?? true,
            }),
        ).toBe(expected);
    });

    it('honours injected thresholds instead of hardcoding its own', () => {
        const loose = { distance: 10, velocity: 100 };
        expect(resolveSwipe({ dx: 12, vx: 0, ...OPEN }, loose)).toBe('back');
        // The same drag is a no-op under the shipped thresholds.
        expect(resolveSwipe({ dx: 12, vx: 0, ...OPEN })).toBeNull();
    });

    // Class-level invariant rather than another row: whatever commits, it can
    // only ever commit in the direction the finger actually moved.
    it('never commits against the direction of travel', () => {
        for (let dx = -400; dx <= 400; dx += 7) {
            for (const vx of [-900, -300, 0, 300, 900]) {
                const decision = resolveSwipe({ dx, vx, ...OPEN });
                if (decision !== null) expect(decision).toBe(swipeDirection(dx));
            }
        }
    });
});

describe('dragOffset — the live follow', () => {
    it('damps the follow so the drag reads as a page step, not a carousel', () => {
        expect(dragOffset(100, true)).toBeCloseTo(100 * DRAG_FOLLOW_RATIO);
        expect(dragOffset(-100, true)).toBeCloseTo(-100 * DRAG_FOLLOW_RATIO);
        expect(DRAG_FOLLOW_RATIO).toBeLessThan(1);
    });

    it('rubber-bands much more stiffly when that direction is blocked', () => {
        expect(dragOffset(100, false)).toBeCloseTo(100 * DRAG_RUBBER_BAND_RATIO);
        expect(Math.abs(dragOffset(100, false))).toBeLessThan(Math.abs(dragOffset(100, true)));
    });

    it('caps both, so a long drag can never empty the screen', () => {
        expect(dragOffset(10_000, true)).toBe(MAX_DRAG_OFFSET);
        expect(dragOffset(-10_000, true)).toBe(-MAX_DRAG_OFFSET);
        expect(dragOffset(10_000, false)).toBe(MAX_RUBBER_BAND_OFFSET);
        expect(dragOffset(-10_000, false)).toBe(-MAX_RUBBER_BAND_OFFSET);
        expect(MAX_RUBBER_BAND_OFFSET).toBeLessThan(MAX_DRAG_OFFSET);
    });

    it('is inert at rest and on garbage input', () => {
        expect(dragOffset(0, true)).toBe(0);
        expect(dragOffset(NaN, true)).toBe(0);
        expect(dragOffset(Infinity, false)).toBe(0);
    });
});

describe('dragOffsetForBounds — picks the bound matching the drag direction', () => {
    it('follows freely when the drag direction can step', () => {
        expect(dragOffsetForBounds(100, true, true)).toBeCloseTo(dragOffset(100, true));
        expect(dragOffsetForBounds(-100, true, true)).toBeCloseTo(dragOffset(-100, true));
    });

    it('rubber-bands only the blocked direction', () => {
        // No history behind: dragging right (back) is stiff, left (forward) free.
        expect(dragOffsetForBounds(100, false, true)).toBeCloseTo(dragOffset(100, false));
        expect(dragOffsetForBounds(-100, false, true)).toBeCloseTo(dragOffset(-100, true));

        // At the present: dragging left (forward) is stiff, right (back) free.
        expect(dragOffsetForBounds(-100, true, false)).toBeCloseTo(dragOffset(-100, false));
        expect(dragOffsetForBounds(100, true, false)).toBeCloseTo(dragOffset(100, true));
    });

    it('never exceeds the cap for ANY input, bounds or direction', () => {
        for (const dx of [-5000, -300, -1, 0, 1, 300, 5000, NaN]) {
            for (const back of [true, false]) {
                for (const fwd of [true, false]) {
                    const offset = dragOffsetForBounds(dx, back, fwd);
                    expect(Number.isFinite(offset)).toBe(true);
                    expect(Math.abs(offset)).toBeLessThanOrEqual(MAX_DRAG_OFFSET);
                }
            }
        }
    });
});

describe('the shipped thresholds', () => {
    // A regression guard, not decoration: the 24px activeOffsetX that lets the
    // pan win arbitration is also what lets an accidental activation be
    // abandoned — only because the commit distance is comfortably past it.
    it('commits well past the 24px gesture-activation offset', () => {
        expect(SWIPE_THRESHOLDS.distance).toBeGreaterThan(24 * 2);
    });
});
