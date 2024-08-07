import { Tabs } from "expo-router";

import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { useCallback, useState, useMemo } from "react";
import { DataProvider } from "../../context/DataContext";
import { useThemeColors } from "@/styles/global";
import { SettingsProvider } from "@/context/SettingsContext";
import { initializeDatabase } from "@/databases/database";
import { SQLiteProvider } from "expo-sqlite";

export default function RootLayout() {
    const colors = useThemeColors();
    const [refreshCount, setRefreshCount] = useState(0);

    // Create our refetch function so we can refresh states whenever our db changes/adds or edits new entries
    const refetchEntries = useCallback(() => {
        setRefreshCount(prev => prev + 1)
    }, []);


    return (
        <SQLiteProvider databaseName='moodTracker.db' onInit={initializeDatabase}>
            <DataProvider value={{ refetchEntries, refreshCount }}>
                <SettingsProvider>
                    <TabNavigator />
                </SettingsProvider>
            </DataProvider>
        </SQLiteProvider>
    );
}

function TabNavigator() {
    const colors = useThemeColors(); // Now this will work because it's inside SettingsProvider

    // Memoize the screen options to prevent unnecessary re-renders
    const screenOptions = useMemo(() => ({
        // Header styling
        headerStyle: {
            backgroundColor: colors.secondaryBackground,

        },
        headerShadowVisible: false,
        headerTintColor: colors.text,
        headerTitleStyle: {
            color: colors.text,

            
        },
        // Tab bar styling
        tabBarStyle: {
            backgroundColor: colors.secondaryBackground,
            borderTopWidth: 0,
            elevation: 0,
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.overlays.textSecondary,
    }), [colors]);
    return (

        <Tabs screenOptions={screenOptions}>
            <Tabs.Screen name="index" options={{
                title: 'Home',
                headerTitleAlign: 'center',
                tabBarIcon: ({ color, focused }) => (
                    <Ionicons name={focused ? 'home-sharp' : 'home-outline'} color={color} size={30} />
                ),
                // headerShown: false,


            }}
            />

            <Tabs.Screen name="stats" options={{
                title: 'Statistics',
                headerTitleAlign: 'center',
                tabBarIcon: ({ color, focused }) => (
                    <Ionicons name={focused ? 'stats-chart' : 'stats-chart-outline'} color={color} size={24} />),
                // headerShown: false,
            }} />
            {/* <Tabs.Screen name="entry" options={{
                title: 'Entry',
                tabBarIcon: ({ color, focused }) => (
                    <Ionicons name={focused ? 'information-circle' : 'information-circle-outline'} color={color} size={24} />),
                headerShown: false,
                }} /> */}
            <Tabs.Screen name="timeline" options={{
                title: 'Timeline',
                headerTitleAlign: 'center',

                tabBarIcon: ({ color, focused }) => (
                    <MaterialCommunityIcons name={focused ? 'timeline-text' : 'timeline-text-outline'} color={color} size={30} />
                ),
                // headerShown: false,
            }} />

            <Tabs.Screen name="social" options={{
                title: 'Social',
                headerTitleAlign: 'center',

                tabBarIcon: ({ color, focused }) => (
                    <MaterialIcons name={focused ? 'mood' : 'mood'} color={color} size={30} />
                ),
                // headerShown: false,

            }} />

            <Tabs.Screen name="settings" options={{
                title: 'Settings',
                tabBarIcon: ({ color, focused }) => (
                    <Ionicons name={focused ? 'settings-sharp' : 'settings-outline'} color={color} size={30} />
                ),
                headerShown: false,

            }} />
        </Tabs>
    )

}