// DatePicker.tsx
import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useThemeColors } from '@/styles/global';
import Feather from '@expo/vector-icons/Feather';
import { isSameLocalDay } from './dateHelpersStub';

type DatePickerProps = {
    date: Date;
    onDateChange: (date: Date) => void;
};

/**
 * Which native picker (if any) is currently open. Only one shows at a time.
 */
type PickerMode = 'none' | 'date' | 'time';

/**
 * Normalize a DAY chosen by the native date picker, PRESERVING the draft's
 * current time-of-day.
 *
 * CONTRACT CHANGE (2026-07-13): this used to clamp the picked day to LOCAL
 * MIDNIGHT and discard the time — the entry form was date-only. The form now
 * edits BOTH date and time, so a day change must keep the existing
 * hours/minutes/seconds and only move the calendar day. Storing `.toISOString()`
 * of a Date whose LOCAL day is the intended day still keys correctly, because
 * the app buckets days via `localDateString`, never UTC `date()` (see
 * databases/dateHelpers.ts). If the picker re-emits the SAME local day we return
 * `current` unchanged (identity) to avoid a spurious re-render.
 */
export function normalizePickedDate(picked: Date, current: Date): Date {
    if (isSameLocalDay(picked, current)) {
        return current;
    }
    // Keep the current time-of-day; move only the calendar day. `setFullYear`
    // with all three args sets Y/M/D in one shot (local time), leaving H:M:S:ms.
    const next = new Date(current.getTime());
    next.setFullYear(picked.getFullYear(), picked.getMonth(), picked.getDate());
    return next;
}

/**
 * Normalize a TIME chosen by the native time picker onto the draft's CURRENT
 * local day: keep `current`'s calendar day, adopt `picked`'s hours + minutes
 * (seconds/ms zeroed for a clean minute). Returns `current` unchanged when the
 * hour + minute are identical, to avoid a spurious re-render.
 */
export function normalizePickedTime(picked: Date, current: Date): Date {
    if (
        picked.getHours() === current.getHours() &&
        picked.getMinutes() === current.getMinutes()
    ) {
        return current;
    }
    const next = new Date(current.getTime());
    next.setHours(picked.getHours(), picked.getMinutes(), 0, 0);
    return next;
}

export const DatePicker: React.FC<DatePickerProps> = ({ date, onDateChange }) => {
    const colors = useThemeColors();
    const [mode, setMode] = useState<PickerMode>('none');

    const styles = useMemo(
        () =>
            StyleSheet.create({
                container: {
                    width: '100%',
                    marginBottom: 20,
                },
                field: {
                    marginBottom: 12,
                },
                button: {
                    flexDirection: 'row',
                    alignItems: 'center',
                    backgroundColor: colors.overlays.tag,
                    padding: 12,
                    borderRadius: 8,
                    justifyContent: 'space-between',
                    borderWidth: 1,
                    borderColor: colors.overlays.tagBorder,
                },
                valueText: {
                    color: colors.text,
                    fontSize: 16,
                    flexShrink: 1,
                    marginRight: 8,
                },
                label: {
                    color: colors.textSecondary,
                    fontSize: 14,
                    marginBottom: 8,
                },
            }),
        [colors]
    );

    const longDate = date.toLocaleDateString(undefined, {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
    const shortTime = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // A single onChange for both pickers. On Android the picker is a dialog whose
    // event.type is 'set' or 'dismissed'; 'dismissed' comes with no date, so we
    // guard on both. Which normalizer to apply is decided by the mode that WAS
    // open (captured before we close it).
    const onChange = (event: DateTimePickerEvent, selectedDate?: Date) => {
        const openedMode = mode;
        setMode('none');
        if (event.type !== 'set' || !selectedDate) return;
        if (openedMode === 'time') {
            onDateChange(normalizePickedTime(selectedDate, date));
        } else {
            onDateChange(normalizePickedDate(selectedDate, date));
        }
    };

    return (
        <View style={styles.container}>
            <View style={styles.field}>
                <Text style={styles.label}>Entry date</Text>
                <Pressable
                    style={styles.button}
                    onPress={() => setMode('date')}
                    accessibilityRole="button"
                    accessibilityLabel={`Entry date, ${longDate}. Tap to change.`}
                >
                    <Text style={styles.valueText} numberOfLines={1}>
                        {longDate}
                    </Text>
                    <Feather name="calendar" size={20} color={colors.text} />
                </Pressable>
            </View>

            <View>
                <Text style={styles.label}>Entry time</Text>
                <Pressable
                    style={styles.button}
                    onPress={() => setMode('time')}
                    accessibilityRole="button"
                    accessibilityLabel={`Entry time, ${shortTime}. Tap to change.`}
                >
                    <Text style={styles.valueText} numberOfLines={1}>
                        {shortTime}
                    </Text>
                    <Feather name="clock" size={20} color={colors.text} />
                </Pressable>
            </View>

            {mode !== 'none' && (
                <DateTimePicker
                    value={date}
                    mode={mode}
                    onChange={onChange}
                    // Only the DATE picker is bounded to "today" (no future
                    // entries); the time picker is unrestricted so editing a past
                    // day's time isn't clamped to before the current clock time.
                    maximumDate={mode === 'date' ? new Date() : undefined}
                />
            )}
        </View>
    );
};
