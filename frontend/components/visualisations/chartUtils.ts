// chartConfig.ts
import { colors, useThemeColors } from '@/styles/global';
import { useMemo } from 'react';
import { Dimensions } from 'react-native';

export const CHART_PADDING = 48; // 16px container padding × 2 sides + safe margin
export const SCREEN_WIDTH = Dimensions.get('window').width;

// New hook for theme-aware chart config
export const useChartConfig = () => {
    const colors = useThemeColors();
    
    return useMemo(() => ({
        backgroundColor: colors.cardBackground,
        backgroundGradientFrom: colors.cardBackground,
        backgroundGradientTo: colors.cardBackground,
        decimalPlaces: 1,
        color: (opacity = 1) => `rgba(76, 175, 80, ${opacity})`, // Keep accent color consistent
        labelColor: (opacity = 1) => `rgba(${colors.text === '#FFFFFF' ? '255, 255, 255' : '0, 0, 0'}, ${opacity})`,
        propsForLabels: {
            fontSize: 10,
            fill: colors.text,
        },
        // labelColor: (opacity = 1) => `rgba(255, 255, 255, ${opacity})`,
        style: {
            borderRadius: 16,
        },
    }), [colors]);
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
    const result = dataArray.map(val => (typeof val === 'number' ? val : 0)); // Convert nulls to numbers
    const nullIndices = []; // Track null indices here

    for (let i = 0; i < dataArray.length; i++) {
        if (dataArray[i] === null) {
            nullIndices.push(i); // Record the null index

            let prevValue: number | null = null;
            let prevIndex = i - 1;
            while (prevIndex >= 0 && prevValue === null) {
                prevValue = dataArray[prevIndex];
                prevIndex--;
            }

            let nextValue: number | null = null;
            let nextIndex = i + 1;
            while (nextIndex < dataArray.length && nextValue === null) {
                nextValue = dataArray[nextIndex];
                nextIndex++;
            }

            if (prevValue !== null && nextValue !== null) {
                const gap = nextIndex - prevIndex - 1;
                const step = (nextValue - prevValue) / gap;
                result[i] = prevValue + step * (i - prevIndex);
            }
        }
    }
    return { data: result, nullIndices };
};