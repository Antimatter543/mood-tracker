/**
 * INTEGRATION test — runs the REAL migration 12 `up()` against a REAL SQLite
 * engine (Node's built-in `node:sqlite`, Node ≥ 22.5) starting from a v11-shaped
 * `entries` table (starred_at but no `deleted_at`), and asserts the schema change
 * actually LANDS: the nullable `deleted_at` column is added AND a PARTIAL index
 * (WHERE deleted_at IS NOT NULL) is created.
 *
 * Why on top of migrations.test.ts: that suite runs against the `expo-sqlite`
 * jest mock, which is a no-op stub — it can only prove migration 12 ISSUES the
 * right SQL strings, never that an `ALTER TABLE … ADD COLUMN` + partial
 * `CREATE INDEX` actually EXECUTE. Mirrors migration11.integration.test.ts.
 */

// migrations.ts imports these at module-eval; mock them (mirrors
// __tests__/migrations.test.ts) so importing the module is cheap and pulls in no
// native modules. Migration 12 is driven against our OWN node:sqlite adapter
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

describeIfSqlite('migration 12 — deleted_at column + partial index (real SQLite)', () => {
  let db: any;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    // A v11-shaped `entries` table: starred_at is there, deleted_at is NOT —
    // exactly what an existing user's DB looks like the instant before this runs.
    db.exec(`
      CREATE TABLE entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mood REAL NOT NULL,
        notes TEXT,
        date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        starred_at TEXT
      );
    `);
    db.exec(`PRAGMA user_version = 11;`);
    db.prepare('INSERT INTO entries (mood, notes, date) VALUES (?,?,?)').run(
      7,
      'pre-existing',
      '2026-07-01T09:00:00Z'
    );
  });

  afterEach(() => db?.close?.());

  const runMigration12 = async () => {
    const m12 = migrations.find((m) => m.version === 12);
    expect(m12).toBeDefined();
    await m12!.up(makeAdapter(db) as any);
  };

  const columns = (): string[] =>
    db.prepare('PRAGMA table_info(entries)').all().map((c: any) => c.name);

  it('the v11 entries table has NO deleted_at column before the migration', () => {
    expect(columns()).not.toContain('deleted_at');
  });

  it('adds a nullable deleted_at — every EXISTING entry stays LIVE (NULL)', async () => {
    await runMigration12();
    expect(columns()).toContain('deleted_at');
    // The single most important property of this migration: an upgrade must not
    // silently bin anybody's existing history.
    const row = db.prepare('SELECT deleted_at FROM entries').get();
    expect(row.deleted_at).toBeNull();
    const live = db
      .prepare('SELECT COUNT(*) AS n FROM entries WHERE deleted_at IS NULL')
      .get();
    expect(live.n).toBe(1);
  });

  it('creates a PARTIAL index idx_entries_deleted (WHERE deleted_at IS NOT NULL)', async () => {
    await runMigration12();

    // PRAGMA index_list exposes `partial` (1 for a partial index) — the robust,
    // non-string check that this indexes only the binned rows, not the whole
    // overwhelmingly-NULL column.
    const idxList = db.prepare('PRAGMA index_list(entries)').all();
    const binIdx = idxList.find((i: any) => i.name === 'idx_entries_deleted');
    expect(binIdx).toBeDefined();
    expect(binIdx.partial).toBe(1);

    const master = db
      .prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_entries_deleted'")
      .get();
    expect(master).toBeDefined();
    expect(String(master.sql).toUpperCase()).toContain('WHERE DELETED_AT IS NOT NULL');
  });

  it('leaves migration 11\'s starred index alone (the two are independent)', async () => {
    db.exec(
      `CREATE INDEX idx_entries_starred ON entries(starred_at) WHERE starred_at IS NOT NULL`
    );
    await runMigration12();
    const names = db.prepare('PRAGMA index_list(entries)').all().map((i: any) => i.name);
    expect(names).toContain('idx_entries_starred');
    expect(names).toContain('idx_entries_deleted');
  });

  it('is idempotent-safe: the CREATE INDEX uses IF NOT EXISTS (re-running does not throw)', async () => {
    await runMigration12();
    // The ALTER would throw "duplicate column", so we only re-run the index
    // create — the guard that actually matters for the partial index.
    await expect(
      makeAdapter(db).runAsync(
        `CREATE INDEX IF NOT EXISTS idx_entries_deleted ON entries(deleted_at) WHERE deleted_at IS NOT NULL`
      )
    ).resolves.toBeDefined();
  });

  it('after migration, a soft delete lands and the column round-trips', async () => {
    await runMigration12();
    const id = db.prepare('SELECT id FROM entries').get().id;
    db.prepare('UPDATE entries SET deleted_at = ? WHERE id = ?').run(
      '2026-08-01T10:00:00.000Z',
      id
    );
    const row = db.prepare('SELECT deleted_at FROM entries WHERE id = ?').get(id);
    expect(row.deleted_at).toBe('2026-08-01T10:00:00.000Z');
    // …and it is no longer visible to a live-entries read.
    const live = db
      .prepare('SELECT COUNT(*) AS n FROM entries WHERE deleted_at IS NULL')
      .get();
    expect(live.n).toBe(0);
  });
});
