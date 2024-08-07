// migrations.ts
import { createInitialSchema, initializeSettingsTable, seedActivitiesV1 } from '@/databases/database';
import { initialActivities } from '@/components/seedData';
import { SQLiteDatabase } from 'expo-sqlite';

type Migration = {
    version: number;
    up: (db: SQLiteDatabase) => Promise<void>;
};

async function updateV1ActivitiesToV2(db: SQLiteDatabase): Promise<void> {
    const updates = initialActivities.map(activity => 
        db.runAsync(
            `UPDATE activities 
             SET icon_family = ?, icon_name = ? 
             WHERE name = ? AND group_id = ?`,
            [activity.icon_family, activity.icon_name, activity.name, activity.group_id]
        )
    );
    
    await Promise.all(updates);
}
// List of all migrations
export const migrations: Migration[] = [
    {
        version: 1,
        up: async (db: SQLiteDatabase) => {
            await createInitialSchema(db);
            await seedActivitiesV1(db);
            await initializeSettingsTable(db);
        }
    },
    { // Adding icon name and icon_family to activity... Doing it sneakily and just droppping (usually you would replace etc!!) because nobody has our app yet.
        version: 2,
        up: async (db: SQLiteDatabase) => {
            await db.execAsync(`
                -- Drop old icon_name and add new columns
                ALTER TABLE activities DROP COLUMN icon_name;
                ALTER TABLE activities ADD COLUMN icon_family TEXT DEFAULT 'Feather';
                ALTER TABLE activities ADD COLUMN icon_name TEXT DEFAULT 'circle';
            `);

            await updateV1ActivitiesToV2(db);
            console.log("V2 migrated");
        }
    },
    { 
        version: 3,
        up: async (db: SQLiteDatabase) => {
            // Add show_mood_benchmarks setting with default value of true
            await db.runAsync(`
                INSERT OR IGNORE INTO user_settings (key, value) 
                VALUES ('show_mood_benchmarks', 'true')
            `);
        }
    }

    // To add a new migration: create a new entry with the next version number.
    // All schema changes should go here, NOT in database.ts.
];

export async function runMigrations(db: SQLiteDatabase): Promise<void> {
    const result = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    const currentVersion = result?.user_version ?? 0;
    
    console.log(`Current database version: ${currentVersion}`);
    
    const pendingMigrations = migrations.filter(m => m.version > currentVersion);
    
    if (pendingMigrations.length === 0) {
        console.log('Database is up to date');
        return;
    }
    
    try {
        await db.withTransactionAsync(async () => {
            for (const migration of pendingMigrations) {
                console.log(`Running migration to version ${migration.version}...`);
                await migration.up(db);
                await db.runAsync(`PRAGMA user_version = ${migration.version}`);
            }
        });
        
        console.log('Migrations completed successfully');
    } catch (error) {
        console.error('Error running migrations:', error);
        throw error;
    }
}