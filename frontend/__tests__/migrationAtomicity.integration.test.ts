import { initialActivities } from '@/components/seedData';
import { initializeDatabase, resetDatabase } from '@/databases/lifecycle';
import { migrations, runMigrations } from '@/databases/migrations';
import {
  __resetDatabaseReadinessForTests,
  whenDatabaseInitialized,
} from '@/databases/readiness';
import {
  __resetWriteTransactionForTests,
  __setWriteConnectionForTests,
} from '@/databases/writeTransaction';
import { countRows, describeSqlite, openSqlite, type SqliteAdapter } from '@/testing/realSqlite';

/**
 * A cold start can fail on ANY statement: expo-modules-core's registry race
 * (expo/expo#50855, tasks/lessons.md 2026-11-04) rejects a statement at random.
 * These run the REAL migrations on a REAL SQLite engine and fail each statement
 * in turn, so "no migration can lose data or leave a half-migrated database" is
 * proved over the whole class, including migrations added later.
 */

const SIGNATURE = 'Cannot use shared object that was already released';
const STATEMENTS = ['execAsync', 'runAsync', 'getAllAsync', 'getFirstAsync'] as const;

type Instrumented = SqliteAdapter & { stats: { calls: number; peakInFlight: number } };

/**
 * The adapter, with every statement counted and truly asynchronous (a macrotask,
 * like the native call), so statements that overlap are seen overlapping.
 * Statement number `failAt` rejects with the production signature.
 */
function instrument(real: SqliteAdapter, failAt?: number): Instrumented {
  const stats = { calls: 0, peakInFlight: 0 };
  let inFlight = 0;
  const wrapped = Object.create(real) as Instrumented;
  wrapped.stats = stats;
  for (const method of STATEMENTS) {
    (wrapped as any)[method] = async (...args: unknown[]) => {
      stats.calls += 1;
      const failing = stats.calls === failAt;
      inFlight += 1;
      stats.peakInFlight = Math.max(stats.peakInFlight, inFlight);
      try {
        await new Promise((resolve) => setImmediate(resolve));
        if (failing) throw new Error(SIGNATURE);
        return await (real as any)[method](...args);
      } finally {
        inFlight -= 1;
      }
    };
  }
  return wrapped;
}

/** Everything a user could lose: schema, version and every row of every table. */
function dump(db: SqliteAdapter): string {
  const objects = db.raw
    .prepare(
      `SELECT type, name, sql FROM sqlite_master
       WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`
    )
    .all() as { type: string; name: string }[];
  const rows = objects
    .filter((o) => o.type === 'table')
    .map((t) => [t.name, db.raw.prepare(`SELECT * FROM "${t.name}" ORDER BY rowid`).all()]);
  const { user_version } = db.raw.prepare('PRAGMA user_version').get() as { user_version: number };
  return JSON.stringify({ user_version, objects, rows });
}

/** A database as an older app version left it, holding one user's real data. */
async function existingUserAt(version: number): Promise<SqliteAdapter> {
  const db = openSqlite();
  for (const migration of migrations.filter((m) => m.version <= version)) {
    await migration.up(db as never);
    db.raw.exec(`PRAGMA user_version = ${migration.version}`);
  }
  db.raw.exec(`
    INSERT INTO entries (mood, notes, date) VALUES (7.5, 'my real entry', '2026-01-01T09:00:00.000Z');
    INSERT INTO entry_activities (entry_id, activity_id) VALUES (1, 1);
  `);
  return db;
}

const LATEST = migrations[migrations.length - 1].version;

describeSqlite('runMigrations on a real engine', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('statement overlap', () => {
    it('the probe sees overlap when statements do overlap (positive control)', async () => {
      const db = instrument(openSqlite({ schema: 'CREATE TABLE t (x);' }));
      await Promise.all([db.runAsync('INSERT INTO t VALUES (1)'), db.runAsync('INSERT INTO t VALUES (2)')]);
      expect(db.stats.peakInFlight).toBe(2);
    });

    // The Promise.all in migration 2 is what reached the registry race on a fresh
    // install, and it left statements in flight across the ROLLBACK.
    it('never runs two statements at once, on any migration', async () => {
      const db = instrument(openSqlite());
      await runMigrations(db as never);
      expect(db.stats.peakInFlight).toBe(1);
    });

    it('still gives every seeded activity its icon, one statement at a time', async () => {
      const db = openSqlite();
      await runMigrations(db as never);
      expect(initialActivities.length).toBeGreaterThan(0);
      expect(countRows(db, 'activities')).toBe(initialActivities.length);
      for (const activity of initialActivities) {
        // Migration 6 renames the one seed row called "Event"; icons are untouched.
        const name = activity.name === 'Event' ? 'Social event' : activity.name;
        const row = db.raw
          .prepare('SELECT icon_family, icon_name FROM activities WHERE name = ? AND group_id = ?')
          .get(name, activity.group_id);
        expect({ ...(row as object) }).toEqual({
          icon_family: activity.icon_family,
          icon_name: activity.icon_name,
        });
      }
    });
  });

  describe('a statement failing at any point', () => {
    // Pure bookkeeping: how many statements this path issues on a clean run.
    async function statementCount(open: () => Promise<SqliteAdapter>): Promise<number> {
      const db = instrument(await open());
      await runMigrations(db as never);
      return db.stats.calls;
    }

    const paths: [string, () => Promise<SqliteAdapter>][] = [
      ['a fresh install', async () => openSqlite()],
      ...[1, 2, 5, 8, 11, 14].map(
        (v): [string, () => Promise<SqliteAdapter>] => [`an existing user at v${v}`, () => existingUserAt(v)]
      ),
    ];

    it.each(paths)('%s: rolls back untouched, and the next launch completes', async (_name, open) => {
      const clean = await open();
      await runMigrations(clean as never);
      const expected = dump(clean);

      const total = await statementCount(open);
      expect(total).toBeGreaterThan(1);

      for (let failAt = 1; failAt <= total; failAt += 1) {
        const real = await open();
        const before = dump(real);

        await expect(runMigrations(instrument(real, failAt) as never)).rejects.toThrow(SIGNATURE);
        // Nothing half-applied: not a table, not a row, not the version.
        expect(dump(real)).toBe(before);

        // The next cold start: the same migrations, on the same file.
        await runMigrations(real as never);
        expect(dump(real)).toBe(expected);
      }
      // A full migration run per statement: seconds under a loaded runner.
    }, 60_000);

    // From v2 on. A v1 user is excluded because migration 2 drops `activities` with
    // foreign keys ON, and that cascade clears entry_activities even when nothing
    // fails. It predates any public release and is unrelated to this failure mode.
    it.each([2, 5, 8, 11, 14])('keeps a v%i user\'s data through a failed then repeated upgrade', async (version) => {
      const real = await existingUserAt(version);
      // Statement 2 is the first one inside the migration transaction.
      await expect(runMigrations(instrument(real, 2) as never)).rejects.toThrow(SIGNATURE);
      await runMigrations(real as never);

      const entry = real.raw.prepare('SELECT mood, notes FROM entries WHERE id = 1').get();
      expect({ ...(entry as object) }).toEqual({ mood: 7.5, notes: 'my real entry' });
      expect(countRows(real, 'entry_activities')).toBe(1);
      const { user_version } = real.raw.prepare('PRAGMA user_version').get() as { user_version: number };
      expect(user_version).toBe(LATEST);
    });

    // A failed seed used to be swallowed and COMMITTED, stamped as migrated.
    it('never commits an install with a partial activity list', async () => {
      const real = openSqlite();
      // Statement 3 is inside the seed: 1 = read version, 2 = schema, 3 = first insert.
      await expect(runMigrations(instrument(real, 3) as never)).rejects.toThrow(SIGNATURE);
      expect(real.raw.prepare('PRAGMA user_version').get()).toEqual(
        expect.objectContaining({ user_version: 0 })
      );
      await runMigrations(real as never);
      expect(countRows(real, 'activities')).toBe(initialActivities.length);
    });
  });

  describe('initializeDatabase', () => {
    beforeEach(() => __resetDatabaseReadinessForTests());

    it('surfaces the failure: never reports ready, and leaves the data in place', async () => {
      const real = await existingUserAt(14);
      const before = dump(real);
      let ready = false;
      void whenDatabaseInitialized().then(() => {
        ready = true;
      });

      // 3 pragmas + the version read, so 5 is the first statement of migration 15.
      await expect(initializeDatabase(instrument(real, 5) as never)).rejects.toThrow(SIGNATURE);

      await new Promise((resolve) => setImmediate(resolve));
      expect(ready).toBe(false);
      expect(dump(real)).toBe(before);
    });
  });

  describe('resetDatabase', () => {
    beforeEach(() => __resetWriteTransactionForTests());
    afterEach(() => __resetWriteTransactionForTests());

    it('reports failure when the rebuild fails, and the next launch rebuilds the database', async () => {
      const real = await existingUserAt(14);
      const expected = openSqlite();
      await runMigrations(expected as never);

      // 5 statements of wipe (FK off, BEGIN, drops, version, COMMIT), then the
      // version read: statement 7 is the first of the rebuild.
      __setWriteConnectionForTests(instrument(real, 7) as never);
      const result = await resetDatabase();

      expect(result.success).toBe(false);
      expect(result.message).toContain(SIGNATURE);
      expect(real.raw.prepare('PRAGMA user_version').get()).toEqual(
        expect.objectContaining({ user_version: 0 })
      );

      await runMigrations(real as never);
      expect(dump(real)).toBe(dump(expected));
    });

    it('keeps everything when the wipe itself fails', async () => {
      const real = await existingUserAt(14);
      const before = dump(real);

      // Statement 3 is the DROP batch, inside the wipe transaction.
      __setWriteConnectionForTests(instrument(real, 3) as never);
      const result = await resetDatabase();

      expect(result.success).toBe(false);
      expect(dump(real)).toBe(before);
    });
  });
});
