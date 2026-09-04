import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useThemeColors } from '@/styles/global';

/**
 * The app's pill-row segmented control.
 *
 * Extracted from TimeframeSelector when a SECOND one was needed (the mood-trend
 * expanded view's 0–10 / Fit scale toggle). One implementation, so the two rows
 * cannot drift into two slightly different pills — the class of difference no
 * per-screen test can see (tasks/lessons.md, the five-headers entry).
 */

export type SegmentedOption<T extends string> = {
    value: T;
    label: string;
};

export type SegmentedControlProps<T extends string> = {
    options: readonly SegmentedOption<T>[];
    value: T;
    onChange: (value: T) => void;
    /** `'md'` is the full-width screen row; `'sm'` fits inside a card. */
    size?: 'md' | 'sm';
    /** Base testID; each option gets `${testID}-${option.value}`. */
    testID?: string;
};

const SIZES = {
    md: { paddingVertical: 8, paddingHorizontal: 16, fontSize: 14, radius: 20, inner: 16 },
    sm: { paddingVertical: 6, paddingHorizontal: 14, fontSize: 13, radius: 18, inner: 14 },
} as const;

export function SegmentedControl<T extends string>({
    options,
    value,
    onChange,
    size = 'md',
    testID,
}: SegmentedControlProps<T>) {
    const colors = useThemeColors();
    const metrics = SIZES[size];

    const styles = useMemo(
        () =>
            StyleSheet.create({
                container: {
                    flexDirection: 'row',
                    backgroundColor: colors.overlays.tag,
                    borderRadius: metrics.radius,
                    padding: 4,
                    alignSelf: 'center',
                    borderWidth: 1,
                    borderColor: colors.overlays.tagBorder,
                },
                option: {
                    paddingVertical: metrics.paddingVertical,
                    paddingHorizontal: metrics.paddingHorizontal,
                    borderRadius: metrics.inner,
                },
                selectedOption: {
                    backgroundColor: colors.accent,
                },
                optionText: {
                    color: colors.textSecondary,
                    fontSize: metrics.fontSize,
                },
                // White on the accent fill in every theme: the accent is a
                // mid-to-dark tone in all five, so this is the legible pair.
                selectedOptionText: {
                    color: '#fff',
                    fontWeight: '600',
                },
            }),
        [colors, metrics]
    );

    return (
        <View style={styles.container} testID={testID}>
            {options.map((option) => {
                const selected = option.value === value;
                return (
                    <Pressable
                        key={option.value}
                        testID={testID ? `${testID}-${option.value}` : undefined}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        accessibilityLabel={option.label}
                        style={[styles.option, selected && styles.selectedOption]}
                        onPress={() => onChange(option.value)}
                    >
                        <Text style={[styles.optionText, selected && styles.selectedOptionText]}>
                            {option.label}
                        </Text>
                    </Pressable>
                );
            })}
        </View>
    );
}

export default SegmentedControl;
