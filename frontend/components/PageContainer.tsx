// components/Layout.tsx
import { View, ViewProps } from "react-native";
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
                    <SQLiteProvider databaseName='myDatabase.db' >  
                        {/* /* Allow useSqlLiteContext for any children basically*/}
                        {children}
                    </SQLiteProvider>
                </View>
                
            </LinearGradient>
        </View>
    );
}

async function migrateDbIfNeeded(db: SQLiteDatabase) {
    const DATABASE_VERSION = 1; // Update this whenever you add a new migration

    // Check the current database version
    const result = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    const currentDbVersion = result?.user_version ?? 0; // Use 0 as default if result is null

    if (currentDbVersion >= DATABASE_VERSION) {
        return; // Schema is already up-to-date
    }

    console.log(`Migrating database from version ${currentDbVersion} to ${DATABASE_VERSION}...`);

    if (currentDbVersion === 0) {
        // Initial schema setup
        await db.execAsync(`
            PRAGMA journal_mode = 'wal'; -- Enable Write-Ahead Logging
            CREATE TABLE IF NOT EXISTS activities (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE
            );
            CREATE TABLE IF NOT EXISTS entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                mood REAL NOT NULL,
                activity_id INTEGER,
                notes TEXT,
                image_path TEXT,
                date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (activity_id) REFERENCES activities (id)
            );
        `);
    }

    // Future migrations can go here
    // Example:
    // if (currentDbVersion === 1) {
    //     await db.execAsync(`
    //         ALTER TABLE entries ADD COLUMN new_column_name TEXT;
    //     `);
    // }

    // Update the database version
    await db.execAsync(`PRAGMA user_version = ${DATABASE_VERSION}`);
    console.log('Database migration complete.');
}

