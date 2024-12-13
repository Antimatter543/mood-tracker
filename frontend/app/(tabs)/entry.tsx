import { Layout } from "@/components/PageContainer";
import { Text, View, StyleSheet, Button, TextInput, ScrollView } from "react-native";
import * as SQLite from 'expo-sqlite';
import { useState, useEffect, useCallback } from 'react';
import { globalStyles } from "@/styles/global";



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
    // These 2 states are for adding mood entries
    const [mood, setMood] = useState(5);
    const [note, setNote] = useState('GAMING');
    
    // Button shit
    const [message, setMessage] = useState('balls');

    // This state is for the list of mooditems for viewing it
    const [moodItems, setMoodItems] = useState<MoodItem[]>([]);


    // Back to refreshing for listing moods
    const refetchItems = useCallback(() => {
        async function refetchItems() {
            // Ima be real I have NO IDEA what exclusivetransaction does as
            // opposed to db.getAllAsync. Wait it's wrapped. okay idfk lmao what the fuck
            await db.withExclusiveTransactionAsync(async () => {
                setMoodItems(
                    await db.getAllAsync<MoodItem>(
                        'SELECT * FROM entries'
                    )
                )
            });
            console.log("We just called refetch, the length of our mood entries table is ?", moodItems.length);
        }

        refetchItems();
    }, [db]);

    // Btw this and refetchitems arebasically yoinked from https://github.com/expo/examples/tree/master/with-sqlite
    useEffect(() => {
        refetchItems();
        console.log("Wzczzcxe just called refetch, the length of our mood entries table is ?", moodItems.length);
      }, []);


    return (
    <View> 
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
        </View>
        {/* Above view is old, press button boom add data. Below will be textinput!! TODO create textinputs for mood and activities aswell.. but for now it's just note. */}
        <View style={styles.flexRow}>
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
        </View>

        {/* THE SCROLLING THINGYYY */}
        <View>
            <Text style={styles.text}> This is the entries vidfzew: </Text>
            <ScrollView style={styles.container}>
                {moodItems.map(entry => (
                    <View key={entry.id} style={globalStyles.card}>
                        <Text style={styles.text}>ID: {entry.id}</Text>
                        <Text style={styles.text}>Mood Value: {entry.mood}</Text>
                        <Text style={styles.text}>Activity ID: {entry.activity_id}</Text>

                        <Text style={styles.text}>Notes: {entry.notes || 'No notes'}</Text>
                        <Text style={styles.text}> Date: {entry.date} </Text>
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

// const [db, setDb] = useState<SQLite.SQLiteDatabase | null>(null);
// const [message, setMessage] = useState<string>('');
// const [refreshKey, setRefreshKey] = useState(0); // Add this line

// useEffect(() => {
//     initDatabase();
// }, []);

// const initDatabase = async () => {
//     try {
//         const database = await SQLite.openDatabaseAsync('myDatabase.db');
//         const tables = [
//             `CREATE TABLE IF NOT EXISTS activities (
//               id INTEGER PRIMARY KEY AUTOINCREMENT,
//               name TEXT NOT NULL UNIQUE
//             );`,
//             `CREATE TABLE IF NOT EXISTS entries (
//               id INTEGER PRIMARY KEY AUTOINCREMENT,
//               mood REAL NOT NULL,
//               activity_id INTEGER,
//               notes TEXT,
//               image_path TEXT,
//               date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
//               FOREIGN KEY (activity_id) REFERENCES activities (id)
//             );`
//         ];

//         for (const table of tables) {
//             await database.execAsync(table);
//         }

//         setDb(database);
//         setMessage('Database initialized successfully');
//     } catch (error) {
//         setMessage(`Error initializing database: ${error}`);
//     }
// };

// const handlePress = async () => {
//     if (!db) {
//         setMessage('Database not initialized');
//         return;
//     }

//     try {
//         const mood = 4.5;
//         const activityId = 1;
//         const notes = 'Feeling great!';
//         const imagePath = '/path/to/image.jpg';

//         await db.runAsync(
//             `INSERT INTO entries (mood, activity_id, notes, image_path) VALUES (?, ?, ?, ?);`,
//             [mood, activityId, notes, imagePath]
//         );

//         const items = await db.getAllAsync('SELECT * FROM entries');
//         setMessage(`Added new item. Total items: ${items.length}`);
//         setRefreshKey(prev => prev + 1); // Add this line to trigger refresh
//     } catch (error) {
//         setMessage(`Error performing database operation: ${error}`);
//     }
// };

// const handleClearEntries = async () => {
//     if (!db) {
//         setMessage('Database not initialized');
//         return;
//     }

//     try {
//         await db.runAsync('DELETE FROM entries');
//         setMessage('All items cleared from database');
//         setRefreshKey(prev => prev + 1); // Add this line to trigger refresh
//     } catch (error) {
//         setMessage(`Error clearing database: ${error}`);
//     }
// };

const styles = StyleSheet.create({
    container: {
        flex: 1,
        width: '100%',
    },
    text: {
        color: '#fff',
        fontSize: 20,
        marginBottom: 20,
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

