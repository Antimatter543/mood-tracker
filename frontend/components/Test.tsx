import React, { useState, useRef, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, NativeSyntheticEvent, NativeScrollEvent } from 'react-native';

type MoodSelectorProps = {
    onValueChange: (value: number) => void;
};

export default function MoodSelector({ onValueChange }: MoodSelectorProps) {
    const initial = 50.0; // Start at 5.0
    const [selectedValue, setSelectedValue] = useState(initial);
    const scrollViewRef = useRef<ScrollView>(null);
    const values = Array.from({ length: 101 }, (_, i) => (i / 10).toFixed(1));
    const itemWidth = 60;

    useEffect(() => {
        const initialOffset = initial * itemWidth;
        setTimeout(() => {
            scrollViewRef.current?.scrollTo({
                x: initialOffset,
                animated: false,
            });
        }, 100);
    }, []);

    const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
        const offsetX = event.nativeEvent.contentOffset.x;
        const selectedIndex = Math.round(offsetX / itemWidth);
        const newValue = Math.max(0, Math.min(10, selectedIndex / 10));
        setSelectedValue(newValue);
        onValueChange(newValue); // Notify the parent of the value change
    };

    return (
        <View style={styles.container}>
            <Text style={styles.selectedText}>Selected: {selectedValue.toFixed(1)}</Text>
            <ScrollView
                ref={scrollViewRef}
                horizontal
                showsHorizontalScrollIndicator={false}
                onScroll={handleScroll}
                contentContainerStyle={styles.scrollContent}
                snapToInterval={itemWidth}
                decelerationRate="fast"
            >
                {values.map((value) => {
                    const numericValue = parseFloat(value);
                    const isMainNumber = Number.isInteger(numericValue);
                    const displayValue = isMainNumber ? numericValue.toFixed(0) : value;

                    return (
                        <View key={value} style={styles.itemContainer}>
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
                    );
                })}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        height: 120,
        backgroundColor: '#25292e',
    },
    scrollContent: {
        paddingHorizontal: 160,
        alignItems: 'center',
    },
    itemContainer: {
        width: 60,
        alignItems: 'center',
    },
    number: {
        color: '#666',
        fontSize: 16,
    },
    mainNumber: {
        fontSize: 27,
        fontWeight: 'bold',
        color: '#888',
    },
    selectedNumber: {
        color: '#fff',
        fontSize: 36,
        fontWeight: 'bold',
    },
    selectedText: {
        color: '#fff',
        fontSize: 25,
        textAlign: 'center',
        marginVertical: 10,
    },
});
