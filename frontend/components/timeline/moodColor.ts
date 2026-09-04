// moodColor.ts
//
// The canonical mood -> color mapping for the app. Originally lived inline in
// `components/visualisations/CustomHeatMap.tsx` (`getMoodColor` + a local
// `hexToRgba`); extracted here so the Timeline and the Heatmap render mood with
// the EXACT same scale (no second palette) and so the ramp is unit-testable.
//
// Convention (matches the heatmap's "darker = higher mood" subtitle): a mood is
// normalized to 0..1 (mood/10) and mapped to the active theme accent at an
// opacity ramp from 0.2 (low) to 1.0 (high). The accent comes from the theme,
// so all five themes (dark/light/cherry/midnight/forest) stay consistent for
// free — there is no hardcoded green here.

import { parseHexColor } from '@/components/visualisations/chartUtils';

/** Min/max alpha of the accent ramp. Mirrors the heatmap's 0.2..1.0. */
export const MOOD_COLOR_MIN_ALPHA = 0.2;
export const MOOD_COLOR_MAX_ALPHA = 1.0;

/** Fallback RGB if the accent isn't a parseable hex (e.g. an rgba() accent). */
const ACCENT_FALLBACK = { r: 76, g: 175, b: 80 }; // the default green accent

/**
 * The active accent as an `{r,g,b}` triple, with the shared fallback for a
 * non-hex accent. Exported so the chart gradient builder tints from the SAME
 * rgb (and the same fallback) this ramp does, one accent authority, not two.
 */
export const moodAccentRgb = (accent: string): { r: number; g: number; b: number } =>
    parseHexColor(accent) ?? ACCENT_FALLBACK;

/**
 * The ramp's ALPHA for a mood, `MIN_ALPHA + (clamp(mood,0,10)/10) * span`.
 *
 * Split out of {@link moodColor} so the vertical chart gradient can build its
 * stops from the same curve without re-deriving it (and without parsing the
 * alpha back out of an rgba string). Non-finite / null moods have no place on
 * the ramp at all, so they are not this function's concern, `moodColor` still
 * short-circuits those to `emptyColor` before ever calling here.
 */
export const moodAlpha = (mood: number): number => {
    const clamped = Math.min(10, Math.max(0, mood));
    const intensity = clamped / 10; // 0..1
    const alpha =
        MOOD_COLOR_MIN_ALPHA +
        intensity * (MOOD_COLOR_MAX_ALPHA - MOOD_COLOR_MIN_ALPHA);
    // Round to 3dp so the output is stable/snapshot-friendly.
    return Math.round(alpha * 1000) / 1000;
};

/**
 * Map a mood (0..10) to an accent-tinted rgba string.
 *
 * - `mood === null` (or non-finite) -> the supplied `emptyColor` (a muted
 *   surface tint), so "no entry"/degenerate values never render as a vivid 0.
 * - Otherwise: `rgba(accent, 0.2 + (clamp(mood,0,10)/10) * 0.8)`.
 *
 * @param mood        mood value, or null for "no data".
 * @param accent      the active theme accent (hex like `#4CAF50`; rgba falls
 *                    back to the default green RGB for the tint).
 * @param emptyColor  color to return when `mood` is null/non-finite. Defaults
 *                    to fully-transparent so callers that don't pass one get a
 *                    no-op rather than a surprise color.
 */
export const moodColor = (
    mood: number | null | undefined,
    accent: string,
    emptyColor = 'transparent',
): string => {
    if (mood === null || mood === undefined || !Number.isFinite(mood)) {
        return emptyColor;
    }

    const rgb = moodAccentRgb(accent);
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${moodAlpha(mood)})`;
};
