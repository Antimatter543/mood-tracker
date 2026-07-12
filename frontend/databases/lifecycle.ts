import { SQLiteDatabase } from 'expo-sqlite';
import { initialActivities, initialActivityGroups } from '@/components/seedData';
import { DatabaseResult } from '@/components/types';
import { runMigrations } from '@/databases/migrations';
import { withWriteLock } from '@/databases/writeTransaction';

/**
 * Database schema lifecycle: version, initial schema, V1 seed, and the
 * two top-level operations callers reach for — `initializeDatabase` and
 * `resetDatabase`.
 *
 * Schema changes belong in `migrations.ts`. The V1 helpers
 * (`createInitialSchema`, `seedActivitiesV1`) are frozen — do not edit.
 */
export const DATABASE_VERSION = 7;

// Schema version log:
//   1: initial schema
//   2: activity icon_family + icon_name (icon_name semantics changed)
//   3: added show_mood_benchmarks setting
//   4: seeded daily-reminder settings (reminder_enabled, reminder_time)
//   5: rebuilt entry_media with created_at + index (media attachments)
//   6: renamed vague default Social activity "Event" -> "Social event"
//   7: health_metrics table + health_connect_opt_in setting (Health Connect,
//      on-device daily sleep/HR, Android opt-in — Phase 2a)

/**
 * Entry point called once on app startup, on the SQLiteProvider's READ
 * connection.
 *
 * PRAGMAs, in order:
 *   - `journal_mode = WAL` — PERSISTED in the database file (not per-connection).
 *     There are now genuinely TWO connections open on this file (this read
 *     connection + the singleton write connection in writeTransaction.ts), and
 *     WAL is what lets them run concurrently: readers never block the writer and
 *     the writer never blocks readers. Setting it once here persists it for the
 *     write connection too.
 *   - `busy_timeout = 5000` — per-connection; makes this reader wait-and-retry
 *     (up to 5s) instead of erroring if it ever races the write connection for a
 *     lock, rather than throwing SQLITE_BUSY.
 *   - `foreign_keys = ON` — per-connection, NOT persisted, so it must be set on
 *     every connection that needs cascades (the write connection sets its own).
 *     Also cannot be changed inside a transaction.
 * Then run any pending migrations.
 */
export async function initializeDatabase(db: SQLiteDatabase): Promise<void> {
  try {
    await db.execAsync('PRAGMA journal_mode = WAL;');
    await db.execAsync('PRAGMA busy_timeout = 5000;');
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
 * Runs entirely on the singleton WRITE connection, holding the write mutex for
 * the whole reset (via `withWriteLock`) so no app write can interleave with a
 * half-dropped schema. The `db` (read) connection is intentionally NOT touched:
 * all writes in this app go through the write connection, and doing the reset
 * there is what makes it a real, atomic operation (the old code ran it via
 * `withExclusiveTransactionAsync`, which on this codebase executed the drops on
 * the MAIN connection outside any transaction — see writeTransaction.ts).
 *
 * Three phases, ordered deliberately:
 *   1. `foreign_keys = OFF` on the write connection, OUTSIDE any transaction
 *      (the PRAGMA is a silent no-op inside one), so dropping tables in any
 *      order can't trip a cascade constraint.
 *   2. ONE real transaction (BEGIN IMMEDIATE … COMMIT) to drop everything and
 *      reset `user_version` to 0. This is kept SEPARATE from step 3 because
 *      `runMigrations` opens its OWN transaction, and nesting BEGIN inside BEGIN
 *      is a SQLite error — so this transaction must COMMIT first.
 *   3. `runMigrations` on the SAME write connection: its inner transaction now
 *      runs un-nested and recreates the schema + seeds.
 * `foreign_keys = ON` is restored in a `finally` so a failure never leaves the
 * write connection with referential integrity silently disabled.
 */
export async function resetDatabase(_db: SQLiteDatabase): Promise<DatabaseResult> {
  try {
    await withWriteLock(async (conn) => {
      // Phase 1: FK OFF, outside any transaction.
      await conn.execAsync('PRAGMA foreign_keys = OFF;');
      try {
        // Phase 2: drop + version reset in one real transaction.
        await conn.execAsync('BEGIN IMMEDIATE;');
        try {
          await conn.execAsync(`
            DROP TABLE IF EXISTS entry_activities;
            DROP TABLE IF EXISTS entry_media;
            DROP TABLE IF EXISTS entries;
            DROP TABLE IF EXISTS activities;
            DROP TABLE IF EXISTS activity_groups;
            DROP TABLE IF EXISTS user_settings;
            DROP TABLE IF EXISTS health_metrics;
          `);
          await conn.execAsync('PRAGMA user_version = 0');
          await conn.execAsync('COMMIT;');
        } catch (txnError) {
          try {
            await conn.execAsync('ROLLBACK;');
          } catch {
            // ignore — surface the original txnError below.
          }
          throw txnError;
        }

        // Phase 3: recreate schema + seed via migrations (its own transaction,
        // now un-nested because phase 2 committed).
        await runMigrations(conn);
      } finally {
        // Always restore FK enforcement, even if a phase threw.
        await conn.execAsync('PRAGMA foreign_keys = ON;');
      }
    });

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
