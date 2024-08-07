import React, { useState, useMemo } from "react";
import { StyleSheet, Pressable } from "react-native";
import Feather from '@expo/vector-icons/Feather';

import { useThemeColors } from "@/styles/global";
import { useDataContext } from "@/context/DataContext";
import { addMoodEntry } from "@/databases/database";
import { useSettings } from "@/context/SettingsContext";
import * as SQLite from "expo-sqlite";
import { EntryFormData, EntryFormModal } from "./forms/EntryForm";

export function AddEntryButton() {
    const colors = useThemeColors();
    const styles = useThemedStyles(colors);
    const db = SQLite.useSQLiteContext();
    const [modalVisible, setModalVisible] = useState(false);
    const { refetchEntries } = useDataContext();
    const { settings } = useSettings();

    const fabPosition = settings.fab_position;

    const handleSubmit = async (formData: EntryFormData) => {
        try {
            const result = await addMoodEntry(
                db, 
                formData.mood, 
                formData.activities, 
                formData.notes,
                formData.date.toISOString()
            );
            if (result.success) {
                setModalVisible(false);
                refetchEntries();
            }
        } catch (error) {
            console.error("Error adding entry:", error);
        }
    };

    return (
        <>
            <Pressable 
                style={({ pressed }) => [
                    styles.floatingButton,
                    { [fabPosition]: 24 },
                    pressed && styles.buttonPressed
                ]} 
                onPress={() => setModalVisible(true)}
            >
                <Feather name="plus" color={colors.text} size={24} />
            </Pressable>

            <EntryFormModal
                visible={modalVisible}
                onClose={() => setModalVisible(false)}
                onSubmit={handleSubmit}
            />
        </>
    );
}

const useThemedStyles = (colors: any) => {
    return useMemo(() => StyleSheet.create({
        floatingButton: {
            position: 'absolute',
            bottom: 24,
            zIndex: 1000,
            backgroundColor: colors.accent,
            width: 56,
            height: 56,
            borderRadius: 28,
            justifyContent: 'center',
            alignItems: 'center',
            elevation: 4,
            shadowColor: '#000',
            shadowOffset: {
                width: 0,
                height: 2,
            },
            shadowOpacity: 0.25,
            shadowRadius: 3.84,
        },
        buttonPressed: {
            backgroundColor: colors.accentDark,
            transform: [{ scale: 0.95 }],
        },
    }), [colors]);
};