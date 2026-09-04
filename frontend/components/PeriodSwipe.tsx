import React, { type ReactNode } from 'react';
import { Animated, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { GestureDetector, ScrollView } from 'react-native-gesture-handler';

import { usePeriodSwipe } from '@/hooks/usePeriodSwipe';

/**
 * The scrolling body of the Statistics screen, made swipeable left/right to
 * step through periods (swipe right = previous period, left = next).
 *
 * Only the CHARTS live in here — the sticky header stays outside, so the
 * timeframe pills and the ‹ › chevrons keep their own plain touch behaviour and
 * are never eaten by the pan.
 *
 * Three deliberate choices, all load-bearing:
 *
 * 1. The ScrollView is RNGH's, not React Native's. Vertical scrolling then
 *    participates in RNGH's gesture arbitration alongside the pan above it, so
 *    a vertical drag scrolls exactly as before and a horizontal one pages. With
 *    RN's ScrollView the two systems arbitrate separately and the pan steals
 *    drags that were meant to scroll.
 *
 * 2. The pan is attached to a plain wrapper View that is an ANCESTOR of the
 *    scroller, not to the scroller itself — the same arrangement drawers and
 *    bottom sheets use. Attaching it to the ScrollView would put two handlers
 *    on one native view tag and make the arbitration depend on registration
 *    order; on an ancestor it is unambiguous (`failOffsetY` releases the drag
 *    to the scroll, `activeOffsetX` takes it away from the scroll).
 *
 * 3. The translated view sits INSIDE the ScrollView, wrapping the content
 *    rather than the scroller. It is content-sized, not `flex: 1`, so it is not
 *    the kind of container the Statistics blank-screen P0 lived in — see the
 *    long note in `hooks/usePeriodSwipe.ts` for why the driver is RN `Animated`
 *    and must stay that way.
 */
interface PeriodSwipeProps {
    children: ReactNode;
    /** Style for the swipe area — the scroller fills it (usually `flex: 1`). */
    style?: StyleProp<ViewStyle>;
    /** Style for the scroll content container (padding for the sticky header). */
    contentContainerStyle?: StyleProp<ViewStyle>;
    /** Style for the translated content wrapper (layout of the charts). */
    contentStyle?: StyleProp<ViewStyle>;
}

const PeriodSwipe: React.FC<PeriodSwipeProps> = ({
    children,
    style,
    contentContainerStyle,
    contentStyle,
}) => {
    const { gesture, animatedStyle } = usePeriodSwipe();

    return (
        <GestureDetector gesture={gesture}>
            <View testID="period-swipe" style={style}>
                <ScrollView
                    testID="period-swipe-scroll"
                    style={styles.scroller}
                    contentContainerStyle={contentContainerStyle}
                    showsVerticalScrollIndicator={true}
                >
                    <Animated.View
                        testID="period-swipe-content"
                        style={[contentStyle, animatedStyle]}
                    >
                        {children}
                    </Animated.View>
                </ScrollView>
            </View>
        </GestureDetector>
    );
};

const styles = StyleSheet.create({
    // The wrapper owns the caller's sizing; the scroller just fills it.
    scroller: { flex: 1 },
});

export default PeriodSwipe;
