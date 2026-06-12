import { Tabs } from "expo-router";

import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { useCallback, useState, useMemo, useEffect, useRef } from "react";
import { AppState, AppStateStatus, View } from "react-native";
import * as SystemUI from "expo-system-ui";
import { DataProvider } from "../../context/DataContext";
import { useThemeColors } from "@/styles/global";
import { SettingsProvider, useSettings } from "@/context/SettingsContext";
import { initializeDatabase } from "@/databases/database";
import { SQLiteProvider, useSQLiteContext } from "expo-sqlite";
import { localDateString, startOfLocalDay } from "@/databases/dateHelpers";
import { currentStreak } from "@/components/visualisations/transforms/streak";
import { scheduleOrSkipDailyReminder } from "@/lib/notifications";
import { OverlayProvider } from "@/context/OverlayHost";

export default function RootLayout() {
    const [refreshCount, setRefreshCount] = useState(0);

    // Create our refetch function so we can refresh states whenever our db changes/adds or edits new entries
    const refetchEntries = useCallback(() => {
        setRefreshCount(prev => prev + 1)
    }, []);


    return (
        <SQLiteProvider databaseName='moodTracker.db' onInit={initializeDatabase}>
            <DataProvider value={{ refetchEntries, refreshCount }}>
                <SettingsProvider>
                    {/* OverlayProvider hosts our in-tree native-<Modal> replacement.
                        It MUST sit inside SQLite/Data/Settings so the overlays it
                        mounts (entry form, settings dropdown) can read those
                        contexts, and its overlay slots render after <Tabs> so they
                        paint above the floating tab bar. See context/OverlayHost.tsx. */}
                    <OverlayProvider>
                        <NotificationReArm />
                        <TabNavigator />
                    </OverlayProvider>
                </SettingsProvider>
            </DataProvider>
        </SQLiteProvider>
    );
}

/**
 * Renders nothing — holds the daily-reminder re-arm effect. Lives inside the
 * SettingsProvider + SQLiteProvider tree so it can read settings + query the DB.
 *
 * Re-arms on mount (cold boot / navigation return) and on every transition to
 * the foreground, because the OS can silently drop scheduled notifications.
 * Notifications are non-critical, so all errors are caught and never crash.
 */
function NotificationReArm() {
    const db = useSQLiteContext();
    const { settings } = useSettings();
    const appState = useRef(AppState.currentState);

    const reArm = useCallback(async () => {
        try {
            const todayKey = localDateString(new Date());
            // Recent entry dates (last 90 days is plenty for streak accuracy).
            const since = startOfLocalDay(
                new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
            );
            const rows = await db.getAllAsync<{ date: string }>(
                `SELECT DISTINCT date(date) as date FROM entries WHERE date >= ? ORDER BY date DESC`,
                [since]
            );
            const entryDates = rows.map(r => r.date);
            const streak = currentStreak(entryDates, todayKey);

            await scheduleOrSkipDailyReminder({
                enabled: settings.reminder_enabled,
                reminderTime: settings.reminder_time,
                currentStreak: streak,
                todayKey,
                entryDates,
            });
        } catch (e) {
            // Notifications are non-critical; never crash the app.
            console.warn('[notifications] re-arm failed:', e);
        }
    }, [db, settings.reminder_enabled, settings.reminder_time]);

    useEffect(() => {
        // Re-arm on mount.
        reArm();

        // Re-arm whenever the app comes to the foreground.
        const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
            if (appState.current.match(/inactive|background/) && state === 'active') {
                reArm();
            }
            appState.current = state;
        });
        return () => sub.remove();
    }, [reArm]);

    return null;
}

function TabNavigator() {
    const colors = useThemeColors(); // Now this will work because it's inside SettingsProvider

    // Paint the native window root background to the theme background. Without
    // this, Android's default window background (white) peeks through around the
    // floating, rounded-top tab bar (its corner radii + the safe-area strip
    // below it), framing the nav bar in white on dark/coloured themes. Reactive
    // to theme changes so it always matches the active palette.
    useEffect(() => {
        SystemUI.setBackgroundColorAsync(colors.background).catch(() => {
            // Cosmetic only — never crash if the native module is unavailable.
        });
    }, [colors.background]);

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
        // Style of the view wrapping each tab's screen content — paint it the
        // theme background so no white shows around the floating tab bar or under
        // short screens. NOTE: react-navigation v7 (embedded in expo-router v6 /
        // SDK 56) RENAMED this option from `sceneContainerStyle` to `sceneStyle`
        // (see node_modules/expo-router/.../bottom-tabs/types.d.ts). The old name
        // was silently dead after the SDK-56 upgrade, which is what let Android's
        // default white window peek through the tab bar's rounded corners.
        sceneStyle: {
            backgroundColor: colors.background,
        },
        // Tab bar styling — floating rounded feel
        tabBarStyle: {
            backgroundColor: colors.secondaryBackground,
            borderTopWidth: 0,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            paddingBottom: 8,
            paddingTop: 4,
            height: 64,
            // Shadow above the tab bar
            shadowColor: '#000000',
            shadowOffset: { width: 0, height: -2 },
            shadowOpacity: colors.isDark ? 0.3 : 0.08,
            shadowRadius: 8,
            elevation: 8,
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.overlays.textSecondary,
    }), [colors]);
    return (
        // Belt-and-braces with sceneStyle + SystemUI: a flex:1 themed backdrop
        // behind the whole navigator guarantees the area framing the floating,
        // rounded-top tab bar is the theme background on every theme, never the
        // default white window.
        <View style={{ flex: 1, backgroundColor: colors.background }}>
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
            <Tabs.Screen name="timeline" options={{
                title: 'Timeline',
                headerTitleAlign: 'center',

                tabBarIcon: ({ color, focused }) => (
                    <MaterialCommunityIcons name={focused ? 'timeline-text' : 'timeline-text-outline'} color={color} size={30} />
                ),
                // headerShown: false,
            }} />

            <Tabs.Screen name="insights" options={{
                title: 'Insights',
                headerTitleAlign: 'center',
                tabBarIcon: ({ color, focused }) => (
                    <Ionicons name={focused ? 'bulb' : 'bulb-outline'} color={color} size={28} />
                ),
            }} />

            <Tabs.Screen name="settings" options={{
                title: 'Settings',
                tabBarIcon: ({ color, focused }) => (
                    <Ionicons name={focused ? 'settings-sharp' : 'settings-outline'} color={color} size={30} />
                ),
                headerShown: false,

            }} />
        </Tabs>
        </View>
    )

}