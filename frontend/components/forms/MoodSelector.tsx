import React, { useState, useRef, useEffect, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import { useThemeColors } from '@/styles/global';

type MoodSelectorProps = {
    onValueChange: (value: number) => void;
    initialValue?: number;
    precision?: 'low' | 'high';
    showBenchmarks?: boolean;
};

// Define mood benchmarks with emojis
const moodBenchmarks = {
    2: { emoji: '💀', label: 'Terrible' },
    5: { emoji: '😐', label: 'Neutral' },
    7: { emoji: '🙂', label: 'Good' },
    9: { emoji: '😄', label: 'Terrific!' },
};

export default function MoodSelector({ 
    onValueChange, 
    initialValue = 5.0,
    precision = 'high',
    showBenchmarks = true 
}: MoodSelectorProps) {
    const colors = useThemeColors();
    const [selectedValue, setSelectedValue] = useState(initialValue);
    const scrollViewRef = useRef<ScrollView>(null);
    
    const scale = precision === 'high' ? 2 : 1;
    const length = (10 * scale) + 1;
    const values = Array.from({ length }, (_, i) => (i / scale).toFixed(precision === 'high' ? 1 : 0));
    
    const itemWidth = 60;
    const hasInitialized = useRef(false);

    const styles = useMemo(() => StyleSheet.create({
        container: {
            height: 160, // Increased height to accommodate emojis
            width: '100%',
            backgroundColor: colors.background,
            alignItems: 'center', // Center the content horizontally
        },
        scrollContent: {
            paddingHorizontal: 160,
            alignItems: 'center', // Center items in the ScrollView
        },
        itemContainer: {
            width: itemWidth,
            height: 100, // Fixed height for the item container
            alignItems: 'center',
        },
        numberContainer: {
            position: 'absolute',
            bottom: 0,
            width: '100%',
            alignItems: 'center',
            height: 60, // Fixed height for number section
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
        emoji: {
            fontSize: 20,
            marginBottom: 2,
        },
        benchmarkLabel: {
            color: colors.textSecondary,
            fontSize: 10,
            textAlign: 'center',
        },
    }), [colors]);

    useEffect(() => {
        if (!hasInitialized.current) {
            const initialOffset = initialValue * scale * itemWidth;
            setTimeout(() => {
                scrollViewRef.current?.scrollTo({
                    x: initialOffset,
                    animated: false,
                });
                hasInitialized.current = true;
            }, 100);
        }
    }, [initialValue, scale, itemWidth]);

    const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
        const offsetX = event.nativeEvent.contentOffset.x;
        const selectedIndex = Math.round(offsetX / itemWidth);
        const newValue = Math.max(0, Math.min(10, selectedIndex / scale));
        
        const roundedValue = precision === 'high' 
            ? Math.round(newValue * 2) / 2
            : Math.round(newValue);
            
        if (roundedValue !== selectedValue) {
            setSelectedValue(roundedValue);
            onValueChange(roundedValue);
        }
    };

    const renderBenchmark = (value: number) => {
        if (!showBenchmarks) return null;
        const benchmark = moodBenchmarks[value];
        if (!benchmark) return null;

        return (
            <View style={styles.benchmarkContainer}>
                <Text style={styles.emoji}>{benchmark.emoji}</Text>
                <Text style={styles.benchmarkLabel}>{benchmark.label}</Text>
            </View>
        );
    };

    return (
        <View style={styles.container}>
            <Text style={styles.selectedText}>
                Selected: {precision === 'high' ? selectedValue.toFixed(1) : selectedValue.toFixed(0)}
            </Text>
            <ScrollView
                ref={scrollViewRef}
                horizontal
                showsHorizontalScrollIndicator={false}
                onScroll={handleScroll}
                scrollEventThrottle={16}
                contentContainerStyle={styles.scrollContent}
                snapToInterval={itemWidth}
                decelerationRate="fast"
                style={{ width: '100%' }} // Make sure ScrollView takes full width
            >
                {values.map((value) => {
                    const numericValue = parseFloat(value);
                    const isMainNumber = Number.isInteger(numericValue);
                    const displayValue = precision === 'high' ? 
                        (isMainNumber ? numericValue.toFixed(0) : value) : 
                        numericValue.toFixed(0);

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