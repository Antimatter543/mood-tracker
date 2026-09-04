// lineChartGeometry.ts
//
// PURE geometry for the app's OWN interactive charts (MoodLineChart on
// Statistics, and the bar renderer that shares its axis conventions). Zero
// React / react-native / react-native-svg imports so every rule below is
// unit-testable — the renderers are thin.
//
// `chartGeometry.ts` owns the point/path math (it is shared with the Home week
// chart). This module owns what the Home chart deliberately does NOT have:
//   - a resolvable Y DOMAIN (fixed 0..10 for comparability, or a fitted range
//     that zooms in on the data — the answer to "I can't see the differences"),
//   - DRAWN gridlines + y-axis labels (Statistics is the analytical screen; the
//     Home card keeps the scale implied),
//   - the mood-coloured vertical GRADIENT that makes a dip read as a colour
//     change and not just a wiggle,
//   - the hit-testing a hold-to-scrub gesture needs.

import { moodAccentRgb, moodAlpha, MOOD_COLOR_MIN_ALPHA, MOOD_COLOR_MAX_ALPHA } from '@/components/timeline/moodColor';
import {
    MOOD_DOMAIN,
    MOOD_MAX,
    MOOD_MIN,
    valueToY,
    type ChartDims,
    type ValueDomain,
} from './chartGeometry';

/** How the vertical axis is scaled. */
export type DomainMode =
    /** Always 0..10. Days/periods stay comparable at a glance. */
    | 'fixed'
    /** Zoom to the data's own range (padded). Small differences become visible. */
    | 'fit';

/** Smallest span a fitted domain may have — below this the noise looks like signal. */
export const FIT_MIN_SPAN = 3;
/** Fraction of the data range added as breathing room above and below. */
const FIT_PAD_RATIO = 0.15;
/** Absolute floor for that padding, so a near-flat series still gets air. */
const FIT_PAD_MIN = 0.5;

const clamp = (n: number, lo: number, hi: number): number =>
    Math.min(hi, Math.max(lo, n));

/**
 * Resolve the vertical domain for a series.
 *
 * `'fixed'` is always the mood domain (0..10). `'fit'` pads the data's own
 * range, snaps the bounds to INTEGERS (so the gridline labels are whole moods,
 * never "6.37"), clamps inside 0..10 (no mood exists outside it), and widens to
 * at least {@link FIT_MIN_SPAN} — a two-point series spanning 0.2 of a mood
 * would otherwise render as a dramatic mountain range.
 *
 * Degenerate input (no finite values at all) falls back to the fixed domain
 * rather than producing an empty or inverted range: an empty database is a real
 * code path on this screen.
 */
export const resolveDomain = (
    values: readonly (number | null | undefined)[],
    mode: DomainMode
): ValueDomain => {
    if (mode === 'fixed') return MOOD_DOMAIN;

    let min = Infinity;
    let max = -Infinity;
    for (const v of values) {
        if (typeof v !== 'number' || !Number.isFinite(v)) continue;
        if (v < min) min = v;
        if (v > max) max = v;
    }
    if (min === Infinity) return MOOD_DOMAIN;

    const pad = Math.max(FIT_PAD_MIN, (max - min) * FIT_PAD_RATIO);
    let lo = clamp(Math.floor(min - pad), MOOD_MIN, MOOD_MAX);
    let hi = clamp(Math.ceil(max + pad), MOOD_MIN, MOOD_MAX);

    // Widen to the minimum span. Grow UPWARD first (headroom above a good mood
    // reads more naturally than an unreachable basement below a bad one), then
    // downward, and stop once the whole 0..10 scale is used.
    while (hi - lo < FIT_MIN_SPAN) {
        if (hi < MOOD_MAX) hi += 1;
        else if (lo > MOOD_MIN) lo -= 1;
        else break;
    }

    return { min: lo, max: hi };
};

export type GridLine = {
    /** The domain value this line sits at. */
    value: number;
    /** Its y pixel coordinate. */
    y: number;
    /** The axis label to draw at the left (integers only — see resolveDomain). */
    label: string;
};

/** Candidate tick steps, smallest first. */
const TICK_STEPS = [1, 2, 5] as const;
/** Beyond this many lines the axis is clutter, not scale. */
const MAX_GRID_LINES = 6;

/**
 * Gridlines at whole-mood values across `domain`, at most
 * {@link MAX_GRID_LINES} of them. The fixed 0..10 domain lands on
 * 0/2/4/6/8/10; a fitted 5..9 domain lands on every integer.
 *
 * Returned oldest-to-newest in DOMAIN order (bottom of the plot first), so a
 * renderer can map them straight to `<Line>` elements.
 */
export const buildGridLines = (domain: ValueDomain, dims: ChartDims): GridLine[] => {
    const span = domain.max - domain.min;
    if (!Number.isFinite(span) || span <= 0) return [];

    const step =
        TICK_STEPS.find((s) => span / s <= MAX_GRID_LINES - 1) ??
        Math.ceil(span / (MAX_GRID_LINES - 1));

    const lines: GridLine[] = [];
    for (let v = domain.min; v <= domain.max + 1e-9; v += step) {
        const value = Math.round(v);
        lines.push({ value, y: valueToY(value, dims, domain), label: String(value) });
    }
    return lines;
};

/**
 * Index (into `xs`) of the x coordinate nearest `x`.
 *
 * `xs` is the ascending x list of the points a scrub may LAND on — the REAL
 * data points only, so a hold never reports a mood for a day the user never
 * logged. Returns null for an empty list (the caller must render no cursor);
 * a touch past either end clamps to that end rather than releasing the cursor,
 * which is what makes dragging off the edge feel solid instead of glitchy.
 */
export const nearestIndex = (x: number, xs: readonly number[]): number | null => {
    if (xs.length === 0) return null;
    let best = 0;
    let bestDist = Math.abs(xs[0] - x);
    for (let i = 1; i < xs.length; i++) {
        const d = Math.abs(xs[i] - x);
        // Strictly-less keeps the EARLIER point on an exact tie, so a scrub
        // across a midpoint switches once, at the midpoint, in both directions.
        if (d < bestDist) {
            best = i;
            bestDist = d;
        }
    }
    return best;
};

/**
 * Left offset for a tooltip of `tooltipWidth` centred on `anchorX`, kept fully
 * inside `[0, containerWidth]` with a `margin` gutter.
 *
 * Clamping (rather than mirroring the bubble to the other side of the finger)
 * is deliberate: the bubble stays visually attached to the cursor line for
 * every point except the outermost two, where it slides instead of jumping —
 * a jump at the edges reads as a rendering bug during a continuous drag.
 * A tooltip wider than the container pins to the left margin.
 */
export const clampTooltipLeft = (
    anchorX: number,
    tooltipWidth: number,
    containerWidth: number,
    margin = 8
): number => {
    const maxLeft = containerWidth - tooltipWidth - margin;
    if (maxLeft <= margin) return margin;
    return clamp(anchorX - tooltipWidth / 2, margin, maxLeft);
};

export type GradientStop = {
    /** 0 = top of the plot (domain max), 1 = bottom (domain min). */
    offset: number;
    /** `rgb(r, g, b)` — the theme accent. Opacity is carried separately. */
    color: string;
    /** 0..1, applied as the SVG stop-opacity. */
    opacity: number;
};

/** Stops per gradient. Five reads as a smooth ramp without bloating the DOM. */
const GRADIENT_STOPS = 5;

/**
 * Vertical gradient stops built from the app's canonical mood ramp
 * (`moodColor`'s accent + alpha curve — see components/timeline/moodColor.ts),
 * so a chart's colour means exactly what a heatmap cell or a timeline dot's
 * colour means. There is deliberately no second, hue-based palette: mood
 * intensity is expressed in the ONE accent every theme defines.
 *
 * `minOpacity` exists because the canonical ramp bottoms out at 0.2 alpha — a
 * FILL can live there, but a 3px stroke at 0.2 is effectively invisible, which
 * is precisely the "not bright enough / I can't see the low days" complaint
 * this chart replaces. Callers drawing a line pass a raised floor; the ramp's
 * SHAPE (higher mood = stronger) is preserved by rescaling, not by re-deriving.
 *
 * Offsets run top-down, matching an SVG `LinearGradient` with x1/y1 = 0,0 and
 * x2/y2 = 0,1: offset 0 is `domain.max`.
 */
export const buildMoodGradientStops = (
    accent: string,
    options: {
        domain?: ValueDomain;
        minOpacity?: number;
        maxOpacity?: number;
        stopCount?: number;
    } = {}
): GradientStop[] => {
    const {
        domain = MOOD_DOMAIN,
        minOpacity = MOOD_COLOR_MIN_ALPHA,
        maxOpacity = MOOD_COLOR_MAX_ALPHA,
        stopCount = GRADIENT_STOPS,
    } = options;

    const rgb = moodAccentRgb(accent);
    const color = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
    const n = Math.max(2, Math.floor(stopCount));
    const rampSpan = MOOD_COLOR_MAX_ALPHA - MOOD_COLOR_MIN_ALPHA;

    return Array.from({ length: n }, (_, i) => {
        const offset = i / (n - 1);
        // offset 0 is the TOP of the plot, which is the domain MAXIMUM.
        const value = domain.max - offset * (domain.max - domain.min);
        // Where this mood sits on the canonical ramp, 0..1 …
        const t = rampSpan <= 0 ? 1 : (moodAlpha(value) - MOOD_COLOR_MIN_ALPHA) / rampSpan;
        // … rescaled into the caller's legible opacity window.
        const opacity = minOpacity + t * (maxOpacity - minOpacity);
        return { offset, color, opacity: Math.round(opacity * 1000) / 1000 };
    });
};
