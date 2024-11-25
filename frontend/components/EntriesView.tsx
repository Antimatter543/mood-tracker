// components/EntriesView.tsx
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useEffect, useState } from 'react';
import * as SQLite from 'expo-sqlite';
import { globalStyles } from '@/styles/global';

type Entry = {
  id: number;
  mood: number;
  notes: string;
  date: string;
};

export function EntriesView({ 
  db, 
  refreshTrigger 
}: { 
  db: SQLite.SQLiteDatabase | null;
  refreshTrigger?: number;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);

  useEffect(() => {
    if (db) {
      loadEntries();
    }
  }, [db, refreshTrigger]); // Add refreshTrigger to dependencies

  const loadEntries = async () => {
    try {
      const result = await db?.getAllAsync('SELECT * FROM entries ORDER BY date DESC');
      setEntries(result || []);
    } catch (error) {
      console.error('Error loading entries:', error);
    }
  };

  return (
    <ScrollView style={styles.container}>
      {entries.map(entry => (
        <View key={entry.id} style={globalStyles.card}>
          <Text style={styles.text}>ID: {entry.id}</Text>
          <Text style={styles.text}>Mood Value: {entry.mood}</Text>
          <Text style={styles.text}>Notes: {entry.notes || 'No notes'}</Text>
          <Text style={styles.text}>
            Date: {new Date(entry.date).toLocaleString()}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
  },
  entryCard: {
    backgroundColor: '#fff',
    marginVertical: 5,
  },
  text: {
    color: '#fff',
    marginVertical: 2,
  },
});