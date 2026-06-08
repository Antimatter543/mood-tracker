// chartConfig.ts
import { useThemeColors } from '@/styles/global';
import { useMemo } from 'react';
import { Dimensions } from 'react-native';

export const CHART_PADDING = 48; // 16px container padding × 2 sides + safe margin
export const SCREEN_WIDTH = Dimensions.get('window').width;

/**
 * Parse a CSS hex (`#RGB` or `#RRGGBB`) into an `{r,g,b}` triple. Returns null
 * for non-hex values (e.g. `rgba(...)` accents) so callers can fall back.
 */
export const parseHexColor = (
    hex: string
): { r: number; g: number; b: number } | null => {
    if (typeof hex !== 'string') return null;
    let h = hex.trim().replace('#', '');
    if (h.length === 3) {
        h = h
            .split('')
            .map((c) => c + c)
            .join('');
    }
    if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return null;
    return {
        r: parseInt(h.substring(0, 2), 16),
        g: parseInt(h.substring(2, 4), 16),
        b: parseInt(h.substring(4, 6), 16),
    };
};

// New hook for theme-aware chart config
export const useChartConfig = () => {
    const colors = useThemeColors();

    return useMemo(() => {
        // Derive the chart line/bar color from the active theme's accent so
        // every theme (dark/light/cherry/midnight/forest) renders its own
        // accent instead of a hardcoded green.
        const rgb = parseHexColor(colors.accent) ?? { r: 76, g: 175, b: 80 };
        const accentColor = (opacity = 1) =>
            `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity})`;

        return {
        backgroundColor: colors.cardBackground,
        backgroundGradientFrom: colors.cardBackground,
        backgroundGradientTo: colors.cardBackground,
        decimalPlaces: 1,
        color: accentColor,
        labelColor: (opacity = 1) => `rgba(${colors.isDark ? '255, 255, 255' : '0, 0, 0'}, ${opacity})`,
        propsForLabels: {
            fontSize: 10,
            fill: colors.text,
        },
        // labelColor: (opacity = 1) => `rgba(255, 255, 255, ${opacity})`,
        style: {
            borderRadius: 16,
        },
        };
    }, [colors]);
};

// Keep other configs for future reference
export const alternativeConfigs = {
    blue: {
        color: (opacity = 1) => `rgba(92, 182, 235, ${opacity})`, // Calming blue
        backgroundGradientFrom: '#2c3e50',  // Dark blue-gray
        backgroundGradientTo: '#3498db',    // Soft blue
        backgroundGradientToOpacity: 0.5,
        propsForDots: {
            r: "6",
            strokeWidth: "2",
            stroke: "#2980b9"  // Deeper blue
        },
    },
    green: {
        backgroundGradientFrom: "#1E2923",
        backgroundGradientFromOpacity: 0,
        backgroundGradientTo: "#08130D",
        backgroundGradientToOpacity: 0.5,
        color: (opacity = 1) => `rgba(26, 255, 146, ${opacity})`,
        strokeWidth: 2,
        barPercentage: 0.5,
        useShadowColorFromDataset: false
    }
};

// Keep existing utility functions
export const getLast7Days = () =>
    [...Array(7)].map((_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - i);
        return d.toISOString().split('T')[0];
    }).reverse();

export const formatDayLabel = (date: string) =>
    new Date(date).toLocaleDateString(undefined, { weekday: 'short' });
/**
 * Interpolates missing values in a data array and tracks which indices were originally null.
 * Linear interpolation is used to estimate values between existing data points.
 *
 * Behaviour at the edges:
 *  - Leading nulls (no earlier value to anchor): carried forward from the
 *    first known value. Previously left as 0, which rendered as "mood 0" and
 *    silently looked like a real low day — bug fixed here.
 *  - Trailing nulls (no later value): carried backward from the last known
 *    value. Same rationale.
 *  - All nulls: zeros are emitted, but every index is in `nullIndices` so the
 *    renderer can render those dots as "missing".
 *
 * The caller is responsible for using `nullIndices` to colour interpolated
 * points distinctly (e.g. red), so users don't mistake the interpolation for
 * recorded data.
 *
 * @param dataArray - Array of numbers and/or null values to be interpolated
 * @returns An object containing:
 *          - data: Array of numbers with null values replaced by interpolated values
 *          - nullIndices: Array of indices where null values were originally located
 *
 * @example
 * const result = interpolateData([1, null, 3, null, 5]);
 * // returns { data: [1, 2, 3, 4, 5], nullIndices: [1, 3] }
 */
export const interpolateData = (dataArray: (number | null)[]) => {
    const result = dataArray.map(val => (typeof val === 'number' ? val : 0));
    const nullIndices: number[] = [];

    for (let i = 0; i < dataArray.length; i++) {
        if (dataArray[i] === null) {
            nullIndices.push(i);

            // Walk backwards to find the most recent non-null value.
            let prevValue: number | null = null;
            let prevIndex = i - 1;
            while (prevIndex >= 0 && prevValue === null) {
                prevValue = dataArray[prevIndex];
                if (prevValue === null) prevIndex--;
            }

            // Walk forwards to find the next non-null value.
            let nextValue: number | null = null;
            let nextIndex = i + 1;
            while (nextIndex < dataArray.length && nextValue === null) {
                nextValue = dataArray[nextIndex];
                if (nextValue === null) nextIndex++;
            }

            if (prevValue !== null && nextValue !== null) {
                // Bracketed: linear interpolation.
                const gap = nextIndex - prevIndex;
                const step = (nextValue - prevValue) / gap;
                result[i] = prevValue + step * (i - prevIndex);
            } else if (prevValue !== null) {
                // Trailing null: carry forward (was 0 before — silently wrong).
                result[i] = prevValue;
            } else if (nextValue !== null) {
                // Leading null: carry backward.
                result[i] = nextValue;
            }
            // else: all-null array — leave as 0; nullIndices covers it.
        }
    }
    return { data: result, nullIndices };
};

/**
 * True when a day-window array carries no real data (every slot is null) — i.e.
 * the user has no entries in that window. The Home weekly chart uses this to
 * decide whether to render a calm empty placeholder instead of a flat,
 * red-interpolated line that looks like an error.
 *
 * An empty array (`[]`) also counts as "empty" — there is nothing to plot.
 */
export const isWeekEmpty = (data: (number | null)[]): boolean =>
    data.every((v) => v === null);