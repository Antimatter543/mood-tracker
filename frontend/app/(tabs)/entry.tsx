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

export default function EntriesPage() {
    return (
        <Layout contentStyle={{
            justifyContent: 'flex-start',
        }}>
            <Entry />
        </Layout>
    );
}

// Now we can actually do db and stuff
function Entry() {
    const db = SQLite.useSQLiteContext();
    console.log("db acquired ?", db);
    // These 2 states are for adding mood entries
    const [mood, setMood] = useState(5);
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
    return (
    <View style={{justifyContent: "flex-start"}}> 
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
        {/* <View style={styles.flexRow}>
            <TextInput style={styles.text}
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
            `INSERT INTO entries (mood, activity_id, notes, image_path) VALUES (?, ?, ?, ?);`,
            [mood, activityId, notes, imagePath]
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

async function addMood(db: SQLite.SQLiteDatabase, mood: Number, activity_id: Number, note: string): Promise<void> {
    const date = new Date().toISOString();

};

//#endregion



const styles = StyleSheet.create({
    entryCard: {
        backgroundColor: '#fff',
        marginVertical: 5,
    },
    text: {
        color: '#fff',
        marginVertical: 2,
    },
    message: {
        color: '#fff',
        marginBottom: 20,
        textAlign: 'center',
    },
    buttonContainer: {
        width: '100%',
        maxWidth: 300,
    },
    flexRow: {
    flexDirection: 'row',
    },
    input: {
    borderColor: '#4630eb',
    borderRadius: 4,
    borderWidth: 1,
    flex: 1,
    height: 48,
    margin: 16,
    padding: 8,
    },
});

