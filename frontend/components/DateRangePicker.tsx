import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Calendar, type DateData } from 'react-native-calendars';

import { OverlayModal } from '@/components/OverlayModal';
import { ThemeColors, useThemeColors } from '@/styles/global';
import { calendarThemeKey } from '@/components/visualisations/transforms/calendarMarkers';
import {
    CALENDAR_FIRST_DAY,
    monthCurrentString,
    visibleMonthOf,
} from '@/components/visualisations/transforms/monthWindow';
import { formatDayRangeLabel } from '@/components/visualisations/transforms/periodWindow';
import {
    advanceSelection,
    buildRangeMarking,
    isComplete,
    selectionSummary,
    type RangeSelection,
} from '@/components/visualisations/transforms/dateRangeSelection';

/**
 * The Statistics screen's custom date-range picker: flip through months, tap two
 * days, Apply.
 *
 * It exists because the preset pills can only answer "the last N days". Anti's
 * ask was literally "I flip the calendar to select the dates and it gives me the
 * stats of all the entries between those dates" — so the affordance is a real
 * month grid, not a pair of numeric date fields.
 *
 * All two-tap logic, marking and summary text live in
 * transforms/dateRangeSelection.ts (pure, unit-tested); this component is the
 * shell that themes it, bounds it at today, and hands the committed pair to
 * TimeframeContext.
 *
 * Renders through OverlayModal (the in-tree overlay), NEVER a native <Modal> —
 * see the project CLAUDE.md: native modals open a second native window whose
 * touch dispatch is broken on this Fabric build, which would leave every day
 * cell dead to a real finger.
 */

/** On-accent text in every theme: the accent is mid-to-dark in all five. */
const ON_ACCENT = '#FFFFFF';

type DateRangePickerProps = {
    visible: boolean;
    onClose: () => void;
    /** Commits the picked pair. Order is already normalised (start <= end). */
    onApply: (startDay: string, endDay: string) => void;
    /** Latest selectable day (local `YYYY-MM-DD`) — the future has no data. */
    maxDay: string;
    /** Pre-selection shown on open: the range the screen is currently scoped to. */
    initialStartDay?: string;
    initialEndDay?: string;
    /** The user's first entry, shown as a hint. Earlier days stay selectable. */
    earliestEntryDay?: string | null;
};

const DateRangePicker: React.FC<DateRangePickerProps> = ({
    visible,
    onClose,
    onApply,
    maxDay,
    initialStartDay,
    initialEndDay,
    earliestEntryDay,
}) => {
    const colors = useThemeColors();
    const styles = useMemo(() => makeStyles(colors), [colors]);

    const [pending, setPending] = useState<RangeSelection | null>(null);

    // The month the grid opens on: where the current selection ends, else today.
    // react-native-calendars reads `current` ONLY at mount (no effect watches it
    // in this version — see the note in MoodCalendar), so the seed is baked into
    // the Calendar's `key` below rather than relied on as a live prop.
    const seedMonth = monthCurrentString(
        visibleMonthOf(new Date(`${initialEndDay ?? maxDay}T00:00:00`)),
    );

    // `pending` is component state, so it survives a close; seeding it from the
    // props at OPEN time is what makes reopening show the active range instead of
    // whatever was half-tapped last time. Adjusted during render (React's
    // sanctioned "reset state when props change") rather than in an effect: an
    // effect would let one frame of stale marking commit first, and the Calendar
    // below only reads its `current` seed at mount.
    //
    // The key is CLEARED on close, not just compared: without that, closing and
    // reopening with unchanged props produces the same key and the half-tapped
    // selection from last time would survive into the new session.
    const openKey = `${initialStartDay ?? ''}|${initialEndDay ?? ''}`;
    const [lastOpenKey, setLastOpenKey] = useState<string | null>(null);
    if (!visible) {
        if (lastOpenKey !== null) setLastOpenKey(null);
    } else if (openKey !== lastOpenKey) {
        setLastOpenKey(openKey);
        setPending(
            initialStartDay && initialEndDay
                ? { startDay: initialStartDay, endDay: initialEndDay }
                : null,
        );
    }

    const onDayPress = useCallback((day: DateData) => {
        setPending((current) => advanceSelection(current, day.dateString));
    }, []);

    const marking = useMemo(
        () =>
            buildRangeMarking(pending, {
                endpoint: colors.accent,
                onEndpoint: ON_ACCENT,
                fill: colors.accentLight,
                onFill: colors.text,
            }),
        [pending, colors.accent, colors.accentLight, colors.text],
    );

    const calendarTheme = useMemo(
        () => ({
            backgroundColor: colors.cardBackground,
            calendarBackground: colors.cardBackground,
            textSectionTitleColor: colors.textSecondary,
            monthTextColor: colors.text,
            dayTextColor: colors.text,
            textDisabledColor: colors.textSecondary,
            todayTextColor: colors.accent,
            arrowColor: colors.accent,
            textDayFontWeight: '500' as const,
            textMonthFontWeight: '700' as const,
        }),
        [colors],
    );

    const canApply = isComplete(pending);

    const apply = useCallback(() => {
        if (!isComplete(pending)) return;
        onApply(pending.startDay, pending.endDay);
        onClose();
    }, [pending, onApply, onClose]);

    return (
        <OverlayModal visible={visible} onClose={onClose}>
            <View style={styles.card} testID="date-range-picker">
                <Text style={styles.title}>Custom range</Text>
                <Text style={styles.summary} testID="date-range-summary">
                    {selectionSummary(pending, maxDay)}
                </Text>

                <Calendar
                    // Remount on a theme switch (react-native-calendars bakes its
                    // grid stylesheet once at mount) AND when the seed month
                    // changes, which is the only way `current` is re-read.
                    key={`${calendarThemeKey(colors)}|${seedMonth}`}
                    current={seedMonth}
                    firstDay={CALENDAR_FIRST_DAY}
                    maxDate={maxDay}
                    markingType="period"
                    markedDates={marking}
                    onDayPress={onDayPress}
                    theme={calendarTheme}
                    style={styles.calendar}
                />

                {earliestEntryDay ? (
                    <Text style={styles.hint}>
                        {`First entry: ${formatDayRangeLabel(
                            { startDay: earliestEntryDay, endDay: earliestEntryDay },
                            maxDay,
                            'day',
                        )}. Earlier dates just show empty days.`}
                    </Text>
                ) : null}

                <View style={styles.buttonRow}>
                    <Pressable
                        testID="date-range-cancel"
                        style={[styles.button, styles.cancelButton]}
                        onPress={onClose}
                        accessibilityRole="button"
                        accessibilityLabel="Cancel choosing dates"
                    >
                        <Text style={styles.buttonText}>Cancel</Text>
                    </Pressable>
                    <Pressable
                        testID="date-range-apply"
                        style={[
                            styles.button,
                            styles.applyButton,
                            !canApply && styles.buttonDisabled,
                        ]}
                        onPress={apply}
                        disabled={!canApply}
                        accessibilityRole="button"
                        accessibilityState={{ disabled: !canApply }}
                        accessibilityLabel="Show stats for the selected dates"
                    >
                        <Text style={[styles.buttonText, styles.applyButtonText]}>Apply</Text>
                    </Pressable>
                </View>
            </View>
        </OverlayModal>
    );
};

const makeStyles = (colors: ThemeColors) =>
    StyleSheet.create({
        card: {
            backgroundColor: colors.cardBackground,
            width: '92%',
            maxWidth: 420,
            borderRadius: 20,
            padding: 20,
            borderWidth: 1,
            borderColor: colors.border,
        },
        title: {
            fontSize: 17,
            fontWeight: '700',
            color: colors.text,
        },
        summary: {
            fontSize: 14,
            color: colors.textSecondary,
            marginTop: 4,
            marginBottom: 12,
        },
        calendar: {
            borderRadius: 16,
            backgroundColor: colors.cardBackground,
        },
        hint: {
            fontSize: 12,
            color: colors.textSecondary,
            marginTop: 10,
            lineHeight: 17,
        },
        buttonRow: {
            flexDirection: 'row',
            gap: 8,
            marginTop: 16,
        },
        button: {
            flex: 1,
            minWidth: 96,
            padding: 12,
            borderRadius: 8,
            alignItems: 'center',
        },
        cancelButton: {
            backgroundColor: colors.overlays.tag,
        },
        applyButton: {
            backgroundColor: colors.accent,
        },
        buttonDisabled: {
            opacity: 0.4,
        },
        buttonText: {
            color: colors.text,
            fontSize: 16,
            fontWeight: '600',
        },
        applyButtonText: {
            color: ON_ACCENT,
        },
    });

export default DateRangePicker;
