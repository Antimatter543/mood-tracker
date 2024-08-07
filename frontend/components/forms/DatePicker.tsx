// DatePicker.tsx
import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useThemeColors } from '@/styles/global';
import Feather from '@expo/vector-icons/Feather';

type DatePickerProps = {
    date: Date;
    onDateChange: (date: Date) => void;
};

export const DatePicker: React.FC<DatePickerProps> = ({ date, onDateChange }) => {
    const colors = useThemeColors();
    const [show, setShow] = useState(false);

    const styles = StyleSheet.create({
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
    });

    const onChange = (event: any, selectedDate?: Date) => {
        setShow(false);
        if (selectedDate) {
            onDateChange(selectedDate);
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