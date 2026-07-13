/**
 * INTEGRATION test — runs the REAL write-layer functions (addMoodEntry /
 * updateMoodEntry / deleteMoodEntry, via withWriteTransaction) against a REAL
 * SQLite engine (Node's built-in `node:sqlite`, Node ≥ 22.5) and asserts the
 * behaviour that mocked unit tests CANNOT prove:
 *   - atomicity: a mid-transaction failure ROLLS BACK the whole write (no
 *     orphaned entries row),
 *   - FK cascade: deleting an entry removes its entry_activities / entry_media
 *     rows — but ONLY because the write connection has `foreign_keys = ON`
 *     (the per-connection PRAGMA trap that motivated writeTransaction.ts).
 *
 * The write layer opens its connection via `openDatabaseAsync`; here we instead
 * INJECT a thin adapter over a `node:sqlite` in-memory DB as the write
 * connection (and pass it as the read `db` too), so every statement hits one
 * real engine. If the runtime lacks node:sqlite the suite skips cleanly.
 *
 * mediaHelpers file IO is mocked out (no expo-file-system): these tests exercise
 * the DB transaction semantics, not photo files.
 */
jest.mock('expo-sqlite');
jest.mock('@/databases/mediaHelpers', () => ({
  MEDIA_DIR: 'file:///media/',
  copyToMediaDir: jest.fn(async (uri: string) => `file:///media/${uri.split('/').pop()}`),
  deleteMediaFile: jest.fn().mockResolvedValue(undefined),
}));

import {
  __setWriteConnectionForTests,
  __resetWriteTransactionForTests,
} from '@/databases/writeTransaction';
import {
  addMoodEntry,
  updateMoodEntry,
  deleteMoodEntry,
} from '@/databases/entries';

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
function makeAdapter(db: any) {
  return {
    execAsync: async (sql: string) => {
      db.exec(sql);
    },
    runAsync: async (sql: string, params: any[] = []) => {
      const r = db.prepare(sql).run(...(params ?? []));
      return { lastInsertRowId: Number(r.lastInsertRowid), changes: Number(r.changes) };
    },
    getAllAsync: async (sql: string, params: any[] = []) => db.prepare(sql).all(...(params ?? [])),
    getFirstAsync: async (sql: string, params: any[] = []) =>
      db.prepare(sql).get(...(params ?? [])) ?? null,
  };
}

const SCHEMA = `
  CREATE TABLE activity_groups (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE);
  CREATE TABLE activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, group_id INTEGER NOT NULL,
    icon_family TEXT DEFAULT 'Feather', icon_name TEXT DEFAULT 'circle', position INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(group_id) REFERENCES activity_groups(id) ON DELETE CASCADE
  );
  CREATE TABLE entries (id INTEGER PRIMARY KEY AUTOINCREMENT, mood REAL NOT NULL, notes TEXT, date TIMESTAMP);
  CREATE TABLE entry_media (
    id INTEGER PRIMARY KEY AUTOINCREMENT, entry_id INTEGER NOT NULL, file_path TEXT NOT NULL,
    media_type TEXT NOT NULL DEFAULT 'image',
    FOREIGN KEY(entry_id) REFERENCES entries(id) ON DELETE CASCADE
  );
  CREATE TABLE entry_activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT, entry_id INTEGER NOT NULL, activity_id INTEGER NOT NULL,
    FOREIGN KEY(entry_id) REFERENCES entries(id) ON DELETE CASCADE,
    FOREIGN KEY(activity_id) REFERENCES activities(id) ON DELETE CASCADE
  );
`;

describeIfSqlite('write layer — real SQLite atomicity + FK cascade', () => {
  let db: any;
  let adapter: any;

  const count = (table: string): number =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    // FK ON is what makes the cascades in these tests real — the trap that
    // writeTransaction.ts sets on its own connection.
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec(SCHEMA);
    db.exec(`INSERT INTO activity_groups (id, name) VALUES (1, 'Sports');`);
    db.exec(`INSERT INTO activities (id, name, group_id) VALUES (1, 'Running', 1), (2, 'Reading', 1);`);

    adapter = makeAdapter(db);
    __resetWriteTransactionForTests();
    __setWriteConnectionForTests(adapter);
  });

  afterEach(() => {
    __resetWriteTransactionForTests();
    db?.close?.();
  });

  it('addMoodEntry commits the entry AND its activity links atomically', async () => {
    const result = await addMoodEntry(adapter, 7, [1, 2], 'good day', '2026-07-13T10:00:00.000Z');
    expect(result.success).toBe(true);
    expect(count('entries')).toBe(1);
    expect(count('entry_activities')).toBe(2);

    const row = db.prepare('SELECT mood, notes, date FROM entries').get();
    expect(row.mood).toBe(7);
    expect(row.notes).toBe('good day');
    expect(row.date).toBe('2026-07-13T10:00:00.000Z');
  });

  it('rolls the whole insert back when a statement mid-transaction fails (no orphaned entry)', async () => {
    // Force a mid-transaction failure: drop entry_activities so the link INSERT
    // throws AFTER the entries INSERT has run inside the same transaction.
    db.exec('DROP TABLE entry_activities;');

    const result = await addMoodEntry(adapter, 5, [1], 'note');

    expect(result.success).toBe(false);
    // The entries row must NOT have been committed — the transaction rolled back.
    expect(count('entries')).toBe(0);
  });

  it('deleteMoodEntry cascades to entry_activities + entry_media (FK ON)', async () => {
    await addMoodEntry(adapter, 6, [1, 2], 'with links', '2026-07-13T10:00:00.000Z');
    const entryId = (db.prepare('SELECT id FROM entries').get() as { id: number }).id;
    db.prepare(
      `INSERT INTO entry_media (entry_id, file_path, media_type) VALUES (?, ?, 'image')`
    ).run(entryId, 'file:///media/x.jpg');

    expect(count('entry_activities')).toBe(2);
    expect(count('entry_media')).toBe(1);

    const result = await deleteMoodEntry(adapter, entryId);
    expect(result.success).toBe(true);
    expect(count('entries')).toBe(0);
    // CASCADE removed the child rows — proves FK enforcement on the write conn.
    expect(count('entry_activities')).toBe(0);
    expect(count('entry_media')).toBe(0);
  });

  it('updateMoodEntry updates fields and REPLACES the activity links', async () => {
    await addMoodEntry(adapter, 4, [1], 'before', '2026-07-13T10:00:00.000Z');
    const entryId = (db.prepare('SELECT id FROM entries').get() as { id: number }).id;

    const result = await updateMoodEntry(adapter, entryId, {
      mood: 9,
      activities: [2],
      notes: 'after',
      date: new Date('2026-07-14T08:30:00.000Z'),
      photos: [],
    });
    expect(result.success).toBe(true);

    const row = db.prepare('SELECT mood, notes, date FROM entries WHERE id = ?').get(entryId);
    expect(row.mood).toBe(9);
    expect(row.notes).toBe('after');
    expect(row.date).toBe('2026-07-14T08:30:00.000Z');

    // Links were cleared + re-inserted: only activity 2 now.
    const links = db
      .prepare('SELECT activity_id FROM entry_activities WHERE entry_id = ? ORDER BY activity_id')
      .all(entryId)
      .map((r: any) => r.activity_id);
    expect(links).toEqual([2]);
  });
});
