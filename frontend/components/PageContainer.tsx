// components/Layout.tsx
import { ScrollView, View, ViewProps } from "react-native";
import { LinearGradient } from 'expo-linear-gradient';
import { globalStyles, colors } from '../styles/global';
import {SQLiteProvider, type SQLiteDatabase } from "expo-sqlite";

type LayoutProps = {
    children: React.ReactNode;
    contentStyle?: ViewProps['style']; // Add a prop for the content container's style
} & ViewProps;

export function Layout({ children, style, contentStyle, ...props }: LayoutProps) {
    return (
        <View style={[globalStyles.container, style]} {...props}>
            <LinearGradient
                colors={colors.background}
                style={globalStyles.gradient}
                start={{ x: 0.5, y: 0 }}
                end={{ x: 0.7, y: 1 }}
            >

                <View style={[globalStyles.contentContainer, contentStyle]}>
                    <SQLiteProvider databaseName='moodTracker.db' onInit={migrateDbIfNeeded} >  
                    <ScrollView
                        contentContainerStyle={[
                            { padding: 16, flexGrow: 1 }, // Ensure content can grow and scroll
                            contentStyle,
                        ]}
                        showsVerticalScrollIndicator={false} // Optional: hide scroll indicator for aesthetics
                        style={{ height: '100%' }} // Set the height to 100% of the screen
                    >
                        {children}
                    </ScrollView>
                    </SQLiteProvider>
                </View>

                
                <View style={{ height: 20 }} /> {/* Add some bottom padding, contingent on Scrollview style height for reasons known only to god */}
                
            </LinearGradient>
        </View>
    );
}
async function migrateDbIfNeeded(db: SQLiteDatabase) {
    const DATABASE_VERSION = 1;

    const result = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    const currentDbVersion = result?.user_version ?? 0;

    if (currentDbVersion >= DATABASE_VERSION) {
        return;
    }

    console.log(`Migrating database from version ${currentDbVersion} to ${DATABASE_VERSION}...`);

    if (currentDbVersion === 0) {
        // New schema setup
        await db.execAsync(`
            PRAGMA journal_mode = 'wal';

            -- Activities table with new group and icon_path columns
            CREATE TABLE IF NOT EXISTS activities (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                "group" TEXT NOT NULL,
                icon_path TEXT,
                UNIQUE(name, "group")
            );

            -- Entries table (modified to remove activity_id since we'll use a junction table)
            CREATE TABLE IF NOT EXISTS entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                mood REAL NOT NULL,
                notes TEXT,
                image_path TEXT,
                date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- New junction table for many-to-many relationship between entries and activities
            CREATE TABLE IF NOT EXISTS entry_activities (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                entry_id INTEGER NOT NULL,
                activity_id INTEGER NOT NULL,
                FOREIGN KEY(entry_id) REFERENCES entries(id) ON DELETE CASCADE,
                FOREIGN KEY(activity_id) REFERENCES activities(id) ON DELETE CASCADE
            );

            -- Create indexes for better query performance
            CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date);
            CREATE INDEX IF NOT EXISTS idx_entry_activities_entry_id ON entry_activities(entry_id);
            CREATE INDEX IF NOT EXISTS idx_activities_group ON activities("group");
        `);
    }

    await db.execAsync(`PRAGMA user_version = ${DATABASE_VERSION}`);
    console.log('Database migration complete.');
}