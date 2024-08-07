import { resetDatabase } from "@/databases/database";
import { clearAllEntries, seedMoodEntries } from "@/components/generateData";
import { Layout } from "@/components/PageContainer";
import { useDataContext } from "@/context/DataContext";
import { useGlobalStyles, useThemeColors } from "@/styles/global";
import { SQLiteDatabase, useSQLiteContext } from "expo-sqlite";


import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import Feather from '@expo/vector-icons/Feather';



import { useMemo } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { SettingsSection } from "@/components/SettingRow";
import { runMigrations } from "@/databases/migrations";
import { DataManagementSection } from "@/components/DataManagementSection";

// Support Section
const SupportSection = () => {
    const colors = useThemeColors();
    const styles = useThemedStyles(colors);

    const handleKofiDonation = () => {
        Linking.openURL('https://ko-fi.com/antiraedus');
    };

    return (
        <View style={styles.section}>
            <View style={styles.sectionHeader}>
                <MaterialCommunityIcons name="coffee-outline" color={colors.text} size={20} />
                <Text style={styles.sectionTitle}>Support Development</Text>
            </View>

            <Text style={styles.supportMessage}>
                Thank you for using this app! If you've found it helpful in tracking your mental health journey,
                consider supporting its development. Every coffee helps keep this project going! 💙
            </Text>

            <Pressable
                style={({ pressed }) => [
                    styles.button,
                    styles.buttonSupport,
                    pressed && styles.buttonPressed
                ]}
                onPress={handleKofiDonation}
            >
                <MaterialCommunityIcons name="coffee" size={18} color="#fff" />
                <Text style={[styles.buttonText, styles.supportButtonText]}>Buy me a coffee</Text>
                <Feather name="external-link" color="#fff" size={16} style={styles.linkIcon} />
            </Pressable>
        </View>
    );
};

// Development Database Section
const DevDatabaseSection = ({
    db,
    refetchEntries
}: {
    db: SQLiteDatabase;
    refetchEntries: () => void;
}) => {
    const colors = useThemeColors();
    const styles = useThemedStyles(colors);

    if (!__DEV__) return null;

    return (
        <View style={styles.section}>
            <View style={styles.sectionHeader}>
                <MaterialIcons name="storage" color={colors.text} size={20} />
                <Text style={styles.sectionTitle}>Database Management (DEV MODE ONLY)</Text>
            </View>

            <Pressable
                style={({ pressed }) => [
                    styles.button,
                    styles.buttonPrimary,
                    pressed && styles.buttonPressed
                ]}
                onPress={async () => {
                    const result = await seedMoodEntries(db, 50);
                    console.log(result.message);
                    refetchEntries();
                }}
            >
                <Text style={styles.buttonText}>Generate 50 Sample Entries</Text>
            </Pressable>
        </View>
    );
};

// Danger Zone Section
const DangerZoneSection = ({
    db,
    refetchEntries
}: {
    db: SQLiteDatabase;
    refetchEntries: () => void;
}) => {
    const colors = useThemeColors();
    const styles = useThemedStyles(colors);

    if (!__DEV__) return null;

    return (
        <View style={[styles.section, styles.dangerSection]}>
            <View style={styles.sectionHeader}>
                <Ionicons name="warning" color="#ff4444" size={20} />
                <Text style={[styles.sectionTitle, styles.dangerText]}>Danger Zone</Text>
            </View>
            <Pressable
                style={({ pressed }) => [styles.button, styles.buttonDanger, pressed && styles.buttonPressed]}
                onPress={async () => {
                    const result = await clearAllEntries(db);
                    console.log(result.message);
                    refetchEntries();
                }}
            >
                <Text style={styles.buttonTextDanger}>Clear All Entries</Text>
            </Pressable>

            <Pressable
                style={({ pressed }) => [styles.button, styles.buttonDanger, pressed && styles.buttonPressed]}
                onPress={async () => {
                    const result = await resetDatabase(db);
                    console.log(result.message);
                    refetchEntries();
                }}
            >
                <Text style={styles.buttonTextDanger}>Reset Database</Text>
            </Pressable>


            <Pressable
                style={({ pressed }) => [styles.button, styles.buttonDanger, pressed && styles.buttonPressed]}
                onPress={async () => {
                    try {
                        await db.execAsync(`
                PRAGMA writable_schema = 1;
                DELETE FROM sqlite_master WHERE type IN ('table', 'index', 'trigger');
                PRAGMA writable_schema = 0;
                PRAGMA user_version = 0;
                VACUUM;
            `);

                        // Re-run migrations
                        await runMigrations(db);

                        // Force refresh app state
                        refetchEntries();

                        console.log('Force reset completed successfully');
                    } catch (error) {
                        console.error('Force reset error:', error);
                    }
                }}
            >
                <Text style={styles.buttonTextDanger}>Force Reset Database (DANGER)</Text>
            </Pressable>
        </View>
    );
};
function Setting() {
    const colors = useThemeColors();
    const styles = useThemedStyles(colors);
    const globalStyles = useGlobalStyles(colors);
    const db = useSQLiteContext();
    const { refetchEntries } = useDataContext();

    return (
        <View style={globalStyles.container}>
            <View style={globalStyles.header}>
                <Ionicons name="settings-outline" color={colors.text} size={24} />
                <Text style={globalStyles.headerText}>Settings</Text>
            </View>

            <SettingsSection />

            <DataManagementSection />

            {__DEV__ && <DevDatabaseSection db={db} refetchEntries={refetchEntries} />}
            <SupportSection />
            {__DEV__ && <DangerZoneSection db={db} refetchEntries={refetchEntries} />}

            <View style={styles.versionInfo}>
                <Text style={styles.versionText}>Version 1.0.0</Text>
                <Text style={styles.versionText}>© 2024 Raedus Labs. All rights reserved.</Text>
                <Text style={styles.versionText}> Have feedback? Email us at hello@raeduslabs.com! </Text>

            </View>
        </View>
    );
}


export default function SettingsPage() {
    return (
        <Layout contentStyle={{
            justifyContent: 'flex-start',
            paddingTop: 0,
            paddingBottom: 0,
        }}>
            <Setting />
        </Layout>
    );
}


// Create a hook for themed styles
const useThemedStyles = (colors: any) => {
    return useMemo(() => StyleSheet.create({
        section: {
            backgroundColor: colors.cardBackground,
            borderRadius: 16,
            padding: 16,
            marginBottom: 16,
            borderWidth: 1,
            borderColor: colors.border,
        },
        dangerSection: {
            backgroundColor: 'rgba(255, 68, 68, 0.1)',
            borderColor: 'rgba(255, 68, 68, 0.2)',
        },
        sectionHeader: {
            flexDirection: 'row',
            alignItems: 'center',
            marginBottom: 16,
        },
        sectionTitle: {
            fontSize: 18,
            fontWeight: '600',
            color: colors.text,
            marginLeft: 8,
        },
        settingRow: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingVertical: 12,
            paddingHorizontal: 16,
            backgroundColor: colors.overlays.tag,
            borderRadius: 8,
        },
        settingText: {
            color: colors.text,
            fontSize: 16,
        },
        dangerText: {
            color: '#ff4444',
        },
        button: {
            padding: 16,
            borderRadius: 12,
            marginBottom: 8,
            borderWidth: 1,
        },
        buttonPrimary: {
            backgroundColor: colors.accent,
            borderColor: colors.accent,
        },
        buttonDanger: {
            backgroundColor: 'transparent',
            borderColor: '#ff4444',
        },
        buttonPressed: {
            opacity: 0.8,
        },
        buttonText: {
            color: '#fff',
            fontSize: 16,
            fontWeight: '500',
            textAlign: 'center',
        },
        buttonTextDanger: {
            color: '#ff4444',
            fontSize: 16,
            fontWeight: '500',
            textAlign: 'center',
        },
        messageContainer: {
            backgroundColor: colors.overlays.tag,
            padding: 12,
            borderRadius: 8,
            marginBottom: 16,
        },
        message: {
            color: colors.text,
            textAlign: 'center',
            fontSize: 14,
        },
        versionInfo: {
            padding: 16,
            alignItems: 'center',
        },
        versionText: {
            color: colors.textSecondary,
            fontSize: 14,
        },
        buttonSupport: {
            backgroundColor: '#40A9FF',
            borderColor: '#40A9FF',
            flexDirection: 'row',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 8,
            paddingVertical: 12,
        },
        linkIcon: {
            marginLeft: 8,
        },
        supportMessage: {
            color: colors.text,
            fontSize: 14,
            lineHeight: 20,
            opacity: 0.8,
            marginBottom: 16,
            textAlign: 'center',
            paddingHorizontal: 8,
        },
        supportButtonText: {
            fontSize: 16,
            fontWeight: '600',
        },
    }), [colors]);
};