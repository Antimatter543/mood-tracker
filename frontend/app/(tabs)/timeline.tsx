import React, { useState } from "react";
import { Text, View, StyleSheet, Pressable, Modal, TextInput } from "react-native";
import { X } from "lucide-react-native";
import { SQLiteProvider, useSQLiteContext } from 'expo-sqlite';
import MoodSelector from "@/components/Test";
import { ActivitySelector } from "@/components/ActivitySelector";
import { colors } from "@/styles/global";

// Inner component that uses SQLite context
function TimelineContent() {
    const db = useSQLiteContext();
    const [modalVisible, setModalVisible] = useState(false);
    const [currentStep, setCurrentStep] = useState(1);
    
    // Form state
    const [mood, setMood] = useState(5.0);
    const [selectedActivities, setSelectedActivities] = useState<number[]>([]);
    const [note, setNote] = useState('');

    const handleMoodChange = (value: number) => {
        setMood(value);
    };

    const handleActivitySelect = (activityId: number) => {
        setSelectedActivities(prev => {
            if (prev.includes(activityId)) {
                return prev.filter(id => id !== activityId);
            }
            return [...prev, activityId];
        });
    };

    const handleSubmit = async () => {
        try {
            const date = new Date().toISOString();
            
            // Insert the entry
            const result = await db.runAsync(
                `INSERT INTO entries (mood, notes, date) VALUES (?, ?, ?);`,
                [mood, note, date]
            );

            // Get the ID of the newly inserted entry
            const entryId = result.lastInsertRowId;

            // Insert activity relationships
            for (const activityId of selectedActivities) {
                await db.runAsync(
                    `INSERT INTO entry_activities (entry_id, activity_id) VALUES (?, ?);`,
                    [entryId, activityId]
                );
            }

            console.log("Entry added successfully!");
            resetAndClose();
        } catch (error) {
            console.error("Error adding entry:", error);
        }
    };

    const resetAndClose = () => {
        setModalVisible(false);
        setCurrentStep(1);
        setMood(5.0);
        setSelectedActivities([]);
        setNote('');
    };

    const renderStep1 = () => (
        <>
            <Text style={styles.modalTitle}>How were you?</Text>
            <MoodSelector onValueChange={handleMoodChange} />
            <Pressable 
                style={styles.continueButton}
                onPress={() => setCurrentStep(2)}
            >
                <Text style={styles.continueButtonText}>Continue</Text>
            </Pressable>
        </>
    );

    const renderStep2 = () => (
        <>
            <Text style={styles.modalTitle}>What did you do?</Text>
            
                <ActivitySelector
                    onSelectActivity={handleActivitySelect}
                    selectedActivities={selectedActivities}
                />

            <Text style={styles.label}>Notes:</Text>
            <TextInput
                style={styles.noteInput}
                value={note}
                onChangeText={setNote}
                placeholder="How are you feeling?"
                placeholderTextColor="#666"
                multiline
                numberOfLines={3}
            />

            <View style={styles.buttonContainer}>
                <Pressable 
                    style={[styles.navigationButton, styles.backButton]}
                    onPress={() => setCurrentStep(1)}
                >
                    <Text style={styles.buttonText}>Back</Text>
                </Pressable>
                <Pressable 
                    style={[styles.navigationButton, styles.submitButton]}
                    onPress={handleSubmit}
                >
                    <Text style={styles.buttonText}>Submit</Text>
                </Pressable>
            </View>
        </>
    );

    return (
        <View style={styles.container}>
            <Text style={styles.text}>This is the place that will deal with timelines</Text>

            <Pressable 
                style={styles.openButton}
                onPress={() => setModalVisible(true)}
            >
                <Text style={styles.buttonText}>How were you?</Text>
            </Pressable>

            <Modal
                animationType="fade"
                transparent={true}
                visible={modalVisible}
                onRequestClose={resetAndClose}
            >
                <View style={styles.modalContainer}>
                    <View style={styles.modalHeader}>
                        <Pressable
                            style={styles.closeButton}
                            onPress={resetAndClose}
                        >
                            <X color="#fff" size={24} />
                        </Pressable>
                    </View>

                    <View style={styles.modalContent}>
                        {currentStep === 1 ? renderStep1() : renderStep2()}
                    </View>
                </View>
            </Modal>
        </View>
    );
}

// Wrapper component that provides SQLite context
export default function Timeline() {
    return (
        <SQLiteProvider databaseName='moodTracker.db'>
            <TimelineContent />
        </SQLiteProvider>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#25292e',
        alignItems: 'center',
        justifyContent: 'center',
    },
    text: {
        color: '#fff',
        fontSize: 18,
        marginBottom: 20,
    },
    openButton: {
        backgroundColor: '#2C2C2C',
        padding: 15,
        borderRadius: 10,
    },
    buttonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: 'bold',
    },
    modalContainer: {
        flex: 1,
        backgroundColor: '#25292e',
    },
    modalHeader: {
        paddingTop: 40,
        paddingHorizontal: 20,
        flexDirection: 'row',
        justifyContent: 'flex-start',
    },
    closeButton: {
        padding: 8,
    },
    modalContent: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 20,
    },
    modalTitle: {
        color: '#fff',
        fontSize: 24,
        fontWeight: 'bold',
        marginBottom: 30,
    },
    continueButton: {
        backgroundColor: '#4CAF50',
        margin: 20,
        padding: 15,
        borderRadius: 25,
        alignItems: 'center',
        width: '100%',
    },
    continueButtonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: 'bold',
    },
    activitiesContainer: {
        width: '100%',
        marginBottom: 20,
    },
    label: {
        color: colors.text,
        fontSize: 16,
        marginBottom: 8,
        alignSelf: 'flex-start',
    },
    noteInput: {
        backgroundColor: '#fff',
        borderRadius: 8,
        padding: 12,
        marginBottom: 16,
        color: '#000',
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
        backgroundColor: '#666',
    },
    submitButton: {
        backgroundColor: '#4CAF50',
    },
});