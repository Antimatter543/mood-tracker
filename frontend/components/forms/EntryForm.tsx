// EntryForm.tsx
import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput, Modal } from 'react-native';
import { useThemeColors } from '@/styles/global';
import Ionicons from '@expo/vector-icons/Ionicons';

import { ActivitySelector } from './ActivitySelector';
import MoodSelector from './MoodSelector';
import InfoBubble from '../InfoBubble';
import { DatePicker } from './DatePicker';
import { useSettings } from '@/context/SettingsContext';

// Types
type EntryFormProps = {
    initialData?: EntryFormData;
    onSubmit: (data: EntryFormData) => Promise<void>;
    onCancel: () => void;
};

export type EntryFormData = {
    mood: number;
    activities: number[];
    notes: string;
    date: Date;
};

// Internal Components
const MoodStep = ({
    value,
    onChange,
    onContinue,
    date,           // Add this
    onDateChange    // Add this
}: {
    value: number;
    onChange: (mood: number) => void;
    onContinue: () => void;
    date: Date;           // Add this
    onDateChange: (date: Date) => void;  // Add this
}) => {
    const colors = useThemeColors();
    const styles = useThemedStyles(colors);
    const { settings } = useSettings();
    
    // Use settings directly
    const moodPrecision = settings.mood_precision;
    const showMoodBenchmarks = settings.show_mood_benchmarks;
    


    return (
        <>
            <Text style={styles.title}>How were you?</Text>
            <MoodSelector onValueChange={onChange} initialValue={value} precision={moodPrecision} showBenchmarks={showMoodBenchmarks} />
            <DatePicker
                date={date}
                onDateChange={onDateChange}
            />

            <Pressable style={styles.continueButton} onPress={onContinue}>
                <Text style={styles.continueButtonText}>Continue</Text>
            </Pressable>
        </>
    );
};

const DetailsStep = ({
    activities,
    notes,
    onActivitiesChange,
    onNotesChange,
    onBack,
    onSubmit
}: {
    activities: number[];
    notes: string;
    onActivitiesChange: (activities: number[]) => void;
    onNotesChange: (notes: string) => void;
    onBack: () => void;
    onSubmit: () => void;
}) => {
    const colors = useThemeColors();
    const styles = useThemedStyles(colors);

    return (
        <>
            <Text style={styles.title}>What did you do?</Text>
            <ActivitySelector
                onSelectActivity={(activityId) => {
                    onActivitiesChange(
                        activities.includes(activityId)
                            ? activities.filter(id => id !== activityId)
                            : [...activities, activityId]
                    );
                }}
                selectedActivities={activities}
            />

            {/* Notes section */}
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
                    style={[styles.navigationButton, styles.submitButton]}
                    onPress={onSubmit}
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

                    {/* Only show InfoBubble when we're on the second step (activities selection) */}
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

// Main Component
export const EntryForm: React.FC<EntryFormProps> = ({
    initialData = {
        mood: 5.0,
        activities: [],
        notes: "",
        date: new Date()  // Add this
    },
    onSubmit,
    onCancel
}) => {
    const [currentStep, setCurrentStep] = useState(1);
    const [formData, setFormData] = useState<EntryFormData>(initialData);
    const colors = useThemeColors();
    const styles = useThemedStyles(colors);

    const handleSubmit = async () => {
        await onSubmit(formData);
    };

    return (
        <View style={styles.contentContainer}>
            {currentStep === 1 ? (
                <MoodStep
                    value={formData.mood}
                    onChange={(mood) => setFormData(prev => ({ ...prev, mood }))}
                    onContinue={() => setCurrentStep(2)}
                    date={formData.date}           // Add this
                    onDateChange={(date) => setFormData(prev => ({ ...prev, date }))}  // Add this
                />
            ) : (
                <DetailsStep
                    activities={formData.activities}
                    notes={formData.notes}
                    onActivitiesChange={(activities) =>
                        setFormData(prev => ({ ...prev, activities }))
                    }
                    onNotesChange={(notes) =>
                        setFormData(prev => ({ ...prev, notes }))
                    }
                    onBack={() => setCurrentStep(1)}
                    onSubmit={handleSubmit}
                />
            )}
        </View>
    );
};

// Styles
const useThemedStyles = (colors: any) => StyleSheet.create({
    modalContainer: {
        flex: 1,
        backgroundColor: colors.background,
        paddingTop: 16, // Add modest padding at the top
    },
    modalHeader: {
        paddingHorizontal: 12,
        flexDirection: "row",
        justifyContent: "flex-start",
        marginBottom: 8, // Add some space below the header
    },
    closeButton: {
        padding: 8,
    },
    contentContainer: {
        flex: 1,
        paddingBottom: '5%',
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 20,
    },
    title: {
        color: colors.text,
        marginTop: -15,
        fontSize: 24,
        fontWeight: "bold",
        marginBottom: 15,
    },
    label: {
        color: colors.text,
        fontSize: 16,
        marginBottom: 8,
        alignSelf: "flex-start",
    },
    noteInput: {
        backgroundColor: colors.cardBackground,
        borderRadius: 8,
        padding: 12,
        color: colors.text,
        fontSize: 16,
        width: "100%",
        minHeight: 100,
        textAlignVertical: "top",
    },
    buttonContainer: {
        flexDirection: "row",
        justifyContent: "space-between",
        width: "100%",
        marginTop: 20,
    },
    navigationButton: {
        flex: 1,
        padding: 15,
        borderRadius: 25,
        alignItems: "center",
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
    continueButtonText: {
        color: colors.text,
        fontSize: 16,
        fontWeight: 'bold',
    },
});