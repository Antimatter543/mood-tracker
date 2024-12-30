import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { globalStyles, colors } from '@/styles/global';
import { MoodItem } from '@/app/(tabs)/entry';

type EntryWithActivities = MoodItem & {
  activities: Array<{
    name: string;
    group: string;
    icon_path: string;
  }>;
};

export function DatabaseViewer() {
    const db = useSQLiteContext();
    const [entries, setEntries] = useState<EntryWithActivities[]>([]);
  
    useEffect(() => {
      async function loadEntriesWithActivities() {
        try {
          // First get all entries
          const rawEntries = await db.getAllAsync<MoodItem>('SELECT * FROM entries ORDER BY date DESC');
          
          // For each entry, fetch its activities
          const entriesWithActivities = await Promise.all(
            rawEntries.map(async (entry) => {
              const activities = await db.getAllAsync(`
                SELECT a.name, a."group", a.icon_path
                FROM activities a
                JOIN entry_activities ea ON ea.activity_id = a.id
                WHERE ea.entry_id = ?
                ORDER BY a."group", a.name
              `, [entry.id]);
  
              return {
                ...entry,
                activities
              };
            })
          );
  
          setEntries(entriesWithActivities);
        } catch (error) {
          console.error('Error loading entries with activities:', error);
        }
      }
  
      loadEntriesWithActivities();
    }, []);
  
    return (
      <ScrollView style={{ paddingBottom: 100 }}>
        {entries.map(entry => (
          <View key={entry.id} style={globalStyles.card}>
            <Text style={styles.moodValue}>Mood: {entry.mood}</Text>
            
            {entry.activities.length > 0 && (
              <View style={styles.activitiesContainer}>
                <Text style={styles.sectionTitle}>Activities:</Text>
                <View style={styles.activitiesList}>
                  {entry.activities.map((activity, index) => (
                    <View key={index} style={styles.activityTag}>
                      <Text style={styles.activityText}>
                        {activity.name}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
            
            {entry.notes && (
              <Text style={styles.notes}>Notes: {entry.notes}</Text>
            )}
            
            <Text style={styles.date}>
              {new Date(entry.date).toLocaleString()}
            </Text>
          </View>
        ))}
      </ScrollView>
    );
  }
  
  const styles = StyleSheet.create({
    moodValue: {
      color: colors.text,
      fontSize: 18,
      fontWeight: 'bold',
      marginBottom: 8,
    },
    activitiesContainer: {
      marginTop: 8,
      marginBottom: 8,
    },
    sectionTitle: {
      color: colors.text,
      fontSize: 14,
      marginBottom: 4,
      opacity: 0.8,
    },
    activitiesList: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      marginTop: 4,
      gap: 8,
    },
    activityTag: {
      backgroundColor: 'rgba(255, 255, 255, 0.1)',
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: 'rgba(255, 255, 255, 0.2)',
    },
    activityText: {
      color: colors.text,
      fontSize: 12,
    },
    notes: {
      color: colors.text,
      marginTop: 8,
      fontStyle: 'italic',
    },
    date: {
      color: colors.text,
      fontSize: 12,
      marginTop: 8,
      opacity: 0.7,
    },
  });