// chartGeometry.test.ts — exhaustive geometry coverage for the custom Home chart.
//
// Path math is the class of bug tests catch (tasks/lessons.md). These pin:
//   - the mood->y and index->x mappings (orientation + endpoints),
//   - single point / empty / all-same / leading+trailing null / interior gap,
//   - the no-overshoot invariant (every path coordinate stays within the real
//     points' y-range — straight segments can't overshoot, this proves it),
//   - the area always closes to the baseline,
//   - degenerate dims never throw or NaN.

import {
    buildChartGeometry,
    moodToY,
    indexToX,
    MOOD_MIN,
    MOOD_MAX,
    type ChartDims,
} from '@/components/visualisations/transforms/chartGeometry';

const DIMS: ChartDims = {
    width: 300,
    height: 140,
    padX: 12,
    padTop: 16,
    padBottom: 24,
};

// Plot box for DIMS: x in [12, 288], y in [16, 116] (height 140 - 24 bottom).
const PLOT_TOP = DIMS.padTop; // 16
const PLOT_BOTTOM = DIMS.height - DIMS.padBottom; // 116

/** Pull all numeric coordinates out of an SVG `d` (the numbers after cmd letters). */
const coordsOf = (d: string): number[] =>
    (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);

/** Just the y values (odd positions: M x y L x y ...). */
const ysOf = (d: string): number[] => coordsOf(d).filter((_, i) => i % 2 === 1);
const xsOf = (d: string): number[] => coordsOf(d).filter((_, i) => i % 2 === 0);

describe('moodToY / indexToX mappings', () => {
    it('maps mood 0 to the baseline (bottom) and 10 to the top', () => {
        expect(moodToY(MOOD_MIN, DIMS)).toBeCloseTo(PLOT_BOTTOM, 5);
        expect(moodToY(MOOD_MAX, DIMS)).toBeCloseTo(PLOT_TOP, 5);
    });

    it('maps the mood midpoint to the vertical middle of the plot', () => {
        expect(moodToY(5, DIMS)).toBeCloseTo((PLOT_TOP + PLOT_BOTTOM) / 2, 5);
    });

    it('clamps out-of-range moods to the plot bounds', () => {
        expect(moodToY(-3, DIMS)).toBeCloseTo(PLOT_BOTTOM, 5);
        expect(moodToY(99, DIMS)).toBeCloseTo(PLOT_TOP, 5);
    });

    it('spreads indices evenly and centers a single slot', () => {
        expect(indexToX(0, 7, DIMS)).toBeCloseTo(DIMS.padX, 5); // first at left inset
        expect(indexToX(6, 7, DIMS)).toBeCloseTo(DIMS.width - DIMS.padX, 5); // last at right inset
        expect(indexToX(3, 7, DIMS)).toBeCloseTo((DIMS.padX + (DIMS.width - DIMS.padX)) / 2, 5);
        // single slot is centered
        expect(indexToX(0, 1, DIMS)).toBeCloseTo(DIMS.width / 2, 5);
    });
});

describe('buildChartGeometry — full week of data', () => {
    const week = [5, 6, 7, 8, 6, 4, 9];
    const g = buildChartGeometry(week, DIMS);

    it('produces one point per slot, all real, none missing', () => {
        expect(g.points).toHaveLength(7);
        expect(g.points.every((p) => !p.missing)).toBe(true);
        expect(g.realPoints).toHaveLength(7);
    });

    it('draws a single connected solid line with 7 vertices and no gaps', () => {
        expect(g.linePath.startsWith('M')).toBe(true);
        expect((g.linePath.match(/[ML]/g) ?? [])).toHaveLength(7); // M + 6 L
        expect(g.gapPaths).toHaveLength(0);
    });

    it('closes the area down to the baseline', () => {
        expect(g.areaPath.endsWith('Z')).toBe(true);
        expect(g.baselineY).toBeCloseTo(PLOT_BOTTOM, 5);
        // The area must reference the baseline y at least twice (down + across).
        const baselineHits = ysOf(g.areaPath).filter(
            (y) => Math.abs(y - g.baselineY) < 0.01
        );
        expect(baselineHits.length).toBeGreaterThanOrEqual(2);
    });

    it('never overshoots: every LINE y is within the real points y-range', () => {
        const realYs = g.realPoints.map((p) => p.y);
        const minY = Math.min(...realYs);
        const maxY = Math.max(...realYs);
        for (const y of ysOf(g.linePath)) {
            expect(y).toBeGreaterThanOrEqual(minY - 0.01);
            expect(y).toBeLessThanOrEqual(maxY + 0.01);
        }
    });

    it('keeps all x within the plot width', () => {
        for (const x of xsOf(g.linePath)) {
            expect(x).toBeGreaterThanOrEqual(DIMS.padX - 0.01);
            expect(x).toBeLessThanOrEqual(DIMS.width - DIMS.padX + 0.01);
        }
    });
});

describe('buildChartGeometry — edge cases', () => {
    it('empty array: no points, no paths', () => {
        const g = buildChartGeometry([], DIMS);
        expect(g.points).toHaveLength(0);
        expect(g.linePath).toBe('');
        expect(g.areaPath).toBe('');
        expect(g.gapPaths).toHaveLength(0);
        expect(g.realPoints).toHaveLength(0);
    });

    it('single real point: a dot but no line/area (nothing to connect)', () => {
        const g = buildChartGeometry([7], DIMS);
        expect(g.realPoints).toHaveLength(1);
        expect(g.realPoints[0].y).toBeCloseTo(moodToY(7, DIMS), 5);
        expect(g.linePath).toBe('');
        expect(g.areaPath).toBe('');
        expect(g.gapPaths).toHaveLength(0);
    });

    it('all-same values: a flat line at that mood y', () => {
        const g = buildChartGeometry([6, 6, 6, 6, 6, 6, 6], DIMS);
        const expectedY = moodToY(6, DIMS);
        for (const y of ysOf(g.linePath)) expect(y).toBeCloseTo(expectedY, 5);
        // flat line is still within range (trivially) and closes to baseline.
        expect(g.areaPath.endsWith('Z')).toBe(true);
    });

    it('leading + trailing nulls: line spans only the real middle, dots only real', () => {
        const g = buildChartGeometry([null, null, 5, 6, 7, null, null], DIMS);
        expect(g.realPoints.map((p) => p.index)).toEqual([2, 3, 4]);
        // 3 real consecutive points -> M + 2 L, no gap bridges.
        expect((g.linePath.match(/[ML]/g) ?? [])).toHaveLength(3);
        expect(g.gapPaths).toHaveLength(0);
        // line x must not extend past the real points' x.
        const realXs = g.realPoints.map((p) => p.x);
        for (const x of xsOf(g.linePath)) {
            expect(x).toBeGreaterThanOrEqual(Math.min(...realXs) - 0.01);
            expect(x).toBeLessThanOrEqual(Math.max(...realXs) + 0.01);
        }
    });

    it('interior gap: solid line breaks into runs + a dashed bridge spans the gap', () => {
        // real at 0,1 then gap at 2,3 then real at 4,5,6
        const g = buildChartGeometry([5, 6, null, null, 7, 8, 6], DIMS);
        expect(g.realPoints.map((p) => p.index)).toEqual([0, 1, 4, 5, 6]);
        // solid line = run [0,1] (M+L = 2) + run [4,5,6] (M+L+L = 3) = 5 cmds.
        expect((g.linePath.match(/[ML]/g) ?? [])).toHaveLength(5);
        // exactly ONE interior gap -> one dashed bridge from index1 to index4.
        expect(g.gapPaths).toHaveLength(1);
        const bridge = g.gapPaths[0];
        const bx = xsOf(bridge);
        expect(bx[0]).toBeCloseTo(g.points[1].x, 5);
        expect(bx[1]).toBeCloseTo(g.points[4].x, 5);
    });

    it('two interior gaps: two dashed bridges', () => {
        const g = buildChartGeometry([5, null, 6, null, 7], DIMS);
        expect(g.realPoints.map((p) => p.index)).toEqual([0, 2, 4]);
        expect(g.gapPaths).toHaveLength(2);
        // each real point is isolated (no two adjacent) -> no solid segments.
        expect(g.linePath).toBe('');
        // ...so no area either.
        expect(g.areaPath).toBe('');
    });

    it('all null: nothing drawn, all points missing', () => {
        const g = buildChartGeometry([null, null, null], DIMS);
        expect(g.realPoints).toHaveLength(0);
        expect(g.points.every((p) => p.missing)).toBe(true);
        expect(g.linePath).toBe('');
        expect(g.gapPaths).toHaveLength(0);
    });

    it('treats NaN / non-finite as missing', () => {
        const g = buildChartGeometry([5, NaN, 7], DIMS);
        expect(g.points[1].missing).toBe(true);
        expect(g.realPoints.map((p) => p.index)).toEqual([0, 2]);
    });
});

describe('buildChartGeometry — degenerate dims never NaN/throw', () => {
    it('zero-height plot collapses to the top inset without NaN', () => {
        const dims: ChartDims = { width: 100, height: 0, padX: 4, padTop: 0, padBottom: 0 };
        const g = buildChartGeometry([5, 6, 7], dims);
        for (const p of g.points) {
            expect(Number.isFinite(p.x)).toBe(true);
            expect(Number.isFinite(p.y)).toBe(true);
        }
    });

    it('zero width keeps coordinates finite', () => {
        const dims: ChartDims = { width: 0, height: 120, padX: 0, padTop: 8, padBottom: 8 };
        const g = buildChartGeometry([5, 6], dims);
        for (const x of xsOf(g.linePath)) expect(Number.isFinite(x)).toBe(true);
    });
});
