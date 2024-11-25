import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { globalStyles, colors } from '../../styles/global';
import { Layout } from '../../components/PageContainer';
import { SQLiteProvider, useSQLiteContext } from 'expo-sqlite';
import { EntriesView } from '@/components/EntriesView';
import { useEffect, useState } from 'react';

export default function Home() {
  return (
    <Layout contentStyle={{
        justifyContent: "flex-start", // Custom justification
    }}>
        <SQLiteProvider databaseName='myDatabase.db' >

          <View style={globalStyles.card}>
            <Text style={globalStyles.title}>Mood Trackersss</Text>
            {/* Your mood tracking content will go here */}
          </View>
          
          <View style={globalStyles.card}>
            <Text style={globalStyles.title}>Mood Tracker</Text>
            {/* Your mood tracking content will go here */}
            <Text>Hello</Text>
            <Test />
          </View>
          </SQLiteProvider>

    </Layout>
  );
}

type Entry = {
    id: number;
    mood: number;
    notes: string;
    date: string;
};
export function Test() {
    const db = useSQLiteContext();
    const [entries, setEntries] = useState<Entry[]>([]);
    useEffect(() => {
        async function setup() {
          const result = await db.getAllAsync<Entry>('SELECT * FROM entries');
          setEntries(result);
        }
        setup();
      }, []);
      return (
        <ScrollView>
            {entries.map(entry => (
                <View key={entry.id} style={globalStyles.card}>
                    <Text style={{color: colors.text}}>ID: {entry.id}</Text>
                    <Text style={{color: colors.text}}>Mood Value: {entry.mood}</Text>
                    <Text style={{color: colors.text}}>Notes: {entry.notes || 'No notes'}</Text>
                    <Text style={{color: colors.text}}>
                        Date: {new Date(entry.date).toLocaleString()}
                    </Text>
                </View>
            ))}
        </ScrollView>
    );
}