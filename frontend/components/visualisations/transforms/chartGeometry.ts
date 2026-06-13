// chartGeometry.ts
//
// PURE geometry for the custom Home mood chart (MoodWeekChart). All SVG path /
// point math lives here, with ZERO React or react-native-svg imports, so it is
// fully unit-testable (SVG path math is exactly the class of bug tests catch —
// see tasks/lessons.md). The component is a thin renderer over these outputs.
//
// Domain model
// ------------
// Input is a fixed-length `(number | null)[]` of daily mood averages, oldest
// first. A number is a REAL data point; null is "no entry that day" (MISSING).
// The mood domain is a FIXED 0..10 (not data min/max) so a single point sits at
// a meaningful height and days are comparable — the 0..10 scale is implied, not
// drawn (per the design brief).
//
// What we produce
// ---------------
//  - points: one {x, y, value, missing} per slot. Missing slots still get an x
//    (for the day label) and a y at the baseline-ish midpoint placeholder, but
//    are never connected by the solid line nor dotted as real data.
//  - solid line path: straight segments connecting CONSECUTIVE real points.
//  - dashed gap paths: straight segments BRIDGING a missing span between two
//    real points (so the eye follows continuity without reading the bridge as
//    recorded data — and crucially NOT red, which reads as "bad day").
//  - area path: the solid line closed down to the baseline, for a subtle fill.
//
// Leading/trailing missing slots get NO line (nothing to anchor to) — the chart
// simply starts/ends at the first/last real point.

/** Mood domain — fixed, not derived from the data. */
export const MOOD_MIN = 0;
export const MOOD_MAX = 10;

export type ChartDims = {
    width: number;
    height: number;
    /** Inset from each edge so dots/area aren't clipped at the bounds. */
    padX: number;
    padTop: number;
    padBottom: number;
};

export type ChartPoint = {
    /** Slot index (0..n-1). */
    index: number;
    x: number;
    y: number;
    /** The mood value, or null when this slot is missing. */
    value: number | null;
    /** True when this slot had no entry (null input). */
    missing: boolean;
};

export type ChartGeometry = {
    points: ChartPoint[];
    /** SVG `d` connecting consecutive real points; '' when <2 real points. */
    linePath: string;
    /**
     * SVG `d` strings, one per missing-span bridge between two real points.
     * Rendered dashed. Empty when there are no interior gaps.
     */
    gapPaths: string[];
    /** SVG `d` for the filled area under the solid line; '' when <2 real points. */
    areaPath: string;
    /** The y of the chart baseline (mood == MOOD_MIN). Area closes to this. */
    baselineY: number;
    /** Real (non-missing) points only — what the renderer dots. */
    realPoints: ChartPoint[];
};

/** Clamp a number into [lo, hi]. */
const clamp = (n: number, lo: number, hi: number): number =>
    Math.min(hi, Math.max(lo, n));

/**
 * Map a mood value (0..10, clamped) to a y pixel coordinate. Higher mood = lower
 * y (closer to the top). When the plot area has zero height (degenerate dims)
 * everything collapses to the top inset.
 */
export const moodToY = (mood: number, dims: ChartDims): number => {
    const plotH = Math.max(0, dims.height - dims.padTop - dims.padBottom);
    const t = (clamp(mood, MOOD_MIN, MOOD_MAX) - MOOD_MIN) / (MOOD_MAX - MOOD_MIN);
    // t=0 (mood 0) -> bottom (padTop + plotH); t=1 (mood 10) -> top (padTop).
    return dims.padTop + (1 - t) * plotH;
};

/**
 * Map a slot index to an x pixel coordinate, evenly spread across the inset
 * plot width. A single slot is centered. n<=0 returns padX.
 */
export const indexToX = (index: number, n: number, dims: ChartDims): number => {
    const plotW = Math.max(0, dims.width - dims.padX * 2);
    if (n <= 1) return dims.padX + plotW / 2;
    return dims.padX + (index / (n - 1)) * plotW;
};

/** Round to 2dp for compact, stable (snapshot-friendly) path strings. */
const r = (n: number): number => Math.round(n * 100) / 100;

/**
 * Build a straight-segment polyline `d` from an ordered list of points.
 * Straight segments are used deliberately: they CANNOT overshoot the data range
 * (the chart-kit bezier did — Anti's "bezier overshoot" complaint) and read as
 * clean + systematic. Returns '' for <2 points.
 */
const polyline = (pts: { x: number; y: number }[]): string => {
    if (pts.length < 2) return '';
    return pts
        .map((p, i) => `${i === 0 ? 'M' : 'L'} ${r(p.x)} ${r(p.y)}`)
        .join(' ');
};

/**
 * Compute the full geometry for a slot array.
 *
 * @param values  per-slot mood averages, oldest first; null = missing.
 * @param dims    pixel dimensions + insets.
 */
export const buildChartGeometry = (
    values: (number | null)[],
    dims: ChartDims
): ChartGeometry => {
    const n = values.length;
    const baselineY = moodToY(MOOD_MIN, dims);

    const points: ChartPoint[] = values.map((v, index) => {
        const missing = v === null || v === undefined || !Number.isFinite(v as number);
        const x = indexToX(index, n, dims);
        // A missing slot has no real value; place its placeholder y at the
        // baseline so a stray render never floats it mid-plot. The renderer
        // does not connect or solid-dot missing slots, so this y is only a
        // sensible default for an optional faint "missing" marker.
        const y = missing ? baselineY : moodToY(v as number, dims);
        return { index, x, y, value: missing ? null : (v as number), missing };
    });

    const realPoints = points.filter((p) => !p.missing);

    // Solid line + area: ONLY over consecutive real points. We connect across
    // interior gaps with a separate dashed path, but the SOLID line is drawn
    // segment-by-segment between adjacent-in-data real points so that a gap is
    // visibly dashed, not solid.
    //
    // Build runs of consecutive (by index+1) real points for the solid line.
    const runs: ChartPoint[][] = [];
    let current: ChartPoint[] = [];
    for (const p of points) {
        if (p.missing) {
            if (current.length) runs.push(current);
            current = [];
        } else {
            current.push(p);
        }
    }
    if (current.length) runs.push(current);

    // Solid line = the union of all runs' polylines (each run >=2 points draws).
    const linePath = runs
        .map((run) => polyline(run))
        .filter(Boolean)
        .join(' ');

    // Dashed bridges = between the LAST point of run k and the FIRST point of
    // run k+1 (an interior missing span). Leading/trailing gaps produce no
    // bridge (no real point to anchor on one side).
    const gapPaths: string[] = [];
    for (let k = 0; k < runs.length - 1; k++) {
        const from = runs[k][runs[k].length - 1];
        const to = runs[k + 1][0];
        gapPaths.push(polyline([from, to]));
    }

    // Area = the solid line(s) closed down to the baseline. For multiple runs we
    // close each run independently so isolated segments each get their own fill.
    const areaPath = runs
        .filter((run) => run.length >= 2)
        .map((run) => {
            const top = polyline(run);
            const first = run[0];
            const last = run[run.length - 1];
            // line along the top, then down to baseline, across, and close.
            return `${top} L ${r(last.x)} ${r(baselineY)} L ${r(first.x)} ${r(
                baselineY
            )} Z`;
        })
        .join(' ');

    return { points, linePath, gapPaths, areaPath, baselineY, realPoints };
};
