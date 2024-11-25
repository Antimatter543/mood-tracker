import { Layout } from "@/components/PageContainer";
import { Text, View, StyleSheet, Button, Platform } from "react-native";
// import * as SQLite from 'expo-sqlite';
import { useState, useEffect } from 'react';

export default function AboutScreen() {
    const [db, setDb] = useState<SQLite.SQLiteDatabase | null>(null);
    const [message, setMessage] = useState<string>('');

    // Initialize database when component mounts
    useEffect(() => {
        initDatabase();
    }, []);

    const initDatabase = async () => {
        try {
            const database = await SQLite.openDatabaseAsync('myDatabase.db');
            // Create table if it doesn't exist
            await database.execAsync(`
                CREATE TABLE IF NOT EXISTS items (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `);

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
            // Insert a test item
            const result = await db.runAsync(
                'INSERT INTO items (title) VALUES (?)',
                [`Test Item ${Date.now()}`]
            );

            // Fetch all items
            const items = await db.getAllAsync('SELECT * FROM items');

            setMessage(`Added new item. Total items: ${items.length}`);
        } catch (error) {
            setMessage(`Error performing database operation: ${error}`);
        }
    };

    const handleClearData = async () => {
        if (!db) {
            setMessage('Database not initialized');
            return;
        }

        try {
            await db.runAsync('DELETE FROM items');
            setMessage('All items cleared from database');
        } catch (error) {
            setMessage(`Error clearing database: ${error}`);
        }
    };

    return (
        <Layout>
            
            <Text style={styles.text}>SQLite Database Demo</Text>
            <Text style={styles.message}>{message}</Text>
            <View style={styles.buttonContainer}>
                <Button
                    title="Add Test Item"
                    onPress={handlePress}
                />
                {/* <View style={styles.buttonSpacing} /> */}
                <Button
                    title="Clear All Data"
                    onPress={handleClearData}
                    color="#ff4444"
                />
            </View>
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
    buttonSpacing: {
        height: 10,
    }
});