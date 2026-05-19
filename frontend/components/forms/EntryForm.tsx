// EntryForm.tsx
import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput, Modal } from 'react-native';
import { ThemeColors, useThemeColors } from '@/styles/global';
import Ionicons from '@expo/vector-icons/Ionicons';

import { ActivitySelector } from './ActivitySelector';
import MoodSelector from './MoodSelector';
import InfoBubble from '../InfoBubble';
import { DatePicker } from './DatePicker';
import { useSettings } from '@/context/SettingsContext';
import { useEntryDraft, EntryDraft } from './hooks/useEntryDraft';

// Types
type EntryFormProps = {
    initialData?: EntryFormData;
    onSubmit: (data: EntryFormData) => Promise<void>;
    onCancel: () => void;
};

// Kept for backward compatibility with callers (AddEntryButton etc.) — the
// hook's `EntryDraft` is the same shape.
export type EntryFormData = EntryDraft;

// Internal Components
const MoodStep = ({
    value,
    onChange,
    onContinue,
    date,
    onDateChange,
    moodError,
}: {
    value: number;
    onChange: (mood: number) => void;
    onContinue: () => void;
    date: Date;
    onDateChange: (date: Date) => void;
    moodError?: string;
}) => {
    const colors = useThemeColors();
    const styles = useThemedStyles(colors);
    const { settings } = useSettings();

    const moodPrecision = settings.mood_precision;
    const showMoodBenchmarks = settings.show_mood_benchmarks;

    return (
        <>
            <Text style={styles.title}>How were you?</Text>
            <MoodSelector
                onValueChange={onChange}
                initialValue={value}
                precision={moodPrecision}
                showBenchmarks={showMoodBenchmarks}
            />
            <DatePicker date={date} onDateChange={onDateChange} />

            {moodError ? (
                <Text style={styles.errorText} accessibilityRole="alert">
                    {moodError}
                </Text>
            ) : null}

            <Pressable
                style={[styles.continueButton, !!moodError && styles.continueButtonDisabled]}
                onPress={onContinue}
                accessibilityState={{ disabled: !!moodError }}
                disabled={!!moodError}
            >
                <Text style={styles.continueButtonText}>Continue</Text>
            </Pressable>
        </>
    );
};

const DetailsStep = ({
    activities,
    notes,
    onToggleActivity,
    onNotesChange,
    onBack,
    onSubmit,
    submitDisabled,
}: {
    activities: number[];
    notes: string;
    onToggleActivity: (activityId: number) => void;
    onNotesChange: (notes: string) => void;
    onBack: () => void;
    onSubmit: () => void;
    submitDisabled?: boolean;
}) => {
    const colors = useThemeColors();
    const styles = useThemedStyles(colors);

    return (
        <>
            <Text style={styles.title}>What did you do?</Text>
            <ActivitySelector
                onSelectActivity={onToggleActivity}
                selectedActivities={activities}
            />

            <Text style={styles.label}>Notes:</Text>
            <TextInput
                style={styles.noteInput}
                value={notes}
                onChangeText={onNotesChange}
                placeholder="How are you feeling?"
                placeholderTextColor="#666"
                multiline
                numberOfLines={3}
            />

            <View style={styles.buttonContainer}>
                <Pressable
                    style={[styles.navigationButton, styles.backButton]}
                    onPress={onBack}
                >
                    <Text style={styles.buttonText}>Back</Text>
                </Pressable>
                <Pressable
                    style={[
                        styles.navigationButton,
                        styles.submitButton,
                        submitDisabled && styles.continueButtonDisabled,
                    ]}
                    onPress={onSubmit}
                    disabled={submitDisabled}
                    accessibilityState={{ disabled: !!submitDisabled }}
                >
                    <Text style={styles.buttonText}>Submit</Text>
                </Pressable>
            </View>
        </>
    );
};

// Add modal wrapper component for convenience
export const EntryFormModal: React.FC<{
    visible: boolean;
    onClose: () => void;
    initialData?: EntryFormData;
    onSubmit: (data: EntryFormData) => Promise<void>;
}> = ({ visible, onClose, initialData, onSubmit }) => {
    const colors = useThemeColors();
    const styles = useThemedStyles(colors);

    return (
        <Modal
            animationType="fade"
            transparent={true}
            visible={visible}
            onRequestClose={onClose}
        >
            <View style={styles.modalContainer}>
                <View style={styles.modalHeader}>
                    <Pressable style={styles.closeButton} onPress={onClose}>
                        <Ionicons name="close" color={colors.text} size={24} />
                    </Pressable>

                    <InfoBubble
                        text="Hold an activity to edit or delete it"
                        position="top-right"
                    />
                </View>

                <EntryForm
                    initialData={initialData}
                    onSubmit={onSubmit}
                    onCancel={onClose}
                />
            </View>
        </Modal>
    );
};

// Main Component — render layer only. All state lives in useEntryDraft.
export const EntryForm: React.FC<EntryFormProps> = ({
    initialData,
    onSubmit,
    onCancel: _onCancel,
}) => {
    const [currentStep, setCurrentStep] = useState(1);
    const {
        draft,
        setMood,
        setNotes,
        toggleActivity,
        setDate,
        validation,
        isValid,
        submit,
    } = useEntryDraft(initialData);
    const colors = useThemeColors();
    const styles = useThemedStyles(colors);

    const handleSubmit = async () => {
        // submit() runs validation again before invoking onSubmit, so we never
        // hit the DB with a bad mood value — the pre-submit UI guard is
        // duplicated by the hook for safety.
        await submit(onSubmit);
    };

    return (
        <View style={styles.contentContainer}>
            {currentStep === 1 ? (
                <MoodStep
                    value={draft.mood}
                    onChange={setMood}
                    onContinue={() => setCurrentStep(2)}
                    date={draft.date}
                    onDateChange={setDate}
                    moodError={validation.errors.mood}
                />
            ) : (
                <DetailsStep
                    activities={draft.activities}
                    notes={draft.notes}
                    onToggleActivity={toggleActivity}
                    onNotesChange={setNotes}
                    onBack={() => setCurrentStep(1)}
                    onSubmit={handleSubmit}
                    submitDisabled={!isValid}
                />
            )}
        </View>
    );
};

// Styles
const useThemedStyles = (colors: ThemeColors) =>
    StyleSheet.create({
        modalContainer: {
            flex: 1,
            backgroundColor: colors.background,
            paddingTop: 16,
        },
        modalHeader: {
            paddingHorizontal: 12,
            flexDirection: 'row',
            justifyContent: 'flex-start',
            marginBottom: 8,
        },
        closeButton: {
            padding: 8,
        },
        contentContainer: {
            flex: 1,
            paddingBottom: '5%',
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 20,
        },
        title: {
            color: colors.text,
            marginTop: -15,
            fontSize: 24,
            fontWeight: 'bold',
            marginBottom: 15,
        },
        label: {
            color: colors.text,
            fontSize: 16,
            marginBottom: 8,
            alignSelf: 'flex-start',
        },
        noteInput: {
            backgroundColor: colors.cardBackground,
            borderRadius: 8,
            padding: 12,
            color: colors.text,
            fontSize: 16,
            width: '100%',
            minHeight: 100,
            textAlignVertical: 'top',
        },
        buttonContainer: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            width: '100%',
            marginTop: 20,
        },
        navigationButton: {
            flex: 1,
            padding: 15,
            borderRadius: 25,
            alignItems: 'center',
            marginHorizontal: 5,
        },
        backButton: {
            backgroundColor: colors.overlays.tag,
        },
        submitButton: {
            backgroundColor: colors.accent,
        },
        buttonText: {
            color: colors.text,
            fontSize: 16,
            fontWeight: '600',
        },
        continueButton: {
            backgroundColor: colors.accent,
            margin: 20,
            padding: 15,
            borderRadius: 25,
            alignItems: 'center',
            width: '100%',
        },
        continueButtonDisabled: {
            opacity: 0.5,
        },
        continueButtonText: {
            color: colors.text,
            fontSize: 16,
            fontWeight: 'bold',
        },
        errorText: {
            color: '#ff6b6b',
            fontSize: 14,
            marginTop: 8,
            alignSelf: 'flex-start',
        },
    });
