// DatePicker.tsx
import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useThemeColors } from '@/styles/global';
import Feather from '@expo/vector-icons/Feather';
import { isSameLocalDay, startOfLocalDay } from './dateHelpersStub';

type DatePickerProps = {
    date: Date;
    onDateChange: (date: Date) => void;
};

/**
 * Normalize the date returned by the native picker so the *user-perceived
 * day* survives serialization.
 *
 * Problem (the bug we're fixing): the native picker returns a Date whose
 * `.toLocaleDateString()` shows the day the user selected, but whose UTC
 * components can spill to the adjacent day in extreme timezones. Storing
 * `.toISOString()` then computing a "day key" with `.slice(0, 10)` later
 * causes off-by-one errors.
 *
 * Solution: clamp to local midnight before propagating. This keeps the same
 * local calendar day and pushes the UTC representation safely into the
 * middle of the user's day in most timezones. We deliberately preserve the
 * picker's local *day* and discard the time-of-day, which is what the entry
 * form has always semantically wanted (this is a date picker, not a
 * date-time picker).
 *
 * We also guarantee that if the picker returns a date on the same local day
 * as `current`, we pass through `current` unchanged — avoiding spurious
 * re-renders.
 */
export function normalizePickedDate(picked: Date, current: Date): Date {
    if (isSameLocalDay(picked, current)) {
        return current;
    }
    return startOfLocalDay(picked);
}

export const DatePicker: React.FC<DatePickerProps> = ({ date, onDateChange }) => {
    const colors = useThemeColors();
    const [show, setShow] = useState(false);

    const styles = useMemo(
        () =>
            StyleSheet.create({
                container: {
                    width: '100%',
                    marginBottom: 20,
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
                dateText: {
                    color: colors.text,
                    fontSize: 16,
                },
                label: {
                    color: colors.textSecondary,
                    fontSize: 14,
                    marginBottom: 8,
                },
            }),
        [colors]
    );

    const onChange = (_event: unknown, selectedDate?: Date) => {
        setShow(false);
        if (selectedDate) {
            onDateChange(normalizePickedDate(selectedDate, date));
        }
    };

    return (
        <View style={styles.container}>
            <Text style={styles.label}>Entry Date</Text>
            <Pressable style={styles.button} onPress={() => setShow(true)}>
                <Text style={styles.dateText}>
                    {date.toLocaleDateString(undefined, {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                    })}
                </Text>
                <Feather name="calendar" size={20} color={colors.text} />
            </Pressable>

            {show && (
                <DateTimePicker
                    value={date}
                    mode="date"
                    onChange={onChange}
                    maximumDate={new Date()}
                />
            )}
        </View>
    );
};
