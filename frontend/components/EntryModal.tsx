// components/EntryModal.tsx
import { Modal, StyleSheet, View, Pressable } from 'react-native';
import { Text, TextInput, Button } from 'react-native';
import { ActivitySelector } from "@/components/ActivitySelector";
import { colors, globalStyles } from "@/styles/global";
import * as SQLite from 'expo-sqlite';
import { useState } from 'react';
import { Layout } from "@/components/PageContainer";
import { addMood } from '@/app/(tabs)/entry';

function ModalContent({ 
    onClose,
    onEntryAdded 
}: { 
    onClose: () => void;
    onEntryAdded: () => void;
}) {
    const db = SQLite.useSQLiteContext();
    const [mood, setMood] = useState<string>('');
    const [note, setNote] = useState('');
    const [selectedActivities, setSelectedActivities] = useState<number[]>([]);
    const [message, setMessage] = useState('');

    const handleActivitySelect = (activityId: number) => {
        setSelectedActivities(prev => {
            if (prev.includes(activityId)) {
                return prev.filter(id => id !== activityId);
            }
            return [...prev, activityId];
        });
    };

    const handleSubmit = async () => {
        const moodValue = parseFloat(mood);
        const result = await addMood(db, moodValue, selectedActivities, note);
        setMessage(result.message);
        
        if (result.success) {
            setMood('5.0');
            setSelectedActivities([]);
            setNote('');
            onEntryAdded();
            onClose();
        }
    };

    return (
        <View style={styles.centeredView}>
            <View style={styles.modalView}>
                <Pressable
                    style={styles.closeButton}
                    onPress={onClose}
                >
                    <Text style={styles.closeButtonText}>×</Text>
                </Pressable>

                <Text style={globalStyles.title}>Add New Mood Entry</Text>
                
                <Text style={styles.label}>Mood Score (0-10):</Text>
                <TextInput
                    style={styles.input}
                    value={mood}
                    onChangeText={setMood}
                    keyboardType="decimal-pad"
                    placeholder="Enter mood score (0-10)"
                    placeholderTextColor="#666"
                />

                <Text style={styles.label}>Activities:</Text>
                <ActivitySelector
                    onSelectActivity={handleActivitySelect}
                    selectedActivities={selectedActivities}
                />

                <Text style={styles.label}>Notes:</Text>
                <TextInput
                    style={[styles.input, styles.noteInput]}
                    value={note}
                    onChangeText={setNote}
                    placeholder="How are you feeling?"
                    placeholderTextColor="#666"
                    multiline
                    numberOfLines={3}
                />

                <Button
                    title="Add Entry"
                    onPress={handleSubmit}
                />

                <Text style={styles.message}>{message}</Text>
            </View>
        </View>
    );
}

export function EntryModal({ 
    visible, 
    onClose,
    onEntryAdded 
}: { 
    visible: boolean; 
    onClose: () => void;
    onEntryAdded: () => void;
}) {
    return (
        <Modal
            animationType="slide"
            transparent={true}
            visible={visible}
            onRequestClose={onClose}
        >
            <Layout>
                <ModalContent onClose={onClose} onEntryAdded={onEntryAdded} />
            </Layout>
        </Modal>
    );
}

const styles = StyleSheet.create({
    centeredView: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
    },
    modalView: {
        width: '90%',
        backgroundColor: '#25292e',
        borderRadius: 20,
        padding: 20,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: {
            width: 0,
            height: 2
        },
        shadowOpacity: 0.25,
        shadowRadius: 4,
        elevation: 5
    },
    closeButton: {
        position: 'absolute',
        right: 10,
        top: 10,
        padding: 10,
    },
    closeButtonText: {
        color: colors.text,
        fontSize: 24,
        fontWeight: 'bold',
    },
    label: {
        color: colors.text,
        fontSize: 16,
        marginBottom: 8,
        alignSelf: 'flex-start',
    },
    input: {
        backgroundColor: '#fff',
        borderRadius: 8,
        padding: 12,
        marginBottom: 16,
        color: '#000',
        fontSize: 16,
        width: '100%',
    },
    noteInput: {
        minHeight: 100,
        textAlignVertical: 'top',
    },
    message: {
        color: colors.text,
        textAlign: 'center',
        marginTop: 8,
    },
});