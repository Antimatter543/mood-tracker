import { Tabs } from "expo-router";

import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { useCallback, useMemo, useEffect, useRef } from "react";
import { AppState, AppStateStatus, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as SystemUI from "expo-system-ui";
import { DataProvider } from "../../context/DataContext";
import { bumpDataVersion } from "../../context/dataRefreshStore";
import { useThemeColors } from "@/styles/global";
import { SettingsProvider, useSettings } from "@/context/SettingsContext";
import { initializeDatabase } from "@/databases/database";
import { DATABASE_NAME } from "@/databases/writeTransaction";
import { SQLiteProvider, useSQLiteContext } from "expo-sqlite";
import { localDateString, startOfLocalDay } from "@/databases/dateHelpers";
import { RECENT_ENTRY_DATES } from "@/components/visualisations/queries";
import { currentStreak } from "@/components/visualisations/transforms/streak";
import { scheduleOrSkipDailyReminder } from "@/lib/notifications";
import { OverlayProvider } from "@/context/OverlayHost";
import { buildTabBarStyle } from "@/lib/tabBarStyle";

export default function RootLayout() {
    // The app-wide "a write happened → reload" trigger. It bumps the external
    // data-version store, which every data-reading screen subscribes to via
    // useDataRefresh. (We deliberately do NOT keep a `refreshCount` in React
    // state here: handing that down through DataContext did NOT reach the
    // bottom-tab screens for in-place updates — device-proven, see
    // context/dataRefreshStore.ts. The store's imperative notify does.)
    const refetchEntries = useCallback(() => {
        bumpDataVersion();
    }, []);


    return (
        <SQLiteProvider databaseName={DATABASE_NAME} onInit={initializeDatabase}>
            <DataProvider value={{ refetchEntries }}>
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
            // Raw instants (RECENT_ENTRY_DATES no longer day-buckets in SQL) ->
            // map to LOCAL day strings + de-dupe in JS, so the streak/reminder
            // logic keys days the same way the rest of the app does.
            const rows = await db.getAllAsync<{ date: string }>(
                RECENT_ENTRY_DATES,
                [since]
            );
            const entryDates = Array.from(new Set(rows.map(r => localDateString(r.date))));
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
    const insets = useSafeAreaInsets();

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
        // Tab bar styling — floating rounded feel, grown by the bottom safe-area
        // inset so labels/icons clear the Android nav buttons (see
        // buildTabBarStyle for the full rationale).
        tabBarStyle: buildTabBarStyle(colors, insets.bottom),
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.overlays.textSecondary,
    }), [colors, insets.bottom]);
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