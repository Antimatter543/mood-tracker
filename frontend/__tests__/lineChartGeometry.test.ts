// lineChartGeometry.test.ts — the axis/domain/hit-test math behind MoodLineChart.
//
// Everything here is the class of rule that is invisible in a screenshot and
// silently wrong forever: a fitted domain that inverts on a single point, a
// gradient whose "bright" end is the dim one, a scrub that snaps to the wrong
// side of a midpoint. Prefer CLASS-level invariants (monotonicity, bounds,
// never-throws) over one-off examples.

import {
    buildGridLines,
    buildMoodGradientStops,
    clampTooltipLeft,
    nearestIndex,
    resolveDomain,
    FIT_MIN_SPAN,
} from '@/components/visualisations/transforms/lineChartGeometry';
import {
    indexToX,
    leftInset,
    plotWidth,
    rightInset,
    MOOD_MAX,
    MOOD_MIN,
    type ChartDims,
} from '@/components/visualisations/transforms/chartGeometry';
import {
    MOOD_COLOR_MAX_ALPHA,
    MOOD_COLOR_MIN_ALPHA,
    moodAlpha,
    moodColor,
} from '@/components/timeline/moodColor';

const DIMS: ChartDims = {
    width: 320,
    height: 240,
    padX: 12,
    padLeft: 26,
    padRight: 12,
    padTop: 14,
    padBottom: 12,
};

const ACCENT = '#4CAF50'; // the default green accent (r76 g175 b80)

// ---------------------------------------------------------------------------
// resolveDomain
// ---------------------------------------------------------------------------
describe('resolveDomain — fixed', () => {
    it('is always 0..10, whatever the data', () => {
        expect(resolveDomain([5, 6, 7], 'fixed')).toEqual({ min: MOOD_MIN, max: MOOD_MAX });
        expect(resolveDomain([], 'fixed')).toEqual({ min: MOOD_MIN, max: MOOD_MAX });
        expect(resolveDomain([null, null], 'fixed')).toEqual({ min: MOOD_MIN, max: MOOD_MAX });
    });
});

describe('resolveDomain — fit', () => {
    /** Every fit domain must satisfy these, for ANY input. */
    const assertWellFormed = (values: (number | null)[]) => {
        const d = resolveDomain(values, 'fit');
        expect(Number.isInteger(d.min)).toBe(true);
        expect(Number.isInteger(d.max)).toBe(true);
        expect(d.min).toBeGreaterThanOrEqual(MOOD_MIN);
        expect(d.max).toBeLessThanOrEqual(MOOD_MAX);
        expect(d.max - d.min).toBeGreaterThanOrEqual(FIT_MIN_SPAN);
        return d;
    };

    it('holds the invariants across a spread of shapes', () => {
        const shapes: (number | null)[][] = [
            [7],
            [7, 7, 7],
            [6.4, 6.6],
            [0, 10],
            [0, 0.2],
            [9.8, 10],
            [1, 5, 9],
            [null, 4, null, 5, null],
        ];
        for (const s of shapes) assertWellFormed(s);
    });

    it('contains every data point it was fitted to', () => {
        const values = [3.2, 4.9, 7.7];
        const d = resolveDomain(values, 'fit');
        for (const v of values) {
            expect(v).toBeGreaterThanOrEqual(d.min);
            expect(v).toBeLessThanOrEqual(d.max);
        }
    });

    it('zooms in: a tight cluster gets a much narrower domain than 0..10', () => {
        const d = resolveDomain([6.2, 6.5, 6.9], 'fit');
        // This is the whole point of "Fit" — the differences become visible.
        expect(d.max - d.min).toBeLessThan(MOOD_MAX - MOOD_MIN);
    });

    it('falls back to the fixed domain when there is no finite data', () => {
        expect(resolveDomain([], 'fit')).toEqual({ min: MOOD_MIN, max: MOOD_MAX });
        expect(resolveDomain([null, undefined, NaN], 'fit')).toEqual({
            min: MOOD_MIN,
            max: MOOD_MAX,
        });
    });

    it('a single point still yields a usable, non-degenerate range', () => {
        const d = resolveDomain([7], 'fit');
        expect(d.max).toBeGreaterThan(d.min);
        expect(d.min).toBeLessThanOrEqual(7);
        expect(d.max).toBeGreaterThanOrEqual(7);
    });
});

// ---------------------------------------------------------------------------
// buildGridLines
// ---------------------------------------------------------------------------
describe('buildGridLines', () => {
    it('lands on 0/2/4/6/8/10 for the fixed mood domain', () => {
        const lines = buildGridLines({ min: 0, max: 10 }, DIMS);
        expect(lines.map((l) => l.value)).toEqual([0, 2, 4, 6, 8, 10]);
        expect(lines.map((l) => l.label)).toEqual(['0', '2', '4', '6', '8', '10']);
    });

    it('never draws more than 6 lines, and always at whole moods', () => {
        for (let min = 0; min <= 7; min++) {
            for (let max = min + FIT_MIN_SPAN; max <= 10; max++) {
                const lines = buildGridLines({ min, max }, DIMS);
                expect(lines.length).toBeLessThanOrEqual(6);
                expect(lines.length).toBeGreaterThan(1);
                for (const l of lines) expect(Number.isInteger(l.value)).toBe(true);
            }
        }
    });

    it('y decreases as the value increases (higher mood is higher on screen)', () => {
        const lines = buildGridLines({ min: 0, max: 10 }, DIMS);
        for (let i = 1; i < lines.length; i++) {
            expect(lines[i].y).toBeLessThan(lines[i - 1].y);
        }
    });

    it('stays inside the plot box', () => {
        const lines = buildGridLines({ min: 0, max: 10 }, DIMS);
        for (const l of lines) {
            expect(l.y).toBeGreaterThanOrEqual(DIMS.padTop - 0.01);
            expect(l.y).toBeLessThanOrEqual(DIMS.height - DIMS.padBottom + 0.01);
        }
    });

    it('returns nothing for a degenerate domain instead of looping forever', () => {
        expect(buildGridLines({ min: 5, max: 5 }, DIMS)).toEqual([]);
        expect(buildGridLines({ min: 9, max: 2 }, DIMS)).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// nearestIndex
// ---------------------------------------------------------------------------
describe('nearestIndex', () => {
    const xs = [10, 20, 30, 40];

    it('returns null for an empty list — nothing to land on', () => {
        expect(nearestIndex(15, [])).toBeNull();
    });

    it('a single point always wins, wherever the finger is', () => {
        expect(nearestIndex(-999, [50])).toBe(0);
        expect(nearestIndex(999, [50])).toBe(0);
    });

    it('snaps to the nearest point', () => {
        expect(nearestIndex(9, xs)).toBe(0);
        expect(nearestIndex(21, xs)).toBe(1);
        expect(nearestIndex(29, xs)).toBe(2);
    });

    it('clamps past either end rather than releasing the cursor', () => {
        expect(nearestIndex(-100, xs)).toBe(0);
        expect(nearestIndex(1000, xs)).toBe(xs.length - 1);
    });

    it('an exact midpoint resolves to the EARLIER point, in both directions', () => {
        // 25 is equidistant from 20 and 30. A tie that resolved by scan order
        // would flip depending on which way the finger came from.
        expect(nearestIndex(25, xs)).toBe(1);
        expect(nearestIndex(25, [...xs])).toBe(1);
    });

    it('is monotonic: sweeping right never moves the index left', () => {
        let last = -1;
        for (let x = 0; x <= 50; x += 0.5) {
            const i = nearestIndex(x, xs)!;
            expect(i).toBeGreaterThanOrEqual(last);
            last = i;
        }
    });
});

// ---------------------------------------------------------------------------
// clampTooltipLeft
// ---------------------------------------------------------------------------
describe('clampTooltipLeft', () => {
    const W = 320;
    const TW = 100;

    it('centres the bubble on the cursor in the middle of the chart', () => {
        expect(clampTooltipLeft(160, TW, W)).toBe(110);
    });

    it('never lets the bubble leave the container, for ANY anchor', () => {
        for (let x = -50; x <= W + 50; x += 5) {
            const left = clampTooltipLeft(x, TW, W);
            expect(left).toBeGreaterThanOrEqual(8);
            expect(left + TW).toBeLessThanOrEqual(W - 8 + 0.001);
        }
    });

    it('pins a bubble wider than the container to the left margin', () => {
        expect(clampTooltipLeft(10, 400, W)).toBe(8);
    });
});

// ---------------------------------------------------------------------------
// buildMoodGradientStops
// ---------------------------------------------------------------------------
describe('buildMoodGradientStops', () => {
    it('runs top-down: offset 0 is the domain MAX and the strongest stop', () => {
        const stops = buildMoodGradientStops(ACCENT, { minOpacity: 0.55 });
        expect(stops[0].offset).toBe(0);
        expect(stops[stops.length - 1].offset).toBe(1);
        expect(stops[0].opacity).toBeGreaterThan(stops[stops.length - 1].opacity);
    });

    it('opacity decreases monotonically from top to bottom', () => {
        const stops = buildMoodGradientStops(ACCENT, { minOpacity: 0.55, stopCount: 9 });
        for (let i = 1; i < stops.length; i++) {
            expect(stops[i].opacity).toBeLessThan(stops[i - 1].opacity);
        }
    });

    it('respects the caller’s opacity window at both ends', () => {
        const stops = buildMoodGradientStops(ACCENT, { minOpacity: 0.55, maxOpacity: 1 });
        for (const s of stops) {
            expect(s.opacity).toBeGreaterThanOrEqual(0.55 - 1e-6);
            expect(s.opacity).toBeLessThanOrEqual(1 + 1e-6);
        }
        expect(stops[stops.length - 1].opacity).toBeCloseTo(0.55, 5);
        expect(stops[0].opacity).toBeCloseTo(1, 5);
    });

    it('is the CANONICAL ramp, unrescaled, at the ramp’s own bounds', () => {
        // With the default window the stops must equal moodColor's own alphas —
        // proof this is one palette, not a second one that merely looks similar.
        const stops = buildMoodGradientStops(ACCENT, {
            minOpacity: MOOD_COLOR_MIN_ALPHA,
            maxOpacity: MOOD_COLOR_MAX_ALPHA,
            stopCount: 11,
        });
        stops.forEach((s, i) => {
            const value = 10 - i; // offset 0 is mood 10
            expect(s.opacity).toBeCloseTo(moodAlpha(value), 3);
        });
    });

    it('tints from the theme accent — the same rgb the mood ramp uses', () => {
        const stops = buildMoodGradientStops(ACCENT);
        expect(stops[0].color).toBe('rgb(76, 175, 80)');
        // moodColor produces the same triple, with alpha attached.
        expect(moodColor(10, ACCENT)).toContain('76, 175, 80');
    });

    it('falls back to the default accent rgb for a non-hex accent', () => {
        const stops = buildMoodGradientStops('rgba(1, 2, 3, 0.5)');
        expect(stops[0].color).toBe('rgb(76, 175, 80)');
    });

    it('a fitted domain samples the ramp SLICE for that range', () => {
        const wide = buildMoodGradientStops(ACCENT, { domain: { min: 0, max: 10 } });
        const narrow = buildMoodGradientStops(ACCENT, { domain: { min: 5, max: 9 } });
        // Colour means mood absolutely: a 5..9 view can't reach the ramp's floor.
        expect(narrow[narrow.length - 1].opacity).toBeGreaterThan(
            wide[wide.length - 1].opacity
        );
    });

    it('never returns fewer than two stops, however few are asked for', () => {
        expect(buildMoodGradientStops(ACCENT, { stopCount: 0 }).length).toBe(2);
        expect(buildMoodGradientStops(ACCENT, { stopCount: 1 }).length).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// chartGeometry's asymmetric insets (added for the drawn y axis)
// ---------------------------------------------------------------------------
describe('ChartDims — asymmetric horizontal insets', () => {
    it('defaults both sides to padX, so every symmetric caller is unaffected', () => {
        const symmetric: ChartDims = { width: 300, height: 140, padX: 12, padTop: 16, padBottom: 24 };
        expect(leftInset(symmetric)).toBe(12);
        expect(rightInset(symmetric)).toBe(12);
        expect(plotWidth(symmetric)).toBe(300 - 24);
        expect(indexToX(0, 4, symmetric)).toBe(12);
        expect(indexToX(3, 4, symmetric)).toBe(288);
    });

    it('honours a wider left gutter for the y-axis labels', () => {
        expect(leftInset(DIMS)).toBe(26);
        expect(rightInset(DIMS)).toBe(12);
        expect(indexToX(0, 5, DIMS)).toBe(26);
        expect(indexToX(4, 5, DIMS)).toBe(DIMS.width - 12);
    });

    it('never produces a negative plot width', () => {
        const tiny: ChartDims = {
            width: 10,
            height: 100,
            padX: 0,
            padLeft: 40,
            padRight: 40,
            padTop: 0,
            padBottom: 0,
        };
        expect(plotWidth(tiny)).toBe(0);
        expect(Number.isFinite(indexToX(1, 3, tiny))).toBe(true);
    });
});
