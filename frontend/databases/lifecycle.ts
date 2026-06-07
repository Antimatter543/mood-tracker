import { SQLiteDatabase } from 'expo-sqlite';
import { initialActivities, initialActivityGroups } from '@/components/seedData';
import { DatabaseResult } from '@/components/types';
import { runMigrations } from '@/databases/migrations';

/**
 * Database schema lifecycle: version, initial schema, V1 seed, and the
 * two top-level operations callers reach for — `initializeDatabase` and
 * `resetDatabase`.
 *
 * Schema changes belong in `migrations.ts`. The V1 helpers
 * (`createInitialSchema`, `seedActivitiesV1`) are frozen — do not edit.
 */
export const DATABASE_VERSION = 5;

// Schema version log:
//   1: initial schema
//   2: activity icon_family + icon_name (icon_name semantics changed)
//   3: added show_mood_benchmarks setting
//   4: seeded daily-reminder settings (reminder_enabled, reminder_time)
//   5: rebuilt entry_media with created_at + index (media attachments)

/**
 * Entry point called once on app startup.
 *
 * Enables foreign keys (a per-connection PRAGMA, not persisted) then runs
 * any pending migrations.
 */
export async function initializeDatabase(db: SQLiteDatabase): Promise<void> {
  try {
    // PRAGMA foreign_keys is per-connection in SQLite; must be set every
    // time we open the DB. It also cannot be changed inside a transaction.
    await db.execAsync('PRAGMA foreign_keys = ON;');
    await runMigrations(db);
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  }
}

/**
 * V1 schema. FROZEN — do not edit. Any schema changes must go through a
 * new migration in `migrations.ts`.
 */
export async function createInitialSchema(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS activity_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS activities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        group_id INTEGER NOT NULL,
        icon_name TEXT,
        position INTEGER NOT NULL DEFAULT 0,
        UNIQUE(name, group_id),
        FOREIGN KEY(group_id) REFERENCES activity_groups(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mood REAL NOT NULL,
        notes TEXT,
        date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS entry_media (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_id INTEGER NOT NULL,
        file_path TEXT NOT NULL,
        media_type TEXT NOT NULL,
        FOREIGN KEY(entry_id) REFERENCES entries(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS entry_activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id INTEGER NOT NULL,
      activity_id INTEGER NOT NULL,
      FOREIGN KEY(entry_id) REFERENCES entries(id) ON DELETE CASCADE,
      FOREIGN KEY(activity_id) REFERENCES activities(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date);
    CREATE INDEX IF NOT EXISTS idx_entry_activities_entry_id ON entry_activities(entry_id);
    CREATE INDEX IF NOT EXISTS idx_activities_group_id ON activities(group_id);
  `);
}

/**
 * V1 seed data. FROZEN — do not edit.
 */
export async function seedActivitiesV1(db: SQLiteDatabase): Promise<DatabaseResult> {
  try {
    for (const group of initialActivityGroups) {
      await db.runAsync(
        `INSERT OR IGNORE INTO activity_groups (name) VALUES (?)`,
        [group.name]
      );
    }

    const groupedActivities = initialActivities.reduce((acc, activity) => {
      if (!acc[activity.group_id]) {
        acc[activity.group_id] = [];
      }
      acc[activity.group_id].push(activity);
      return acc;
    }, {} as Record<number, typeof initialActivities>);

    for (const groupId in groupedActivities) {
      const activities = groupedActivities[groupId];
      for (let i = 0; i < activities.length; i++) {
        const activity = activities[i];
        await db.runAsync(
          `INSERT OR IGNORE INTO activities (name, group_id, icon_name, position)
           VALUES (?, ?, ?, ?)`,
          [activity.name, activity.group_id, activity.icon_name, i + 1]
        );
      }
    }

    return {
      success: true,
      message: 'Successfully seeded activities',
    };
  } catch (error) {
    console.error('Error seeding activities:', error);
    return {
      success: false,
      message: `Error seeding activities: ${error}`,
    };
  }
}

/**
 * Drops every app table and re-runs all migrations from V0.
 *
 * IMPORTANT: `PRAGMA foreign_keys` cannot be toggled inside a transaction
 * in SQLite — the PRAGMA is silently a no-op there. So we toggle FK
 * enforcement *outside* the transaction, then drop+remigrate inside the
 * transaction, then turn FKs back on.
 *
 * If the transaction throws, we still want to re-enable FKs (otherwise
 * subsequent queries on this connection would silently lose referential
 * integrity), so the re-enable lives in a `finally`.
 */
export async function resetDatabase(db: SQLiteDatabase): Promise<DatabaseResult> {
  try {
    // Disable FK enforcement so dropping tables in arbitrary order doesn't
    // trip cascade constraints. Outside the transaction — see fn docs.
    await db.execAsync('PRAGMA foreign_keys = OFF;');

    try {
      await db.withExclusiveTransactionAsync(async () => {
        await db.execAsync(`
          DROP TABLE IF EXISTS entry_activities;
          DROP TABLE IF EXISTS entry_media;
          DROP TABLE IF EXISTS entries;
          DROP TABLE IF EXISTS activities;
          DROP TABLE IF EXISTS activity_groups;
          DROP TABLE IF EXISTS user_settings;
        `);

        // Reset the version to 0 so migrations will run again
        await db.execAsync('PRAGMA user_version = 0');

        await runMigrations(db);
      });
    } finally {
      // Always restore FK enforcement, even if the transaction threw.
      await db.execAsync('PRAGMA foreign_keys = ON;');
    }

    return {
      success: true,
      message: 'Database reset successfully',
    };
  } catch (error) {
    return {
      success: false,
      message: `Error resetting database: ${error}`,
    };
  }
}
