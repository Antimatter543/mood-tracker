// components/ActivityButton.tsx
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MaterialCommunityIcons } from '@expo/vector-icons';

type ActivityButtonProps = {
    label: string;
    icon: string;
    isSelected?: boolean;
    onPress: () => void;
};

export function ActivityButton({ label, icon, isSelected = false, onPress }: ActivityButtonProps) {
    return (
        <TouchableOpacity 
            style={[styles.button, isSelected && styles.buttonSelected]} 
            onPress={onPress}
        >
            <MaterialCommunityIcons 
                name={icon as any} 
                size={24} 
                color={isSelected ? "#000" : "#fff"} 
            />
            <Text style={[styles.buttonText, isSelected && styles.buttonTextSelected]}>
                {label}
            </Text>
        </TouchableOpacity>
    );
}

// components/ActivityGroup.tsx
import { View, Text } from 'react-native';

type ActivityGroupProps = {
    title: string;
    children: React.ReactNode;
};

export function ActivityGroup({ title, children }: ActivityGroupProps) {
    return (
        <View style={styles.group}>
            <View style={styles.headerRow}>
                <Text style={styles.groupTitle}>{title}</Text>
                <TouchableOpacity style={styles.addButton}>
                    <Ionicons name="add" size={24} color="#00ff9d" />
                </TouchableOpacity>
            </View>
            <View style={styles.buttonGrid}>
                {children}
            </View>
        </View>
    );
}

// entry.tsx
import { useState } from 'react';
import { View, ScrollView } from 'react-native';
import { Layout } from '../components/Layout';
import { ActivityButton } from '../components/ActivityButton';
import { ActivityGroup } from '../components/ActivityGroup';

export default function EntryScreen() {
    const [selectedEmotions, setSelectedEmotions] = useState<string[]>([]);
    const [selectedSleep, setSelectedSleep] = useState<string[]>([]);

    const toggleSelection = (category: 'emotions' | 'sleep', id: string) => {
        if (category === 'emotions') {
            setSelectedEmotions(prev => 
                prev.includes(id) 
                    ? prev.filter(item => item !== id)
                    : [...prev, id]
            );
        } else {
            setSelectedSleep(prev => 
                prev.includes(id) 
                    ? prev.filter(item => item !== id)
                    : [...prev, id]
            );
        }
    };

    return (
        <Layout>
            <ScrollView style={styles.scrollView}>
                <ActivityGroup title="Emotions">
                    <ActivityButton 
                        label="Happy"
                        icon="emoticon-happy-outline"
                        isSelected={selectedEmotions.includes('happy')}
                        onPress={() => toggleSelection('emotions', 'happy')}
                    />
                    <ActivityButton 
                        label="Excited"
                        icon="party-popper"
                        isSelected={selectedEmotions.includes('excited')}
                        onPress={() => toggleSelection('emotions', 'excited')}
                    />
                    <ActivityButton 
                        label="Grateful"
                        icon="heart-outline"
                        isSelected={selectedEmotions.includes('grateful')}
                        onPress={() => toggleSelection('emotions', 'grateful')}
                    />
                    <ActivityButton 
                        label="Relaxed"
                        icon="weather-sunny"
                        isSelected={selectedEmotions.includes('relaxed')}
                        onPress={() => toggleSelection('emotions', 'relaxed')}
                    />
                    {/* Add more emotion buttons as needed */}
                </ActivityGroup>

                <ActivityGroup title="Sleep">
                    <ActivityButton 
                        label="Early Sleep"
                        icon="bed-clock"
                        isSelected={selectedSleep.includes('early')}
                        onPress={() => toggleSelection('sleep', 'early')}
                    />
                    <ActivityButton 
                        label="Good Sleep"
                        icon="sleep"
                        isSelected={selectedSleep.includes('good')}
                        onPress={() => toggleSelection('sleep', 'good')}
                    />
                    <ActivityButton 
                        label="Bad Sleep"
                        icon="sleep-off"
                        isSelected={selectedSleep.includes('bad')}
                        onPress={() => toggleSelection('sleep', 'bad')}
                    />
                    {/* Add more sleep buttons as needed */}
                </ActivityGroup>
            </ScrollView>
        </Layout>
    );
}

const styles = StyleSheet.create({
    scrollView: {
        flex: 1,
        width: '100%',
    },
    group: {
        marginBottom: 20,
        padding: 15,
        backgroundColor: 'rgba(0, 0, 0, 0.3)',
        borderRadius: 15,
    },
    headerRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 15,
    },
    groupTitle: {
        color: '#fff',
        fontSize: 18,
        fontWeight: 'bold',
    },
    addButton: {
        padding: 5,
    },
    buttonGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
    },
    button: {
        width: 80,
        height: 80,
        backgroundColor: 'rgba(255, 255, 255, 0.1)',
        borderRadius: 40,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 10,
    },
    buttonSelected: {
        backgroundColor: '#00ff9d',
    },
    buttonText: {
        color: '#fff',
        fontSize: 12,
        textAlign: 'center',
        marginTop: 5,
    },
    buttonTextSelected: {
        color: '#000',
    },
});