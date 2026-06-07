import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useThemeColors } from '@/styles/global';
import { useMoodScale, MoodPrecision } from './hooks/useMoodScale';

type MoodSelectorProps = {
    onValueChange: (value: number) => void;
    initialValue?: number;
    precision?: MoodPrecision;
    showBenchmarks?: boolean;
};

// Mood benchmarks — partial mapping (only special anchor values get a face).
// Typed as `Partial<Record<number, ...>>` so an integer index returns
// `undefined` cleanly rather than triggering a TS implicit-any.
const moodBenchmarks: Partial<Record<number, { iconName: keyof typeof Ionicons.glyphMap; label: string }>> = {
    2: { iconName: 'sad', label: 'Terrible' },
    5: { iconName: 'remove-circle-outline', label: 'Neutral' },
    7: { iconName: 'happy-outline', label: 'Good' },
    9: { iconName: 'happy', label: 'Terrific!' },
};

export default function MoodSelector({
    onValueChange,
    initialValue = 5.0,
    precision = 'high',
    showBenchmarks = true,
}: MoodSelectorProps) {
    const colors = useThemeColors();
    const { itemWidth, values, snap, format, valueFromOffset, offsetFromValue } =
        useMoodScale({ precision });
    const [selectedValue, setSelectedValue] = useState(() => snap(initialValue));
    const scrollViewRef = useRef<ScrollView>(null);
    const hasInitialized = useRef(false);

    const styles = useMemo(
        () =>
            StyleSheet.create({
                container: {
                    height: 160,
                    width: '100%',
                    backgroundColor: colors.background,
                    alignItems: 'center',
                },
                scrollContent: {
                    paddingHorizontal: 160,
                    alignItems: 'center',
                },
                itemContainer: {
                    width: itemWidth,
                    height: 100,
                    alignItems: 'center',
                },
                numberContainer: {
                    position: 'absolute',
                    bottom: 0,
                    width: '100%',
                    alignItems: 'center',
                    height: 60,
                    justifyContent: 'center',
                },
                benchmarkContainer: {
                    position: 'absolute',
                    top: 0,
                    width: '100%',
                    alignItems: 'center',
                    opacity: 0.6,
                    paddingTop: 10,
                },
                number: {
                    color: colors.textSecondary,
                    fontSize: 16,
                },
                mainNumber: {
                    fontSize: 27,
                    fontWeight: 'bold',
                    color: colors.textSecondary,
                },
                selectedNumber: {
                    color: colors.text,
                    fontSize: 36,
                    fontWeight: 'bold',
                },
                selectedText: {
                    color: colors.text,
                    fontSize: 25,
                    textAlign: 'center',
                    marginVertical: 10,
                },
                benchmarkLabel: {
                    color: colors.textSecondary,
                    fontSize: 10,
                    textAlign: 'center',
                },
            }),
        [colors, itemWidth]
    );

    useEffect(() => {
        if (!hasInitialized.current) {
            const initialOffset = offsetFromValue(initialValue);
            setTimeout(() => {
                scrollViewRef.current?.scrollTo({ x: initialOffset, animated: false });
                hasInitialized.current = true;
            }, 100);
        }
    }, [initialValue, offsetFromValue]);

    const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
        const offsetX = event.nativeEvent.contentOffset.x;
        const newValue = valueFromOffset(offsetX);
        if (newValue !== selectedValue) {
            setSelectedValue(newValue);
            onValueChange(newValue);
        }
    };

    const renderBenchmark = (value: number) => {
        if (!showBenchmarks) return null;
        const benchmark = moodBenchmarks[value];
        if (!benchmark) return null;
        return (
            <View style={styles.benchmarkContainer}>
                <Ionicons name={benchmark.iconName} size={20} color={colors.textSecondary} style={{ marginBottom: 2 }} />
                <Text style={styles.benchmarkLabel}>{benchmark.label}</Text>
            </View>
        );
    };

    return (
        <View style={styles.container}>
            <Text style={styles.selectedText}>Selected: {format(selectedValue)}</Text>
            <ScrollView
                ref={scrollViewRef}
                horizontal
                showsHorizontalScrollIndicator={false}
                onScroll={handleScroll}
                scrollEventThrottle={16}
                contentContainerStyle={styles.scrollContent}
                snapToInterval={itemWidth}
                decelerationRate="fast"
                style={{ width: '100%' }}
            >
                {values.map((value) => {
                    const numericValue = parseFloat(value);
                    const isMainNumber = Number.isInteger(numericValue);
                    const displayValue =
                        precision === 'high'
                            ? isMainNumber
                                ? numericValue.toFixed(0)
                                : value
                            : numericValue.toFixed(0);

                    return (
                        <View key={value} style={styles.itemContainer}>
                            {renderBenchmark(numericValue)}
                            <View style={styles.numberContainer}>
                                <Text
                                    style={[
                                        styles.number,
                                        isMainNumber && styles.mainNumber,
                                        numericValue === selectedValue && styles.selectedNumber,
                                    ]}
                                >
                                    {displayValue}
                                </Text>
                            </View>
                        </View>
                    );
                })}
            </ScrollView>
        </View>
    );
}

