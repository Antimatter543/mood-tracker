import { SQLiteDatabase } from 'expo-sqlite';
import { SETTINGS_REGISTRY, SettingKey } from '@/databases/settings';

/**
 * DB-level operations for the `user_settings` table.
 *
 * NOTE: `databases/settings.ts` is the *registry* (typed config of which
 * keys exist, their defaults, UI metadata). This file is the *DB ops*
 * (create the table, read/write rows). Two files on purpose so the
 * registry can be imported by UI code without pulling in SQLite.
 */

/**
 * Create the user_settings table if it doesn't exist and seed the legacy
 * V1 defaults. New settings should be added via migrations, not by
 * extending the seed list here.
 */
export async function initializeSettingsTable(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS user_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Insert default settings if they don't exist. These are the V1 defaults;
  // settings added in later versions are seeded by their own migration.
  await db.runAsync(`
    INSERT OR IGNORE INTO user_settings (key, value) VALUES
    ('fab_position', 'right'),
    ('theme_mode', 'dark'),
    ('mood_precision', 'low');
  `);
}

/**
 * Look up a setting by key. Falls back to the registry default if the key
 * is not in the table (or has never been written).
 *
 * Returns an empty string if the key is unknown to the registry — callers
 * should generally only pass `SettingKey` values, but we accept `string`
 * here so legacy / migration code can probe arbitrary keys.
 */
export async function getSetting(db: SQLiteDatabase, key: string): Promise<string> {
  const result = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM user_settings WHERE key = ?',
    [key]
  );
  return result?.value ?? SETTINGS_REGISTRY[key as SettingKey]?.default?.toString() ?? '';
}

/**
 * Upsert a setting value. Always writes the string representation.
 */
export async function updateSetting(
  db: SQLiteDatabase,
  key: string,
  value: string
): Promise<void> {
  await db.runAsync(
    'INSERT OR REPLACE INTO user_settings (key, value) VALUES (?, ?)',
    [key, value]
  );
}
