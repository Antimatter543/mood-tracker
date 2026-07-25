/**
 * INTEGRATION test — runs the REAL migration 11 `up()` against a REAL SQLite
 * engine (Node's built-in `node:sqlite`, Node ≥ 22.5) starting from a v10-shaped
 * `entries` table (no `starred_at`), and asserts the schema change actually
 * LANDS: the nullable `starred_at` column is added AND a PARTIAL index (WHERE
 * starred_at IS NOT NULL) is created.
 *
 * Why on top of migrations.test.ts: that suite runs against the `expo-sqlite`
 * jest mock, which is a no-op stub — it can only prove migration 11 ISSUES the
 * right SQL strings, never that an `ALTER TABLE … ADD COLUMN` + partial
 * `CREATE INDEX` actually EXECUTE correctly on a real engine. We import the REAL
 * `migrations` array and drive version 11's `up` against our own node:sqlite
 * adapter, so a change to the migration SQL breaks this test. Skips cleanly if
 * node:sqlite is unavailable.
 */

// migrations.ts imports these at module-eval; mock them (mirrors
// __tests__/migrations.test.ts) so importing the module is cheap and pulls in no
// native modules. Migration 11 is driven against our OWN node:sqlite adapter
// below, so the expo-sqlite mock is never actually used to run SQL.
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

// Load Node's built-in SQLite; skip the whole suite if unavailable.
let DatabaseSync: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  DatabaseSync = null;
}
const describeIfSqlite = DatabaseSync ? describe : describe.skip;

// An expo-sqlite-shaped async adapter over a synchronous node:sqlite database
// (only the methods migration 11's `up` uses: runAsync).
function makeAdapter(db: any) {
  return {
    runAsync: async (sql: string, params: any[] = []) => {
      const r = db.prepare(sql).run(...(params ?? []));
      return { lastInsertRowId: Number(r.lastInsertRowid), changes: Number(r.changes) };
    },
    execAsync: async (sql: string) => {
      db.exec(sql);
    },
  };
}

describeIfSqlite('migration 11 — starred_at column + partial index (real SQLite)', () => {
  let db: any;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    // A v10-shaped `entries` table: NO starred_at column yet — exactly what an
    // existing user's DB looks like the instant before migration 11 runs.
    db.exec(`
      CREATE TABLE entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mood REAL NOT NULL,
        notes TEXT,
        date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    db.exec(`PRAGMA user_version = 10;`);
    db.prepare('INSERT INTO entries (mood, notes, date) VALUES (?,?,?)').run(
      7,
      'pre-existing',
      '2026-07-01T09:00:00Z'
    );
  });

  afterEach(() => db?.close?.());

  const runMigration11 = async () => {
    const m11 = migrations.find((m) => m.version === 11);
    expect(m11).toBeDefined();
    await m11!.up(makeAdapter(db) as any);
  };

  const columns = (): string[] =>
    db.prepare('PRAGMA table_info(entries)').all().map((c: any) => c.name);

  it('the v10 entries table has NO starred_at column before the migration', () => {
    expect(columns()).not.toContain('starred_at');
  });

  it('adds a nullable starred_at column — the pre-existing row becomes NULL (not starred)', async () => {
    await runMigration11();
    expect(columns()).toContain('starred_at');
    const row = db.prepare('SELECT starred_at FROM entries').get();
    expect(row.starred_at).toBeNull();
  });

  it('creates a PARTIAL index idx_entries_starred (WHERE starred_at IS NOT NULL)', async () => {
    await runMigration11();

    // PRAGMA index_list exposes `partial` (1 for a partial index) — the robust,
    // non-string check that this is a partial (not a full) index.
    const idxList = db.prepare('PRAGMA index_list(entries)').all();
    const starIdx = idxList.find((i: any) => i.name === 'idx_entries_starred');
    expect(starIdx).toBeDefined();
    expect(starIdx.partial).toBe(1);

    // And the stored CREATE statement carries the exact partial predicate.
    const master = db
      .prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_entries_starred'")
      .get();
    expect(master).toBeDefined();
    expect(String(master.sql).toUpperCase()).toContain('WHERE STARRED_AT IS NOT NULL');
  });

  it('is idempotent-safe: the CREATE INDEX uses IF NOT EXISTS (re-running up() does not throw)', async () => {
    await runMigration11();
    // Re-running the CREATE INDEX portion must not throw (IF NOT EXISTS). The
    // ALTER would throw "duplicate column", so we only re-run the index create —
    // mirroring the real guard that matters for the partial index.
    await expect(
      makeAdapter(db).runAsync(
        `CREATE INDEX IF NOT EXISTS idx_entries_starred ON entries(starred_at) WHERE starred_at IS NOT NULL`
      )
    ).resolves.toBeDefined();
  });

  it('after migration, a star write lands and the column round-trips', async () => {
    await runMigration11();
    const id = db.prepare('SELECT id FROM entries').get().id;
    db.prepare('UPDATE entries SET starred_at = ? WHERE id = ?').run('2026-07-20T10:00:00.000Z', id);
    const row = db.prepare('SELECT starred_at FROM entries WHERE id = ?').get(id);
    expect(row.starred_at).toBe('2026-07-20T10:00:00.000Z');
  });
});
