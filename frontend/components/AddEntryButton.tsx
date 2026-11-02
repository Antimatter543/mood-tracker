import { useState, useMemo, useCallback } from 'react';
import { StyleSheet, Pressable, Alert } from 'react-native';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withSpring,
} from 'react-native-reanimated';
import Feather from '@expo/vector-icons/Feather';

import { ThemeColors, useThemeColors } from '@/styles/global';
import { FAB_BOTTOM_GAP, FAB_SIZE } from '@/styles/layout';
import { useDataContext } from '@/context/DataContext';
import { addMoodEntry } from '@/databases/database';
import { useSettings } from '@/context/SettingsContext';
import * as SQLite from 'expo-sqlite';
import { EntryFormData, EntryFormModal } from './forms/EntryForm';
import { subscribeToReminderTaps, dismissNotifications } from '@/lib/notifications';
import { useFocusEffect } from 'expo-router';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function AddEntryButton() {
    const colors = useThemeColors();
    const styles = useThemedStyles(colors);
    const db = SQLite.useSQLiteContext();
    const [modalVisible, setModalVisible] = useState(false);
    const { refetchEntries } = useDataContext();
    const { settings } = useSettings();

    // Tapping one of our reminder notifications (warm, or the tap that
    // launched the app) opens the entry form. Setting an already-true flag is
    // a no-op, so a tap while the form is open does not double-open it.
    useFocusEffect(
        useCallback(() => subscribeToReminderTaps(() => setModalVisible(true)), [])
    );

    // `fab_position` honors the user's left/right preference. The settings
    // registry constrains the value to `'left' | 'right'` so we don't risk
    // injecting a runtime style key here.
    const fabPosition = settings.fab_position;

    // Reanimated scale: spring on press for a subtle, native-feeling tap.
    const scale = useSharedValue(1);
    const animatedStyle = useAnimatedStyle(() => ({
        transform: [{ scale: scale.value }],
    }));

    const handleSubmit = async (formData: EntryFormData) => {
        try {
            // Storing `.toISOString()` preserves the absolute instant.
            // Day-key derivation must use the local-day helper (see
            // [[DatePicker]] for the rationale) — never `.slice(0,10)` on the
            // ISO string directly.
            const result = await addMoodEntry(
                db,
                formData.mood,
                formData.activities,
                formData.notes,
                formData.date.toISOString(),
                formData.photos
            );
            if (result.success) {
                dismissNotifications();
                setModalVisible(false);
                refetchEntries();
            } else {
                // On a failed save the form used to silently stay open with no
                // feedback — the user couldn't tell the entry didn't save. Surface
                // the reason and KEEP the modal open (the draft is preserved).
                Alert.alert("Couldn't save entry", result.message);
            }
        } catch (error) {
            console.error('Error adding entry:', error);
            Alert.alert(
                "Couldn't save entry",
                error instanceof Error ? error.message : 'Something went wrong. Please try again.'
            );
        }
    };

    return (
        <>
            <AnimatedPressable
                style={[styles.floatingButton, { [fabPosition]: 24 }, animatedStyle]}
                onPressIn={() => {
                    scale.value = withSpring(0.92, { damping: 14, stiffness: 220 });
                }}
                onPressOut={() => {
                    scale.value = withSpring(1, { damping: 12, stiffness: 220 });
                }}
                onPress={() => setModalVisible(true)}
                accessibilityRole="button"
                accessibilityLabel="Add mood entry"
                hitSlop={8}
            >
                <Feather name="plus" color="#FFFFFF" size={24} />
            </AnimatedPressable>

            <EntryFormModal
                visible={modalVisible}
                onClose={() => setModalVisible(false)}
                onSubmit={handleSubmit}
            />
        </>
    );
}

const useThemedStyles = (colors: ThemeColors) => {
    return useMemo(
        () =>
            StyleSheet.create({
                floatingButton: {
                    position: 'absolute',
                    // Measured from the bottom of the tab scene, which already
                    // ends at the top of the inset-grown tab bar, so NO bottom
                    // safe-area inset belongs here (see FAB_BOTTOM_GAP in
                    // styles/layout.ts).
                    bottom: FAB_BOTTOM_GAP,
                    zIndex: 1000,
                    backgroundColor: colors.accent,
                    width: FAB_SIZE,
                    height: FAB_SIZE,
                    borderRadius: FAB_SIZE / 2,
                    justifyContent: 'center',
                    alignItems: 'center',
                    // Theme-aware shadow for visual depth.
                    shadowColor: colors.elevation.shadowColor,
                    shadowOffset: { width: 0, height: 3 },
                    shadowOpacity: colors.elevation.shadowOpacity + 0.05,
                    shadowRadius: colors.elevation.shadowRadius,
                    elevation: colors.elevation.elevation + 2,
                },
            }),
        [colors]
    );
};
