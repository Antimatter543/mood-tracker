import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Feather from '@expo/vector-icons/Feather';

import { useThemeColors } from '@/styles/global';
import { useTimeframe } from '@/context/TimeframeContext';

/**
 * The Stats header's period stepper: ‹ chevron — concrete date range — chevron ›.
 *
 * Sits directly under the TimeframeSelector, which picks the period LENGTH while
 * this picks WHICH period. All state lives in TimeframeContext so the charts
 * below read the exact same window this label describes.
 *
 * The label is a button too — tapping it returns to the present, which is the
 * escape hatch after paging back a dozen weeks. When the user is in the past the
 * label switches to the accent colour so "you are not looking at now" is legible
 * at a glance rather than only inferable from the date.
 */

/** Android/iOS minimum comfortable touch target. */
const TOUCH_TARGET = 44;

const PeriodNavigator: React.FC = () => {
    const colors = useThemeColors();
    const {
        timeframe,
        periodLabel,
        offset,
        goBack,
        goForward,
        resetOffset,
        canGoBack,
        canGoForward,
    } = useTimeframe();

    const isPast = offset < 0;
    // 'alltime' has exactly one period, so stepping is meaningless — drop the
    // chevrons entirely rather than showing two permanently dead controls.
    const showArrows = timeframe !== 'alltime';

    const styles = useMemo(
        () =>
            StyleSheet.create({
                container: {
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                },
                arrow: {
                    width: TOUCH_TARGET,
                    height: TOUCH_TARGET,
                    alignItems: 'center',
                    justifyContent: 'center',
                },
                arrowDisabled: {
                    opacity: 0.25,
                },
                label: {
                    minHeight: TOUCH_TARGET,
                    justifyContent: 'center',
                    // Keeps the chevrons from shuffling sideways as the label
                    // text changes width between periods.
                    minWidth: 168,
                    paddingHorizontal: 8,
                },
                labelText: {
                    fontSize: 14,
                    textAlign: 'center',
                    color: colors.textSecondary,
                },
                labelTextPast: {
                    color: colors.accent,
                    fontWeight: '600',
                },
            }),
        [colors],
    );

    return (
        <View style={styles.container} testID="period-navigator">
            {showArrows && (
                <Pressable
                    testID="period-nav-back"
                    style={[styles.arrow, !canGoBack && styles.arrowDisabled]}
                    onPress={goBack}
                    disabled={!canGoBack}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !canGoBack }}
                    accessibilityLabel="Previous period"
                >
                    <Feather name="chevron-left" size={22} color={colors.text} />
                </Pressable>
            )}

            <Pressable
                testID="period-nav-label"
                style={styles.label}
                onPress={resetOffset}
                disabled={!isPast}
                accessibilityRole="button"
                accessibilityLabel={`Showing ${periodLabel}`}
                accessibilityHint={isPast ? 'Returns to the current period' : undefined}
            >
                <Text style={[styles.labelText, isPast && styles.labelTextPast]}>
                    {periodLabel}
                </Text>
            </Pressable>

            {showArrows && (
                <Pressable
                    testID="period-nav-forward"
                    style={[styles.arrow, !canGoForward && styles.arrowDisabled]}
                    onPress={goForward}
                    disabled={!canGoForward}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !canGoForward }}
                    accessibilityLabel="Next period"
                >
                    <Feather name="chevron-right" size={22} color={colors.text} />
                </Pressable>
            )}
        </View>
    );
};

export default PeriodNavigator;
