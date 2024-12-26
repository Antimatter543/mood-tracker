import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { globalStyles, colors } from '../../styles/global';
import { Layout } from '../../components/PageContainer';
import { SQLiteProvider, useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { MoodItem } from './entry';
import { DatabaseViewer } from '@/components/DBViewer';


export default function Home() {
  return (
    <Layout contentStyle={{
      justifyContent: 'flex-start',
      paddingTop: 0, // Remove top padding ('safe zone area, looks ugly when scrolling down)
      paddingBottom: 0,
      borderColor: '#fff',
      borderRadius: '30px',
      flex: 1,
      width: '100%',
      paddingHorizontal: 16, // Add horizontal padding
  }}>

      <View style={globalStyles.card}>
        <Text style={globalStyles.title}>Mood Tracker</Text>
        <Text style={{color: colors.text}}>Hello</Text>
      </View>
      <DatabaseViewer />

  </Layout>
  );
}
