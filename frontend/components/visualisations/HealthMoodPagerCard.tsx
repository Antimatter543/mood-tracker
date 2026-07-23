import React, { useMemo, useRef, useState } from 'react';
import {
    View,
    ScrollView,
    Pressable,
    StyleSheet,
    type LayoutChangeEvent,
    type NativeScrollEvent,
    type NativeSyntheticEvent,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ThemeColors, useThemeColors } from '@/styles/global';
import { Card } from '@/components/Card';
import { MetricMoodCardBody } from './MetricMoodCard';
import { HEALTH_METRIC_CONFIGS } from './healthMetricConfigs';
import {
    availableHealthPanes,
    type HealthMetricKey,
    type HealthPaneFlags,
} from './transforms/healthPanes';
import type { MetricMoodCorrelation } from './transforms/healthMoodCorrelation';

/**
 * ONE swipeable card that pages through the Health Connect metric↔mood views
 * (sleep → heart rate → resting HR → HRV), showing only the metrics that HAVE
 * on-device data. Replaces the four separate conditional cards on Insights,
 * saving vertical space while keeping every pane's existing content.
 *
 * Paging uses a plain RN horizontal `ScrollView` with `pagingEnabled` + pages
 * sized to the measured viewport width — the proven, native-dependency-free
 * pattern (runs unchanged in Expo Go). Visible `< >` chevrons (never emoji)
 * signal swipeability and page on tap; they clamp (no wrap) and dim+disable at
 * the ends. A dots indicator shows position. One metric → a single static card,
 * no pager chrome.
 */
export interface HealthMoodPagerCardProps extends HealthPaneFlags {
    sleepMood: MetricMoodCorrelation;
    heartRateMood: MetricMoodCorrelation;
    restingHeartRateMood: MetricMoodCorrelation;
    hrvMood: MetricMoodCorrelation;
}

const clamp = (v: number, lo: number, hi: number): number =>
    Math.max(lo, Math.min(hi, v));

const HealthMoodPagerCard: React.FC<HealthMoodPagerCardProps> = (props) => {
    const colors = useThemeColors();
    const styles = useStyles(colors);
    const scrollRef = useRef<ScrollView>(null);
    const [width, setWidth] = useState(0);
    const [index, setIndex] = useState(0);

    const panes = useMemo(
        () => availableHealthPanes(props),
        // Depend on the flags, not the whole props object (correlations change
        // identity every load but don't affect which panes exist).
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [
            props.hasSleepData,
            props.hasHeartRateData,
            props.hasRestingHrData,
            props.hasHrvData,
        ]
    );

    const correlationFor = (key: HealthMetricKey): MetricMoodCorrelation => {
        switch (key) {
            case 'sleep':
                return props.sleepMood;
            case 'heartRate':
                return props.heartRateMood;
            case 'restingHr':
                return props.restingHeartRateMood;
            case 'hrv':
                return props.hrvMood;
        }
    };

    // Parent already gates on ANY metric having data; guard anyway.
    if (panes.length === 0) return null;

    // Single metric → just the body in a plain Card, no arrows/dots.
    if (panes.length === 1) {
        return (
            <Card>
                <MetricMoodCardBody
                    {...HEALTH_METRIC_CONFIGS[panes[0]]}
                    correlation={correlationFor(panes[0])}
                />
            </Card>
        );
    }

    // Index can momentarily exceed the pane list if data shrinks between renders.
    const active = clamp(index, 0, panes.length - 1);
    const atStart = active <= 0;
    const atEnd = active >= panes.length - 1;

    const goTo = (target: number) => {
        const next = clamp(target, 0, panes.length - 1);
        setIndex(next);
        if (width > 0) {
            scrollRef.current?.scrollTo?.({ x: next * width, animated: true });
        }
    };

    const onViewportLayout = (e: LayoutChangeEvent) => {
        const w = e.nativeEvent.layout.width;
        if (w > 0 && Math.abs(w - width) > 1) {
            setWidth(w);
            // Keep the current pane in view if the width changes (theme/rotation).
            scrollRef.current?.scrollTo?.({ x: active * w, animated: false });
        }
    };

    const onMomentumScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
        if (width <= 0) return;
        setIndex(clamp(Math.round(e.nativeEvent.contentOffset.x / width), 0, panes.length - 1));
    };

    return (
        <Card>
            <View
                style={styles.viewport}
                onLayout={onViewportLayout}
                testID="health-pager-viewport"
            >
                {width > 0 && (
                    <ScrollView
                        ref={scrollRef}
                        horizontal
                        pagingEnabled
                        showsHorizontalScrollIndicator={false}
                        onMomentumScrollEnd={onMomentumScrollEnd}
                        scrollEventThrottle={16}
                        decelerationRate="fast"
                    >
                        {panes.map((key) => (
                            <View key={key} style={{ width }} testID={`health-pane-${key}`}>
                                <MetricMoodCardBody
                                    {...HEALTH_METRIC_CONFIGS[key]}
                                    correlation={correlationFor(key)}
                                />
                            </View>
                        ))}
                    </ScrollView>
                )}
            </View>

            {/* Nav row: [<]   ● ● ●   [>] — chevrons signal + drive paging, dots
                show position. Clamped (no wrap): dim + disabled at the ends. */}
            <View style={styles.navRow}>
                <Pressable
                    onPress={() => goTo(active - 1)}
                    disabled={atStart}
                    hitSlop={12}
                    accessibilityRole="button"
                    accessibilityLabel="Previous metric"
                    accessibilityState={{ disabled: atStart }}
                    testID="health-pager-prev"
                    style={({ pressed }) => [
                        styles.arrow,
                        atStart && styles.arrowDisabled,
                        pressed && !atStart && styles.arrowPressed,
                    ]}
                >
                    <Ionicons name="chevron-back" size={22} color={colors.accent} />
                </Pressable>

                <View style={styles.dots} accessibilityRole="tablist">
                    {panes.map((key, i) => (
                        <View
                            key={key}
                            testID={`health-pager-dot-${i}`}
                            accessibilityState={{ selected: i === active }}
                            style={[styles.dot, i === active ? styles.dotActive : styles.dotInactive]}
                        />
                    ))}
                </View>

                <Pressable
                    onPress={() => goTo(active + 1)}
                    disabled={atEnd}
                    hitSlop={12}
                    accessibilityRole="button"
                    accessibilityLabel="Next metric"
                    accessibilityState={{ disabled: atEnd }}
                    testID="health-pager-next"
                    style={({ pressed }) => [
                        styles.arrow,
                        atEnd && styles.arrowDisabled,
                        pressed && !atEnd && styles.arrowPressed,
                    ]}
                >
                    <Ionicons name="chevron-forward" size={22} color={colors.accent} />
                </Pressable>
            </View>
        </Card>
    );
};

const useStyles = (colors: ThemeColors) =>
    useMemo(
        () =>
            StyleSheet.create({
                viewport: {
                    // Horizontal ScrollView sizes its height to the tallest pane;
                    // the width is measured via onLayout to page precisely.
                    width: '100%',
                },
                navRow: {
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginTop: 12,
                    paddingTop: 12,
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderTopColor: colors.border,
                },
                arrow: {
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    justifyContent: 'center',
                    alignItems: 'center',
                    backgroundColor: colors.accentLight,
                },
                arrowDisabled: {
                    opacity: 0.3,
                },
                arrowPressed: {
                    opacity: 0.6,
                },
                dots: {
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 7,
                },
                dot: {
                    width: 7,
                    height: 7,
                    borderRadius: 3.5,
                },
                dotActive: {
                    backgroundColor: colors.accent,
                    width: 18,
                },
                dotInactive: {
                    backgroundColor: colors.border,
                },
            }),
        [colors]
    );

export default HealthMoodPagerCard;
