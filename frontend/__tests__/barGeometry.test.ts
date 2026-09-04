// barGeometry.test.ts — exhaustive geometry coverage for the Daily-Mood-by-Weekday
// bar chart (DailyMoodBar), which replaces react-native-chart-kit's BarChart.
//
// Bar math is the class of bug tests catch (tasks/lessons.md — see
// chartGeometry.test.ts for the sibling line-chart coverage this mirrors).
// These pin CLASS-LEVEL invariants over the whole array rather than one-off
// examples wherever possible:
//   - every bar's bottom edge sits on the domain baseline,
//   - height is monotonic non-decreasing in value,
//   - a zero-count slot is `empty` + zero-height, for every position
//     including the first and last,
//   - bars never overflow their slot and never overlap a neighbour,
//   - degenerate input (empty array, n=1, zero-size dims) never throws and
//     stays finite.

import {
    buildBarGeometry,
    DEFAULT_BAR_RATIO,
    type BarRect,
} from '@/components/visualisations/transforms/barGeometry';
import { valueToY, leftInset, plotWidth, MOOD_DOMAIN, type ChartDims } from '@/components/visualisations/transforms/chartGeometry';

const DIMS: ChartDims = {
    width: 300,
    height: 220,
    padX: 10,
    padTop: 20,
    padBottom: 20,
    padLeft: 26,
    padRight: 10,
};

const baselineY = (dims: ChartDims = DIMS) => valueToY(MOOD_DOMAIN.min, dims, MOOD_DOMAIN);

describe('buildBarGeometry — a full week of real data', () => {
    const values = [3, 9, 5, 5, 7, 1, 6];
    const counts = [4, 2, 6, 1, 3, 5, 2];
    const bars = buildBarGeometry(values, counts, DIMS);

    it('produces one bar per slot, all non-empty', () => {
        expect(bars).toHaveLength(7);
        expect(bars.every((b) => !b.empty)).toBe(true);
    });

    it('every bar bottom edge equals the baseline — a whole-array invariant, not one bar', () => {
        for (const b of bars) {
            expect(b.y + b.height).toBeCloseTo(baselineY(), 5);
        }
    });

    it('height is monotonically non-decreasing in value across the whole set', () => {
        const byValue = [...bars].sort((a, b) => a.value - b.value);
        for (let i = 1; i < byValue.length; i++) {
            expect(byValue[i].height).toBeGreaterThanOrEqual(byValue[i - 1].height - 1e-9);
        }
    });

    it('bars never overflow their slot and never overlap a neighbour', () => {
        const plotW = plotWidth(DIMS);
        const left = leftInset(DIMS);
        const slotW = plotW / bars.length;
        bars.forEach((b, i) => {
            const slotLeft = left + i * slotW;
            const slotRight = slotLeft + slotW;
            expect(b.x).toBeGreaterThanOrEqual(slotLeft - 1e-6);
            expect(b.x + b.width).toBeLessThanOrEqual(slotRight + 1e-6);
        });
        // No overlap: each bar's right edge is <= the next bar's left edge.
        for (let i = 1; i < bars.length; i++) {
            expect(bars[i - 1].x + bars[i - 1].width).toBeLessThanOrEqual(bars[i].x + 1e-6);
        }
    });

    it('bar width is the slot width scaled by the default ratio, for every slot', () => {
        const plotW = plotWidth(DIMS);
        const slotW = plotW / bars.length;
        for (const b of bars) {
            expect(b.width).toBeCloseTo(slotW * DEFAULT_BAR_RATIO, 5);
        }
    });

    it('bars are centered within their slot', () => {
        const plotW = plotWidth(DIMS);
        const left = leftInset(DIMS);
        const slotW = plotW / bars.length;
        bars.forEach((b, i) => {
            const slotCenter = left + i * slotW + slotW / 2;
            expect(b.x + b.width / 2).toBeCloseTo(slotCenter, 5);
        });
    });

    it('height increases at the domain max and is 0 at the domain min, monotonic between', () => {
        const zero = buildBarGeometry([MOOD_DOMAIN.min], [1], DIMS)[0];
        const full = buildBarGeometry([MOOD_DOMAIN.max], [1], DIMS)[0];
        const mid = buildBarGeometry([(MOOD_DOMAIN.min + MOOD_DOMAIN.max) / 2], [1], DIMS)[0];
        expect(zero.height).toBeCloseTo(0, 5);
        expect(full.height).toBeCloseTo(DIMS.height - DIMS.padTop - DIMS.padBottom, 5);
        expect(mid.height).toBeGreaterThan(zero.height);
        expect(mid.height).toBeLessThan(full.height);
    });

    it('a value above/below the domain clamps rather than overflowing the plot', () => {
        const over = buildBarGeometry([999], [1], DIMS)[0];
        const under = buildBarGeometry([-999], [1], DIMS)[0];
        expect(over.height).toBeCloseTo(DIMS.height - DIMS.padTop - DIMS.padBottom, 5);
        expect(under.height).toBeCloseTo(0, 5);
    });
});

describe('buildBarGeometry — empty slots never render as a fake "mood 0" bar', () => {
    it('a zero-count slot is empty + zero-height, at every position including first and last', () => {
        const n = 7;
        for (let emptyAt = 0; emptyAt < n; emptyAt++) {
            const values = Array.from({ length: n }, (_, i) => (i === emptyAt ? 0 : 5));
            const counts = Array.from({ length: n }, (_, i) => (i === emptyAt ? 0 : 3));
            const bars = buildBarGeometry(values, counts, DIMS);
            expect(bars[emptyAt].empty).toBe(true);
            expect(bars[emptyAt].height).toBe(0);
            // A real mood of exactly 0 with entries is NOT empty — distinguishes
            // "no data" from "a genuinely bad day recorded as 0".
            const realZero = buildBarGeometry([0], [4], DIMS)[0];
            expect(realZero.empty).toBe(false);
        }
    });

    it('a non-finite value is empty even when count is positive (defensive)', () => {
        const bars = buildBarGeometry([NaN, Infinity, -Infinity], [5, 5, 5], DIMS);
        expect(bars.every((b) => b.empty)).toBe(true);
        expect(bars.every((b) => b.height === 0)).toBe(true);
    });

    it('all slots empty: every bar is empty and zero-height, geometry stays well-formed', () => {
        const bars = buildBarGeometry([0, 0, 0], [0, 0, 0], DIMS);
        expect(bars).toHaveLength(3);
        expect(bars.every((b) => b.empty && b.height === 0)).toBe(true);
        for (const b of bars) {
            expect(Number.isFinite(b.x)).toBe(true);
            expect(Number.isFinite(b.y)).toBe(true);
        }
    });
});

describe('buildBarGeometry — degenerate input never throws', () => {
    it('empty arrays return []', () => {
        expect(buildBarGeometry([], [], DIMS)).toEqual([]);
    });

    it('n=1 centers the single bar across the whole plot width', () => {
        const bars = buildBarGeometry([7], [3], DIMS);
        expect(bars).toHaveLength(1);
        const plotW = plotWidth(DIMS);
        const left = leftInset(DIMS);
        expect(bars[0].x + bars[0].width / 2).toBeCloseTo(left + plotW / 2, 5);
        expect(bars[0].width).toBeCloseTo(plotW * DEFAULT_BAR_RATIO, 5);
    });

    it('mismatched values/counts lengths treat the missing tail as empty, not a crash', () => {
        const bars = buildBarGeometry([5, 6, 7], [2], DIMS);
        expect(bars).toHaveLength(3);
        expect(bars[0].empty).toBe(false);
        expect(bars[1].empty).toBe(true); // count undefined -> treated as 0
        expect(bars[2].empty).toBe(true);
    });

    it('zero-size dims: every bar stays finite (never NaN), even if collapsed to nothing', () => {
        const zeroDims: ChartDims = { width: 0, height: 0, padX: 0, padTop: 0, padBottom: 0 };
        const bars = buildBarGeometry([1, 5, 9], [1, 1, 1], zeroDims);
        for (const b of bars) {
            expect(Number.isFinite(b.x)).toBe(true);
            expect(Number.isFinite(b.y)).toBe(true);
            expect(Number.isFinite(b.width)).toBe(true);
            expect(Number.isFinite(b.height)).toBe(true);
        }
    });

    it('zero plot width (insets consume the whole width) collapses bars without NaN', () => {
        const tightDims: ChartDims = { width: 20, height: 100, padLeft: 15, padRight: 15, padX: 0, padTop: 0, padBottom: 0 };
        const bars = buildBarGeometry([4, 8], [1, 1], tightDims);
        for (const b of bars) {
            expect(Number.isFinite(b.x)).toBe(true);
            expect(b.width).toBeGreaterThanOrEqual(0);
        }
    });

    it('a custom barRatio scales bar width without moving slot centers', () => {
        const wide = buildBarGeometry([5, 5], [1, 1], DIMS, { barRatio: 0.9 });
        const narrow = buildBarGeometry([5, 5], [1, 1], DIMS, { barRatio: 0.3 });
        expect(wide[0].width).toBeGreaterThan(narrow[0].width);
        // centers unchanged
        expect(wide[0].x + wide[0].width / 2).toBeCloseTo(narrow[0].x + narrow[0].width / 2, 5);
    });

    it('a custom domain rescales height consistently with valueToY', () => {
        const domain = { min: 0, max: 100 };
        const bars = buildBarGeometry([50], [1], DIMS, { domain });
        const expectedTopY = valueToY(50, DIMS, domain);
        const expectedBaseline = valueToY(0, DIMS, domain);
        expect(bars[0].height).toBeCloseTo(expectedBaseline - expectedTopY, 5);
    });
});

describe('buildBarGeometry — respects asymmetric padLeft/padRight', () => {
    it('the first bar slot starts at padLeft, not padX', () => {
        const dims: ChartDims = { width: 300, height: 200, padX: 10, padTop: 10, padBottom: 10, padLeft: 40, padRight: 8 };
        const bars = buildBarGeometry([1, 2, 3], [1, 1, 1], dims);
        const left = leftInset(dims);
        expect(left).toBe(40);
        expect(bars[0].x).toBeGreaterThanOrEqual(left - 1e-6);
    });
});

describe('BarRect type sanity (compile-time, exercised at runtime)', () => {
    it('empty bars still carry index/count/value fields for the renderer to use', () => {
        const bars: BarRect[] = buildBarGeometry([0], [0], DIMS);
        expect(bars[0].index).toBe(0);
        expect(bars[0].count).toBe(0);
    });
});
