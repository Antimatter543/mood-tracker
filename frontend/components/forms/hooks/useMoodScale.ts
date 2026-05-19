import { useCallback, useMemo } from 'react';

export type MoodPrecision = 'low' | 'high';

export type UseMoodScale = {
    /** Number of "snap units" per integer step (1 for low, 2 for high). */
    scale: number;
    /** Pixel width of one snap interval — driver for ScrollView snapToInterval. */
    itemWidth: number;
    /** Stringified tick values rendered along the scale, in order. */
    values: string[];
    /**
     * Snap a raw mood value to the nearest valid tick for the current
     * precision. Always clamps to [0, 10].
     *   - low precision: integer ticks (0, 1, 2, ..., 10)
     *   - high precision: half-integer ticks (0, 0.5, 1, ..., 10)
     */
    snap: (value: number) => number;
    /**
     * Format a number for display.
     *   - low: '5'
     *   - high integer: '5'   (no trailing zero on whole numbers)
     *   - high half: '5.5'
     */
    format: (value: number) => string;
    /** Convert a scroll offset (px) into a snapped mood value. */
    valueFromOffset: (offsetX: number) => number;
    /** Convert a mood value back into a scroll offset (px). */
    offsetFromValue: (value: number) => number;
};

const DEFAULT_ITEM_WIDTH = 60;

/**
 * useMoodScale — encapsulates the mood scale geometry so MoodSelector becomes
 * a thin renderer.
 *
 * The "snap" rules diverge across precisions in a subtle way (low rounds to
 * integers; high rounds to halves) and that logic was previously duplicated
 * across `handleScroll` and the initial-offset effect in MoodSelector. By
 * pulling both into one function we avoid drift between the two paths — that
 * was the root cause of "scrolling shows 5.5 but on submit the form sends 5"
 * style bugs.
 */
export function useMoodScale({
    precision = 'high',
    itemWidth = DEFAULT_ITEM_WIDTH,
}: {
    precision?: MoodPrecision;
    itemWidth?: number;
} = {}): UseMoodScale {
    const scale = precision === 'high' ? 2 : 1;

    const values = useMemo(() => {
        const length = 10 * scale + 1;
        return Array.from({ length }, (_, i) =>
            (i / scale).toFixed(precision === 'high' ? 1 : 0)
        );
    }, [scale, precision]);

    const snap = useCallback(
        (value: number) => {
            if (!Number.isFinite(value)) return 0;
            const clamped = Math.max(0, Math.min(10, value));
            if (precision === 'high') {
                return Math.round(clamped * 2) / 2;
            }
            return Math.round(clamped);
        },
        [precision]
    );

    const format = useCallback(
        (value: number) => {
            if (precision === 'low') return value.toFixed(0);
            // high: show one decimal only when fractional
            return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
        },
        [precision]
    );

    const valueFromOffset = useCallback(
        (offsetX: number) => {
            const idx = Math.round(offsetX / itemWidth);
            return snap(idx / scale);
        },
        [itemWidth, scale, snap]
    );

    const offsetFromValue = useCallback(
        (value: number) => snap(value) * scale * itemWidth,
        [itemWidth, scale, snap]
    );

    return {
        scale,
        itemWidth,
        values,
        snap,
        format,
        valueFromOffset,
        offsetFromValue,
    };
}
