import React, { useState, useRef, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, NativeSyntheticEvent, NativeScrollEvent } from 'react-native';

export default function MoodSelector() {
    const initial = 50.0; // we use this because length is like 100 look idk
    const [selectedValue, setSelectedValue] = useState(initial);
    const scrollViewRef = useRef<ScrollView>(null);
    const values = Array.from({ length: 101 }, (_, i) => (i / 10).toFixed(1));
    const itemWidth = 60; // Adjust if needed to match styles

    useEffect(() => {
        // Scroll to initial value (centered)
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
        const selectedIndex = Math.round(offsetX / itemWidth); // Correct calculation
        const newValue = Math.max(0, Math.min(10, selectedIndex / 10));
        setSelectedValue(newValue);
    };

    return (
        <View style={styles.container}>
            <Text style={styles.selectedText}>Selected: {selectedValue.toFixed(1)}</Text>
            <ScrollView
                ref={scrollViewRef}
                horizontal
                showsHorizontalScrollIndicator={false}
                onScroll={handleScroll}
                // scrollEventThrottle={16}
                contentContainerStyle={styles.scrollContent}
                snapToInterval={itemWidth} // Snap behavior for better UX
                decelerationRate="fast" // Smooth snapping
            >
                {values.map((value) => (
                    <View key={value} style={styles.itemContainer}>
                        <Text
                            style={[
                                styles.number,
                                parseFloat(value) === selectedValue && styles.selectedNumber,
                            ]}
                        >
                            {value}
                        </Text>
                    </View>
                ))}
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
        width: 60, // Match item width to snap behavior
        alignItems: 'center',
    },
    number: {
        color: '#666',
        fontSize: 16,
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
