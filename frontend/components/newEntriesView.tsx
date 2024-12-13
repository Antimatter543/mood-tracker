// components/EntriesView.tsx
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useCallback, useEffect, useState } from 'react';
import { globalStyles, colors } from '../styles/global';
import { useSQLiteContext } from 'expo-sqlite';


// This represents a single mood entry in the database
type MoodItem = {
    id: number;
    mood: number;
    notes: string;
    date: string;
};

export function DatabaseViewer2({ moodItems }) {
    return (
      <ScrollView style={styles.container}>
        {moodItems.length > 0 ? (
          moodItems.map((item) => (
            <View key={item.id} style={styles.card}>
              <Text style={styles.moodText}>Mood: {item.mood}</Text>
              <Text style={styles.notesText}>Notes: {item.notes}</Text>
              <Text style={styles.dateText}>Date: {item.date}</Text>
            </View>
          ))
        ) : (
          <Text style={styles.emptyText}>No mood entries yet. Add one!</Text>
        )}
      </ScrollView>
    );
  }

const styles = StyleSheet.create({
container: {
    flex: 1,
},
card: {
    backgroundColor: '#f9f9f9',
    padding: 16,
    marginBottom: 8,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 4,
},
moodText: {
    fontSize: 16,
    fontWeight: 'bold',
},
notesText: {
    fontSize: 14,
    marginTop: 4,
},
dateText: {
    fontSize: 12,
    marginTop: 4,
    color: '#666',
},
emptyText: {
    textAlign: 'center',
    marginTop: 32,
    fontSize: 16,
    color: '#aaa',
},
});