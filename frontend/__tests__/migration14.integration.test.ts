/**
 * INTEGRATION test — runs the REAL migration 14 `up()` against a REAL SQLite
 * engine (Node's built-in `node:sqlite`, Node ≥ 22.5), starting from a
 * `user_settings` table shaped exactly like an existing user's DB the instant
 * before migration 14 runs, and asserts the legacy single daily reminder is
 * folded into the new `reminders` JSON list WITHOUT losing any state.
 *
 * Why on top of migrations.test.ts (the expo-sqlite mock suite): that mock is
 * a no-op stub — it can prove migration 14 ISSUES the right SQL strings but
 * never that `getFirstAsync` reads back real rows, that `INSERT OR IGNORE`
 * actually protects a pre-existing `reminders` row, or that the value written
 * round-trips through `lib/reminders.ts`'s own `parseReminders`. We import the
 * REAL `migrations` array and drive version 14's `up` against our own
 * node:sqlite adapter (pattern copied from migration11.integration.test.ts,
 * extended with `getFirstAsync` since migration 14 reads before it writes).
 * Skips cleanly if node:sqlite is unavailable.
 */

// migrations.ts imports these at module-eval; mock them (mirrors
// __tests__/migrations.test.ts and migration11.integration.test.ts) so
// importing the module is cheap and pulls in no native modules. Migration 14
// is driven against our OWN node:sqlite adapter below, so the expo-sqlite
// mock is never actually used to run SQL.
jest.mock('expo-sqlite');
jest.mock('@/databases/lifecycle', () => ({
  createInitialSchema: jest.fn(),
  seedActivitiesV1: jest.fn(),
}));
jest.mock('@/databases/user-settings', () => ({
  initializeSettingsTable: jest.fn(),
}));
jest.mock('@/components/seedData', () => ({
  initialActivities: [],
  initialActivityGroups: [],
}));

import { migrations } from '@/databases/migrations';
import { parseReminders, LEGACY_REMINDER_LABEL, DEFAULT_REMINDER_TIME, serializeReminders, Reminder } from '@/lib/reminders';

// Load Node's built-in SQLite; skip the whole suite if unavailable.
let DatabaseSync: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  DatabaseSync = null;
}
const describeIfSqlite = DatabaseSync ? describe : describe.skip;

// An expo-sqlite-shaped async adapter over a synchronous node:sqlite database.
// Migration 14's `up` uses BOTH getFirstAsync (to read the legacy rows) and
// runAsync (to write the reminders row), so this extends migration 11's
// adapter (which only needed runAsync/execAsync) with getFirstAsync.
function makeAdapter(db: any) {
  return {
    runAsync: async (sql: string, params: any[] = []) => {
      const r = db.prepare(sql).run(...(params ?? []));
      return { lastInsertRowId: Number(r.lastInsertRowid), changes: Number(r.changes) };
    },
    execAsync: async (sql: string) => {
      db.exec(sql);
    },
    getFirstAsync: async (sql: string, params: any[] = []) => {
      const row = db.prepare(sql).get(...(params ?? []));
      return row ?? null;
    },
  };
}

describeIfSqlite('migration 14 — legacy reminder folded into reminders list (real SQLite)', () => {
  let db: any;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    // The user_settings KV shape used by every version since migration 1 —
    // exactly what an existing user's DB looks like the instant before
    // migration 14 runs.
    db.exec(`
      CREATE TABLE user_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    db.exec(`PRAGMA user_version = 13;`);
  });

  afterEach(() => db?.close?.());

  const runMigration14 = async () => {
    const m14 = migrations.find((m) => m.version === 14)!;
    expect(m14).toBeDefined();
    await m14.up(makeAdapter(db) as any);
  };

  const setLegacy = (enabled: string, time: string) => {
    db.prepare(`INSERT INTO user_settings (key, value) VALUES ('reminder_enabled', ?)`).run(enabled);
    db.prepare(`INSERT INTO user_settings (key, value) VALUES ('reminder_time', ?)`).run(time);
  };

  const readReminders = (): Reminder[] => {
    const row = db.prepare(`SELECT value FROM user_settings WHERE key = 'reminders'`).get();
    expect(row).toBeDefined();
    // Parse with the app's OWN parseReminders, proving the app can read back
    // exactly what the migration wrote — not just that some JSON landed.
    return parseReminders(row.value);
  };

  it('an upgrading user with the reminder ON gets one enabled reminder at their time', async () => {
    setLegacy('true', '07:30');
    await runMigration14();
    const list = readReminders();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ enabled: true, time: '07:30', label: LEGACY_REMINDER_LABEL });
    expect(typeof list[0].id).toBe('string');
    expect(list[0].id.length).toBeGreaterThan(0);
  });

  it('a user who had the reminder OFF keeps their time, disabled — no state lost', async () => {
    setLegacy('false', '06:15');
    await runMigration14();
    const list = readReminders();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ enabled: false, time: '06:15', label: LEGACY_REMINDER_LABEL });
  });

  it('fresh-install shape (migration 4 defaults: reminder_enabled=false, reminder_time=20:00) yields one disabled 20:00 reminder', async () => {
    setLegacy('false', '20:00');
    await runMigration14();
    const list = readReminders();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ enabled: false, time: DEFAULT_REMINDER_TIME, label: LEGACY_REMINDER_LABEL });
  });

  it('legacy rows entirely absent — still writes exactly one disabled reminder at the default time, never crashes', async () => {
    // No reminder_enabled / reminder_time rows at all — an edge case the
    // getFirstAsync reads must tolerate (row is null/undefined).
    await expect(runMigration14()).resolves.not.toThrow();
    const list = readReminders();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ enabled: false, time: DEFAULT_REMINDER_TIME });
  });

  it('is idempotent / never clobbers a pre-existing reminders row (INSERT OR IGNORE)', async () => {
    setLegacy('true', '07:30');
    const preExisting: Reminder[] = [
      { id: 'reminder-1', label: 'Morning', time: '08:00', enabled: true },
      { id: 'reminder-2', label: 'Evening reflection', time: '20:30', enabled: false },
      { id: 'reminder-3', label: '', time: '13:00', enabled: true },
    ];
    const preExistingJson = serializeReminders(preExisting);
    db.prepare(`INSERT INTO user_settings (key, value) VALUES ('reminders', ?)`).run(preExistingJson);

    await runMigration14();

    const row = db.prepare(`SELECT value FROM user_settings WHERE key = 'reminders'`).get();
    // Byte-identical: INSERT OR IGNORE must not have touched the row at all.
    expect(row.value).toBe(preExistingJson);
  });

  it('running up() twice in a row leaves exactly one reminders row', async () => {
    setLegacy('true', '07:30');
    await runMigration14();
    await runMigration14();
    const rows = db.prepare(`SELECT value FROM user_settings WHERE key = 'reminders'`).all();
    expect(rows).toHaveLength(1);
  });

  it('never deletes the legacy reminder_enabled / reminder_time rows — they remain readable afterwards', async () => {
    setLegacy('true', '07:30');
    await runMigration14();
    const enabledRow = db.prepare(`SELECT value FROM user_settings WHERE key = 'reminder_enabled'`).get();
    const timeRow = db.prepare(`SELECT value FROM user_settings WHERE key = 'reminder_time'`).get();
    expect(enabledRow).toBeDefined();
    expect(enabledRow.value).toBe('true');
    expect(timeRow).toBeDefined();
    expect(timeRow.value).toBe('07:30');
  });
});
