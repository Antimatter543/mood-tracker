import { Layout } from "@/components/PageContainer";
import { Text, View, StyleSheet, Button, TextInput, ScrollView } from "react-native";
import * as SQLite from 'expo-sqlite';
import { useState, useEffect, useCallback } from 'react';
import { colors, globalStyles } from "@/styles/global";



type MoodItem = {
    id: number;
    mood: number;
    activity_id: number;
    notes: string;
    date: string;
};

export default function EntriesPageCopy() {
    return (
        <Layout contentStyle={{
            justifyContent: 'flex-start',
            paddingTop: 0, // Remove top padding ('safe zone area, looks ugly when scrolling down)
            paddingBottom: 0,
        }}>

            <Entry />
            <View style={{ height: 20 }} /> {/* Add some bottom padding, contingent on Scrollview style height for reasons known only to god */}

        </Layout>
    );
}

// Now we can actually do db and stuff
function Entry() {
    const db = SQLite.useSQLiteContext();
    console.log("db acquired ?", db);
    // These 2 states are for adding mood entries
    const [mood, setMood] = useState<string>('5.0');
    const [note, setNote] = useState('GAMING');
    
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
        console.log("Wzczzcxe just called refetch, the length of our mood entries table is ?", moodItems.length, moodItems);
    }, [moodItems]);


    // handleSubmits 
    const handleSubmit = async () => {
        const moodValue = parseFloat(mood);
        const activity_id = 1; // default activity for now
        
        const result = await addMood(db, moodValue, activity_id, note);
        setMessage(result.message);
        
        if (result.success) {
            setMood('5.0');
            setNote('');
            await refetchItems();
        }
    };

    return (
    <View style={globalStyles.contentContainer}> 

        <Text style={globalStyles.title}>Add New Mood Entry</Text>
            
        <View style={styles.inputContainer}>
            <Text style={styles.label}>Mood Score (0-10):</Text>
            <TextInput
                style={styles.input}
                value={mood}
                onChangeText={setMood}
                keyboardType="decimal-pad"
                placeholder="Enter mood score (0-10)"
                placeholderTextColor="#666"
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

        <Text style={styles.text}>SQLite Database Demo</Text>
        <Text style={styles.message}>{message}</Text>
        <View style={styles.buttonContainer}>
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
        {/* THE SCROLLING THINGYYY */}
        <Text style={globalStyles.title}>Mood YOOPO</Text>

        <View style={globalStyles.card}>
            <Text style={globalStyles.title}>Mood Tracker</Text>
            {/* Your mood tracking content will go here */}
            <Text style={styles.text}>Hello</Text>
            {/* im gonna kill myself. styles.container made it in visible. */}
                <ScrollView> 
                    {moodItems.map(entry => (
                        <View key={entry.id} style={globalStyles.card}>
                            <Text style={{color: colors.text}}>ID: {entry.id}</Text>
                            <Text style={{color: colors.text}}>Mood Value: {entry.mood}</Text>
                            {/* <Text style={{color: colors.text}}>Activity ID: {entry.activity_id}</Text> */}

                            <Text style={{color: colors.text}}>Notes: {entry.notes || 'No notes'}</Text>
                            <Text style={{color: colors.text}}> Date: {entry.date} </Text>
                        </View>
                    ))}
                </ScrollView>
        </View>
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
            `INSERT INTO entries (mood, notes) VALUES  ?, ?);`,
            [mood, notes]
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

async function addMood(db: SQLite.SQLiteDatabase, mood: number, activity_id: number, notes: string): Promise<{ success: boolean; message: string }> {
    try {
        const date = new Date().toISOString();
        
        // Validate mood score
        if (isNaN(mood) || mood < 0 || mood > 10) {
            return {
                success: false,
                message: 'Please enter a valid mood score between 0 and 10'
            };
        }

        await db.runAsync(
            `INSERT INTO entries (mood, activity_id, notes, date) VALUES (?, ?, ?, ?);`,
            [mood, activity_id, notes, date]
        );

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