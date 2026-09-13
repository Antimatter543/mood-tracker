import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Feather from '@expo/vector-icons/Feather';

import { useThemeColors } from '@/styles/global';
import { useTimeframe } from '@/context/TimeframeContext';
import DateRangePicker from '@/components/DateRangePicker';
// The SAME "today" the provider anchors its windows on (tests pin this one
// function), so the picker's upper bound can never disagree with the context's.
import { todayLocalDay } from '@/components/visualisations/transforms/periodWindow';

/**
 * The Stats header's period stepper: ‹ chevron — concrete date range — chevron ›.
 *
 * Sits directly under the TimeframeSelector, which picks the period LENGTH while
 * this picks WHICH period. All state lives in TimeframeContext so the charts
 * below read the exact same window this label describes.
 *
 * The label is a button: tapping it opens the CUSTOM RANGE picker, so "Aug 15 –
 * Sep 13" is not just a readout but the handle on the range itself — tap the
 * dates, pick two others. (It used to reset to the present; that moved to the
 * dedicated ✕ control, which is now shown in both ways of being in the past —
 * paged back, or on a custom range — instead of only one of them.)
 *
 * In custom mode the chevrons disappear, exactly as they do for All Time: there
 * is no defensible "previous" for a hand-picked range (see the CUSTOM RANGES note
 * in transforms/periodWindow.ts), and two permanently dead arrows are worse than
 * none. When the user is not looking at the present the label switches to the
 * accent colour, so "you are not looking at now" is legible at a glance.
 */

/** Android/iOS minimum comfortable touch target. */
const TOUCH_TARGET = 44;
/** The secondary ✕ / reset control — deliberately smaller than an arrow. */
const RESET_TARGET = 32;

const PeriodNavigator: React.FC = () => {
    const colors = useThemeColors();
    const {
        timeframe,
        periodLabel,
        goBack,
        goForward,
        resetOffset,
        canGoBack,
        canGoForward,
        periodWindow,
        isCustom,
        isCurrentPeriod,
        setCustomRange,
        earliestEntryDay,
    } = useTimeframe();

    const [pickerOpen, setPickerOpen] = useState(false);
    const openPicker = useCallback(() => setPickerOpen(true), []);
    const closePicker = useCallback(() => setPickerOpen(false), []);

    // 'alltime' has exactly one period and a custom range has no next/previous,
    // so in both cases stepping is meaningless — drop the chevrons rather than
    // show two permanently dead controls.
    const showArrows = timeframe !== 'alltime' && !isCustom;
    // The escape hatch is offered whenever the window isn't the present one,
    // whichever way the user got there. ('alltime' ends today, so it never shows
    // one — correct: there is nothing to return from.)
    const showReset = !isCurrentPeriod || isCustom;

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
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
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
                reset: {
                    width: RESET_TARGET,
                    height: RESET_TARGET,
                    alignItems: 'center',
                    justifyContent: 'center',
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
                onPress={openPicker}
                accessibilityRole="button"
                accessibilityLabel={`Showing ${periodLabel}`}
                accessibilityHint="Opens a calendar to pick your own start and end dates"
            >
                {/* A quiet glyph, not a button: the affordance has to be visible
                    (nobody taps a plain date string) without competing with the
                    pills above it for attention. */}
                <Feather
                    name="calendar"
                    size={13}
                    color={!isCurrentPeriod || isCustom ? colors.accent : colors.textSecondary}
                />
                {/* Its own testID: the button wrapping it also contains the
                    calendar glyph, and Feather renders that glyph as a Text node
                    — so a text assertion on the BUTTON would silently include an
                    invisible icon codepoint. */}
                <Text
                    testID="period-nav-label-text"
                    style={[
                        styles.labelText,
                        (!isCurrentPeriod || isCustom) && styles.labelTextPast,
                    ]}
                >
                    {periodLabel}
                </Text>
            </Pressable>

            {showReset && (
                <Pressable
                    testID="period-nav-reset"
                    style={styles.reset}
                    onPress={resetOffset}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Back to the current period"
                >
                    <Feather name="x" size={18} color={colors.textSecondary} />
                </Pressable>
            )}

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

            {/* Pre-selects the user's OWN range (so reopening shows what they
                picked, ready to adjust) but NOT a preset's window: pre-filling
                "Jul 31 – Aug 29" would claim they chose those dates, and All
                Time's window starts at the epoch, which is not a selection at all.
                `maxDay` is today — the future has no entries to show. */}
            <DateRangePicker
                visible={pickerOpen}
                onClose={closePicker}
                onApply={setCustomRange}
                maxDay={todayLocalDay()}
                initialStartDay={isCustom ? periodWindow.startDay : undefined}
                initialEndDay={isCustom ? periodWindow.endDay : undefined}
                earliestEntryDay={earliestEntryDay}
            />
        </View>
    );
};

export default PeriodNavigator;
