// barGeometry.ts
//
// PURE geometry for the Daily-Mood-by-Weekday bar chart (DailyMoodBar) —
// replaces react-native-chart-kit's BarChart. Zero React / react-native /
// react-native-svg imports, so every rule below is unit-tested; the component
// is a thin renderer over these outputs. Shares the axis conventions of
// `chartGeometry.ts` (fixed 0..10 mood domain) and `lineChartGeometry.ts`
// (gridlines), which this module imports but never duplicates.
//
// Domain model
// ------------
// Input is two parallel arrays, oldest-in-the-week-first (Monday..Sunday, per
// `dayOfWeekPattern.ts`): `values[i]` is the average mood for slot i, and
// `counts[i]` is how many entries fed that average. A slot with `count === 0`
// (or a non-finite value) is EMPTY — it must never render a bar, because a
// zero-height bar at the domain floor is visually identical to "recorded a
// mood of 0", and absence must always read as "no data" (lessons.md, the
// project's standing rule, most recently the MoodWeekChart missing-day dots).
//
// Each slot gets an evenly-spaced column ("slot") across the plot width; the
// bar itself is narrower than its slot (`barRatio`) and horizontally centered
// in it. Every bar's bottom edge sits on the domain-MIN baseline (never
// floating) and its top is `valueToY(value)` — so height is 0 at the domain
// minimum, the full plot height at the domain maximum, and monotonic between.

import { plotWidth, valueToY, leftInset, MOOD_DOMAIN, type ChartDims, type ValueDomain } from './chartGeometry';

/** One rendered (or absent) bar. */
export type BarRect = {
    /** Slot index (0..n-1). */
    index: number;
    /** Left edge of the bar (already centered in its slot). */
    x: number;
    /** Top edge of the bar (== the baseline y when `empty`). */
    y: number;
    /** Bar width — the slot width scaled by `barRatio`. Never negative. */
    width: number;
    /** Bar height in px, 0 when `empty`. Never negative. */
    height: number;
    /** The source value (may be non-finite when `empty`). */
    value: number;
    /** The source entry count for this slot. */
    count: number;
    /**
     * True when this slot has no data (`count <= 0` or a non-finite value).
     * An empty slot MUST NOT be rendered as a bar — `height` is 0 and `y`
     * sits on the baseline purely so the shape stays well-formed; the
     * renderer's job is to skip painting it entirely.
     */
    empty: boolean;
};

/** Bar width as a fraction of its slot. Leaves visible gutters between bars. */
export const DEFAULT_BAR_RATIO = 0.62;

export type BarGeometryOptions = {
    /** Value domain the bars are scaled against. Defaults to the fixed 0..10 mood domain. */
    domain?: ValueDomain;
    /** Fraction (0..1] of the slot width the bar itself occupies. Defaults to {@link DEFAULT_BAR_RATIO}. */
    barRatio?: number;
};

/**
 * Build one {@link BarRect} per slot from parallel `values`/`counts` arrays.
 *
 * Degenerate input is handled without throwing:
 *  - `values.length !== counts.length`: a slot beyond either array's end is
 *    treated as empty (count 0 / value NaN) rather than indexing out of
 *    bounds.
 *  - empty arrays: returns `[]`.
 *  - `n === 1`: the single slot is centered across the whole plot width
 *    (matches `indexToX`'s single-slot convention in chartGeometry.ts).
 *  - zero-size dims (`width`/`height` 0, or insets that consume the whole
 *    width): every bar collapses to zero width/height but stays finite,
 *    never NaN.
 */
export const buildBarGeometry = (
    values: readonly number[],
    counts: readonly number[],
    dims: ChartDims,
    options: BarGeometryOptions = {}
): BarRect[] => {
    const domain = options.domain ?? MOOD_DOMAIN;
    const barRatio = options.barRatio ?? DEFAULT_BAR_RATIO;

    const n = Math.max(values.length, counts.length);
    if (n <= 0) return [];

    const plotW = plotWidth(dims);
    const left = leftInset(dims);
    const slotW = plotW / n;
    const barW = Math.max(0, slotW * barRatio);
    // Bar is centered within its slot — half the leftover gutter on each side.
    const barInset = (slotW - barW) / 2;

    const baselineY = valueToY(domain.min, dims, domain);

    const out: BarRect[] = [];
    for (let i = 0; i < n; i++) {
        const value = values[i];
        const count = counts[i] ?? 0;
        const empty = !Number.isFinite(value) || count <= 0;

        const slotLeft = left + i * slotW;
        const x = slotLeft + barInset;

        if (empty) {
            out.push({ index: i, x, y: baselineY, width: barW, height: 0, value: value as number, count, empty: true });
            continue;
        }

        const topY = valueToY(value, dims, domain);
        // Bars anchor to the baseline regardless of whether the domain is
        // drawn top-down (higher value -> smaller y, the normal case here) —
        // height is always the distance between the value's y and the
        // baseline's y, so this holds even for a hypothetically inverted or
        // degenerate domain.
        const height = Math.max(0, baselineY - topY);
        const y = Math.min(topY, baselineY);

        out.push({ index: i, x, y, width: barW, height, value, count, empty: false });
    }

    return out;
};
