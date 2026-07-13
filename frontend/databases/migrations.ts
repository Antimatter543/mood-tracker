// migrations.ts
//
// Import directly from the focused modules rather than the database.ts
// facade. The facade re-exports these same symbols, but importing through
// it would create a load-order cycle (facade -> lifecycle -> migrations
// -> facade).
import { createInitialSchema, seedActivitiesV1 } from '@/databases/lifecycle';
import { initializeSettingsTable } from '@/databases/user-settings';
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
                -- Recreate activities table without old icon_name, adding new columns
                CREATE TABLE activities_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    group_id INTEGER NOT NULL,
                    icon_family TEXT DEFAULT 'Feather',
                    icon_name TEXT DEFAULT 'circle',
                    position INTEGER NOT NULL DEFAULT 0,
                    UNIQUE(name, group_id),
                    FOREIGN KEY(group_id) REFERENCES activity_groups(id) ON DELETE CASCADE
                );

                INSERT INTO activities_new (id, name, group_id, position)
                SELECT id, name, group_id, position FROM activities;

                DROP TABLE activities;

                ALTER TABLE activities_new RENAME TO activities;
            `);

            await updateV1ActivitiesToV2(db);
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
    },
    {
        // Daily-reminder notification settings. user_settings is a key-value
        // store, so seeding two rows is all that's needed — no schema change.
        // The matching SETTINGS_REGISTRY entries live in databases/settings.ts.
        version: 4,
        up: async (db: SQLiteDatabase) => {
            await db.runAsync(`
                INSERT OR IGNORE INTO user_settings (key, value)
                VALUES ('reminder_enabled', 'false')
            `);
            await db.runAsync(`
                INSERT OR IGNORE INTO user_settings (key, value)
                VALUES ('reminder_time', '20:00')
            `);
        }
    },
    {
        // Media attachments. The `entry_media` table was created back in V1
        // (createInitialSchema) but never used and never indexed. Rebuild it
        // with a `created_at` column (so photos sort in insertion order) and
        // an index on entry_id. Copy-into-new-table pattern preserves any
        // existing rows (there shouldn't be any) and never touches `entries`.
        version: 5,
        up: async (db: SQLiteDatabase) => {
            await db.execAsync(`
                ALTER TABLE entry_media RENAME TO entry_media_v1;

                CREATE TABLE entry_media (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    entry_id    INTEGER NOT NULL,
                    file_path   TEXT    NOT NULL,
                    media_type  TEXT    NOT NULL DEFAULT 'image',
                    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
                    FOREIGN KEY(entry_id) REFERENCES entries(id) ON DELETE CASCADE
                );

                INSERT INTO entry_media (id, entry_id, file_path, media_type)
                SELECT id, entry_id, file_path, media_type FROM entry_media_v1;

                DROP TABLE entry_media_v1;

                CREATE INDEX IF NOT EXISTS idx_entry_media_entry_id
                    ON entry_media(entry_id);
            `);
        }
    },
    {
        // Clarify the vague default Social activity. This touches only the
        // original seed value and leaves user-renamed/custom activities alone.
        version: 6,
        up: async (db: SQLiteDatabase) => {
            await db.runAsync(
                `UPDATE activities
                 SET name = ?
                 WHERE name = ?
                   AND group_id = ?
                   AND NOT EXISTS (
                     SELECT 1
                     FROM activities
                     WHERE name = ?
                       AND group_id = ?
                   )`,
                ['Social event', 'Event', 3, 'Social event', 3]
            );
        }
    },
    {
        // Health Connect (Android, opt-in): on-device store of daily sleep +
        // heart-rate metrics. Keyed by LOCAL calendar day (YYYY-MM-DD) so a
        // future insights JOIN with the mood `entries` (day-keyed in JS via
        // localDateString) is a trivial date match — no timezone math at read
        // time. 100% on-device: this data never leaves the phone. `sleep_stages`
        // is a JSON map of {numericStageType: minutes}. Also seeds the opt-in
        // flag OFF (opt-in only; the section never syncs until the user connects).
        version: 7,
        up: async (db: SQLiteDatabase) => {
            await db.execAsync(`
                CREATE TABLE IF NOT EXISTS health_metrics (
                    date                TEXT PRIMARY KEY,
                    sleep_total_minutes REAL,
                    sleep_stages        TEXT,
                    avg_heart_rate      REAL,
                    min_heart_rate      REAL,
                    source              TEXT NOT NULL DEFAULT 'health_connect',
                    synced_at           TEXT NOT NULL
                );
            `);
            await db.runAsync(`
                INSERT OR IGNORE INTO user_settings (key, value)
                VALUES ('health_connect_opt_in', 'false')
            `);
        }
    },
    {
        // HRV analytics: add a nullable avg_hrv_millis column to health_metrics
        // (mean RMSSD in ms per local day). HRV is OPTIONAL — many sources never
        // emit it — so the column stays NULL until data appears. This single
        // ALTER is the sole path for BOTH fresh installs (migration 7 creates the
        // table without HRV, then this adds the column) and existing users. Do
        // NOT also add the column to migration 7's CREATE TABLE — that would make
        // a fresh install create-then-ALTER the same column ("duplicate column").
        version: 8,
        up: async (db: SQLiteDatabase) => {
            await db.runAsync(
                `ALTER TABLE health_metrics ADD COLUMN avg_hrv_millis REAL`
            );
        }
    },
    {
        // Dedicated resting-heart-rate analytics: add a nullable
        // resting_heart_rate column to health_metrics (mean of the day's
        // dedicated RestingHeartRate readings — sources like Fitbit write one
        // ~daily but NO intraday HeartRate, so their avg/resting HR used to
        // collapse to a single sample). Distinct from min_heart_rate (the
        // intraday-min proxy, kept as the fallback). Nullable/optional — stays
        // NULL until such a reading appears. Like migration 8, this single ALTER
        // is the SOLE path for BOTH fresh installs (migration 7 creates the table
        // without this column, then this adds it) and existing users. Do NOT also
        // add it to migration 7's CREATE TABLE — that would make a fresh install
        // create-then-ALTER the same column ("duplicate column").
        version: 9,
        up: async (db: SQLiteDatabase) => {
            await db.runAsync(
                `ALTER TABLE health_metrics ADD COLUMN resting_heart_rate REAL`
            );
        }
    }

    // To add a new migration: create a new entry with the next version number.
    // All schema changes should go here, NOT in database.ts.
];

export async function runMigrations(db: SQLiteDatabase): Promise<void> {
    const result = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    const currentVersion = result?.user_version ?? 0;

    const pendingMigrations = migrations.filter(m => m.version > currentVersion);

    if (pendingMigrations.length === 0) {
        return;
    }

    try {
        await db.withTransactionAsync(async () => {
            for (const migration of pendingMigrations) {
                await migration.up(db);
                await db.runAsync(`PRAGMA user_version = ${migration.version}`);
            }
        });
    } catch (error) {
        console.error('Error running migrations:', error);
        throw error;
    }
}
