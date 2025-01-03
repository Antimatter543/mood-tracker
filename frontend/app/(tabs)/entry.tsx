import { Layout } from "@/components/PageContainer";
import { Text, View, StyleSheet, Button, TextInput } from "react-native";
import * as SQLite from 'expo-sqlite';
import { useState, useEffect, useCallback } from 'react';
import { colors, globalStyles } from "@/styles/global";
import { ActivitySelector } from "@/components/ActivitySelector";
import MoodSelector from "@/components/Test";



export type MoodItem = {
    id: number;
    mood: number;
    activities?: number[]; // Arrary of activity ids
    notes: string;
    date: string;
};

export default function EntriesPage() {
    return (
        <Layout contentStyle={{
            justifyContent: 'flex-start',
            paddingTop: 0, // Remove top padding ('safe zone area, looks ugly when scrolling down)
            paddingBottom: 0,
        }}>

            <Entry />

        </Layout>
    );
}

// Now we can actually do db and stuff
function Entry() {
    const db = SQLite.useSQLiteContext();
    // These 2 states are for adding mood entries
    const [mood, setMood] = useState(5.0); // Initialize mood state
    const [note, setNote] = useState('GAMING');
    const [selectedActivities, setSelectedActivities] = useState<number[]>([]);
    console.log("db acquired ?", db, "\nactivities:", selectedActivities);
    
    // Button shit
    const [message, setMessage] = useState('balls');

    // This state is for the list of mooditems for viewing it
    const [moodItems, setMoodItems] = useState<MoodItem[]>([]);


    // Back to refreshing for listing moods
    const refetchItems = useCallback(() => {
        async function refetch() {
            // Ima be real I have NO IDEA what exclusivetransaction does as
            // opposed to db.getAllAsync. Wait it's wrapped. okay idfk lmao what the fuck
            await db.withExclusiveTransactionAsync(async () => {
                setMoodItems(
                    await db.getAllAsync<MoodItem>(
                        'SELECT * FROM entries ORDER BY date DESC'
                    )
                )
            });
        }
        refetch();
    }, [db]);

    // Btw this and refetchitems arebasically yoinked from https://github.com/expo/examples/tree/master/with-sqlite
    useEffect(() => {
        refetchItems();
      }, []);

      // debugging useeffect to see mooditems length change
    useEffect(() => {
        console.log("Just called refetch, the length of our mood entries table is ?", moodItems.length, moodItems);
    }, [moodItems]);


    // handleSubmits 
    const handleActivitySelect = (activityId: number) => {
        setSelectedActivities(prev => {
            if (prev.includes(activityId)) {
                return prev.filter(id => id !== activityId);
            }
            return [...prev, activityId];
        });
    };

    const handleSubmit = async () => {
        const result = await addMood(db, mood, selectedActivities, note);
        setMessage(result.message);
        
        if (result.success) {
            setMood(5.0);
            setSelectedActivities([]);
            setNote('');
            await refetchItems();
        }
    };


    // For moodselector scroller
    const handleMoodChange = (value: number) => {
        setMood(value); // Update the parent state with the selected value
    };

    return (
    <View style={{ flex: 1 }}> 
        <View style={styles.inputContainer}>
        <Text style={globalStyles.title}>Add New Mood Entry</Text>
            
            <Text style={styles.label}>Mood Score (0-10):</Text>
            <MoodSelector onValueChange={handleMoodChange} />

            <Text style={styles.label}>Selected Mood: {mood.toFixed(1)}</Text>

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

        <Text style={styles.message}>{message}</Text>
        <View>
            <Button
                title="Add Test Item"
                onPress={async () => {
                    await handlePress(db, setMessage);
                    await refetchItems();
                }}
            />
            <Button
                title="Clear All Data"
                onPress={async () => {
                    await handleClearEntries(db, setMessage)
                    await refetchItems();
                }}
                color="#ff4444"
            />
            <Button
            title="Reset Database (for ID etc..."
            onPress={async () => {
                await resetDatabase(db, setMessage);
                await refetchItems(); // Update the UI
            }}
            color="#ff4444"
            />

        </View>
        {/* Above view is old, press button boom add data. Below will be textinput!! TODO create textinputs for mood and activities aswell.. but for now it's just note. */}
        {/* <View style={globalStyles.card}>
        
            <View style={styles.flexRow}>
                <Text style={{color: colors.text}}> Hello </Text>
                <TextInput style={{color: colors.text}}
                onChangeText={(note) => {setNote(note); console.log(note)}}
                onSubmitEditing={async () => {

                    // create dummy mood just bc rn
                    const activity_id = 1;
                    await addMood(db, mood, activity_id, note);
                    await refetchItems();
                    setNote('');
                    setMood(5);
                }}
                />
            </View>
        </View> */}

    </View>
    );
}


//#region Old button stuff

async function handlePress(db: SQLite.SQLiteDatabase, setMessage: React.Dispatch<React.SetStateAction<string>>): Promise<void> {
    if (!db) {
        setMessage('Database not initialized');
        return;
    }

    try {
        const mood = 4.5;
        const activityId = 1;
        const notes = 'Feeling great! Buttoned entry';
        const imagePath = '/path/to/image.jpg';

        await db.runAsync(
            `INSERT INTO entries (mood, notes, image_path) VALUES (?, ?, ?);`,
            [mood, notes, imagePath]
        );

        const items = await db.getAllAsync('SELECT * FROM entries');
        setMessage(`Added new item. Total items: ${items.length}`);
    } catch (error) {
        setMessage(`Error performing database operation: ${error}`);
    }
};

async function resetDatabase(db: SQLite.SQLiteDatabase, setMessage: React.Dispatch<React.SetStateAction<string>>): Promise<void> {
    if (!db) {
      setMessage('Database not initialized');
      return;
    }
  
    try {
      await db.execAsync('DELETE FROM entries;');
      await db.execAsync("DELETE FROM sqlite_sequence WHERE name='entries';");
      setMessage('Database reset successfully');
    } catch (error) {
      setMessage(`Error resetting database: ${error}`);
      console.error(error);
    }
  }
  
async function handleClearEntries(db: SQLite.SQLiteDatabase, setMessage: React.Dispatch<React.SetStateAction<string>>): Promise<void> {
    if (!db) {
        setMessage('Database not initialized');
        return;
    }
    try {
        await db.runAsync('DELETE FROM entries');
        setMessage('All items cleared from database');
    } catch (error) {
        setMessage(`Error clearing database: ${error}`);
    }
};

//#endregion

//#region Database Operations

async function addMood(db: SQLite.SQLiteDatabase, mood: number, activityIds: number[], notes: string): Promise<{ success: boolean; message: string }> {
    try {
        const date = new Date().toISOString();
        
        // Validate mood score
        if (isNaN(mood) || mood < 0 || mood > 10) {
            return {
                success: false,
                message: 'Please enter a valid mood score between 0 and 10'
            };
        }

        const result = await db.runAsync(
            `INSERT INTO entries (mood, notes, date) VALUES (?, ?, ?);`,
            [mood, notes, date]
        );

        // SQLite API provides `lastInsertRowId`
        const entryId = result.lastInsertRowId; // Use the result to get the inserted row's ID
        console.log("New entry ID:", entryId);

        // Then create all activity relationships
        for (const activityId of activityIds) {
            await db.runAsync(
                `INSERT INTO entry_activities (entry_id, activity_id) VALUES (?, ?);`,
                [entryId, activityId]
            );
        }

        return {
            success: true,
            message: 'Entry added successfully!'
        };
    } catch (error) {
        console.error('Error adding mood:', error);
        return {
            success: false,
            message: 'Error adding entry'
        };
    }
}
//#endregion




// Update your styles
const styles = StyleSheet.create({
    // Keep your existing styles and add these new ones...
    inputContainer: {
        backgroundColor: 'rgba(255,255,255,0.1)',
        padding: 16,
        borderRadius: 8,
        marginBottom: 20,
        flex: 1,
    },
    label: {
        color: colors.text,
        fontSize: 16,
        marginBottom: 8,
    },
    input: {
        backgroundColor: '#fff',
        borderRadius: 8,
        padding: 12,
        marginBottom: 16,
        color: '#000',
        fontSize: 16,
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