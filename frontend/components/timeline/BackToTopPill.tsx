import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, Text, View, StyleSheet } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemeColors } from '@/styles/global';

/**
 * Show the pill once the user is this many viewports deep. Shallower than that,
 * a flick gets you home faster than finding a button.
 */
export const BACK_TO_TOP_VIEWPORTS = 3;

/** Pure visibility rule, unit-tested. `viewport` <= 0 means "not laid out yet". */
export const shouldShowBackToTop = (offset: number, viewport: number): boolean =>
    viewport > 0 && offset > viewport * BACK_TO_TOP_VIEWPORTS;

// Mirrors AddEntryButton's geometry so the pill sits on the FAB's centre line:
// the FAB floats FAB_BOTTOM_GAP + insetBottom above the tab body's bottom and is
// 56dp tall. The pill is horizontally CENTRED and the FAB hugs a side (left or
// right, per the `fab_position` setting), so the two never overlap.
const FAB_BOTTOM_GAP = 24;
const FAB_SIZE = 56;
const PILL_HEIGHT = 40;

const styles = StyleSheet.create({
    slot: {
        position: 'absolute',
        left: 0,
        right: 0,
        alignItems: 'center',
    },
    pill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        height: PILL_HEIGHT,
        paddingHorizontal: 16,
        borderRadius: PILL_HEIGHT / 2,
        borderWidth: StyleSheet.hairlineWidth,
        shadowOffset: { width: 0, height: 4 },
        shadowRadius: 10,
    },
    label: {
        fontSize: 14,
        fontWeight: '600',
    },
});

/**
 * "Back to top" — appears once the user is several screens deep in the Timeline
 * and returns them to the newest entry in one tap. A leaf element: its fade-in
 * is RN core `Animated` on its own opacity/transform (native driver), never a
 * reanimated style on a container that wraps page content (see CLAUDE.md).
 * `pointerEvents` lives on the plain host slot, as with UndoSnackbar.
 */
export const BackToTopPill: React.FC<{ colors: ThemeColors; onPress: () => void }> = ({
    colors,
    onPress,
}) => {
    const insets = useSafeAreaInsets();
    const appear = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        Animated.timing(appear, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    }, [appear]);

    const bottom = FAB_BOTTOM_GAP + insets.bottom + (FAB_SIZE - PILL_HEIGHT) / 2;
    return (
        <View style={[styles.slot, { bottom }]} pointerEvents="box-none">
            <Animated.View
                style={{
                    opacity: appear,
                    transform: [
                        { translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) },
                    ],
                }}
            >
                <Pressable
                    testID="timeline-back-to-top"
                    onPress={onPress}
                    accessibilityRole="button"
                    accessibilityLabel="Back to top"
                    hitSlop={8}
                    style={({ pressed }) => [
                        styles.pill,
                        {
                            backgroundColor: colors.secondaryBackground,
                            borderColor: colors.border,
                            shadowColor: colors.elevation.shadowColor,
                            shadowOpacity: colors.elevation.shadowOpacity,
                            elevation: colors.elevation.elevation,
                            opacity: pressed ? 0.85 : 1,
                        },
                    ]}
                >
                    <Feather name="arrow-up" size={16} color={colors.accent} />
                    <Text style={[styles.label, { color: colors.text }]}>Back to top</Text>
                </Pressable>
            </Animated.View>
        </View>
    );
};
