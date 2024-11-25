import { Layout } from "@/components/PageContainer";
import { Text, View, StyleSheet, Button } from "react-native";
import * as SQLite from 'expo-sqlite';
import { useState, useEffect } from 'react';
import { EntriesView } from "@/components/EntriesView";

export default function AboutScreen() {
    const [db, setDb] = useState<SQLite.SQLiteDatabase | null>(null);
    const [message, setMessage] = useState<string>('');
    const [refreshKey, setRefreshKey] = useState(0); // Add this line

    useEffect(() => {
        initDatabase();
    }, []);

    const initDatabase = async () => {
        try {
            const database = await SQLite.openDatabaseAsync('myDatabase.db');
            const tables = [
                `CREATE TABLE IF NOT EXISTS activities (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  name TEXT NOT NULL UNIQUE
                );`,
                `CREATE TABLE IF NOT EXISTS entries (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  mood REAL NOT NULL,
                  activity_id INTEGER,
                  notes TEXT,
                  image_path TEXT,
                  date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  FOREIGN KEY (activity_id) REFERENCES activities (id)
                );`
            ];

            for (const table of tables) {
                await database.execAsync(table);
            }

            setDb(database);
            setMessage('Database initialized successfully');
        } catch (error) {
            setMessage(`Error initializing database: ${error}`);
        }
    };

    const handlePress = async () => {
        if (!db) {
            setMessage('Database not initialized');
            return;
        }

        try {
            const mood = 4.5;
            const activityId = 1;
            const notes = 'Feeling great!';
            const imagePath = '/path/to/image.jpg';

            await db.runAsync(
                `INSERT INTO entries (mood, activity_id, notes, image_path) VALUES (?, ?, ?, ?);`,
                [mood, activityId, notes, imagePath]
            );

            const items = await db.getAllAsync('SELECT * FROM entries');
            setMessage(`Added new item. Total items: ${items.length}`);
            setRefreshKey(prev => prev + 1); // Add this line to trigger refresh
        } catch (error) {
            setMessage(`Error performing database operation: ${error}`);
        }
    };

    const handleClearEntries = async () => {
        if (!db) {
            setMessage('Database not initialized');
            return;
        }

        try {
            await db.runAsync('DELETE FROM entries');
            setMessage('All items cleared from database');
            setRefreshKey(prev => prev + 1); // Add this line to trigger refresh
        } catch (error) {
            setMessage(`Error clearing database: ${error}`);
        }
    };

    return (
        <Layout contentStyle={{
            justifyContent: 'flex-start',
        }}>
            <Text style={styles.text}>SQLite Database Demo</Text>
            <Text style={styles.message}>{message}</Text>
            <View style={styles.buttonContainer}>
                <Button
                    title="Add Test Item"
                    onPress={handlePress}
                />
                <Button
                    title="Clear All Data"
                    onPress={handleClearEntries}
                    color="#ff4444"
                />
            </View>

            <EntriesView db={db} refreshTrigger={refreshKey} />
        </Layout>
    );
}

const styles = StyleSheet.create({
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
});

