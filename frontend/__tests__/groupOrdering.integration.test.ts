/**
 * INTEGRATION test — runs the REAL migration 13 `up()`, and the REAL
 * `reorderActivityGroups` / `moveActivityToGroup` / `deleteActivityGroup` /
 * `getGroupDeletionImpact` functions, against a REAL SQLite engine (Node's
 * built-in `node:sqlite`, Node >= 22.5). Mirrors the shape of
 * `migration11.integration.test.ts` (migration-only) and
 * `entries.integration.test.ts` (write-layer injection).
 *
 * Why on top of the mock-based groupsManagement.test.ts /
 * activityGroupMove.test.ts: the expo-sqlite jest mock is a no-op stub, so it
 * can only prove these functions ISSUE the right SQL, never that the SQL
 * actually produces the right rows, that the migration's ALTER + backfill is
 * correct, or that ON DELETE CASCADE really removes what
 * getGroupDeletionImpact predicted. Skips cleanly if node:sqlite is
 * unavailable.
 */

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
jest.mock('@/components/IconPicker', () => ({ IconFamilyType: {} }));
jest.mock('@/components/types', () => ({}));

import { migrations } from '@/databases/migrations';
import {
  getActivityGroups,
  reorderActivityGroups,
  deleteActivityGroup,
  getGroupDeletionImpact,
} from '@/databases/groups';
import { moveActivityToGroup } from '@/databases/activities';
import {
  __setWriteConnectionForTests,
  __resetWriteTransactionForTests,
} from '@/databases/writeTransaction';

// Load Node's built-in SQLite; skip the whole suite if unavailable.
let DatabaseSync: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  DatabaseSync = null;
}
const describeIfSqlite = DatabaseSync ? describe : describe.skip;

// An expo-sqlite-shaped async adapter over a synchronous node:sqlite database —
// exposes exactly the surface withWriteTransaction / groups.ts / activities.ts
// need (runAsync, getFirstAsync, getAllAsync, execAsync). `execAsync` also
// carries the BEGIN IMMEDIATE / COMMIT / ROLLBACK that withWriteTransaction
// issues on the injected write connection (databases/writeTransaction.ts).
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

// A v12-shaped schema: activity_groups has NO sort_order column yet — exactly
// what an existing user's DB looks like the instant before migration 13 runs.
// `activities` already carries the migration-2 shape (UNIQUE(name, group_id),
// FK cascade) since that migration long predates 13.
const SCHEMA_V12 = `
  CREATE TABLE activity_groups (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);
  CREATE TABLE activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, group_id INTEGER NOT NULL,
    icon_family TEXT DEFAULT 'Feather', icon_name TEXT DEFAULT 'circle', position INTEGER NOT NULL DEFAULT 0,
    UNIQUE(name, group_id),
    FOREIGN KEY(group_id) REFERENCES activity_groups(id) ON DELETE CASCADE
  );
  CREATE TABLE entries (id INTEGER PRIMARY KEY AUTOINCREMENT, mood REAL NOT NULL, notes TEXT, date TIMESTAMP, deleted_at TEXT);
  CREATE TABLE entry_activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT, entry_id INTEGER NOT NULL, activity_id INTEGER NOT NULL,
    FOREIGN KEY(entry_id) REFERENCES entries(id) ON DELETE CASCADE,
    FOREIGN KEY(activity_id) REFERENCES activities(id) ON DELETE CASCADE
  );
`;

describeIfSqlite('migration 13 + group ordering/move/delete — real SQLite', () => {
  let db: any;
  let adapter: ReturnType<typeof makeAdapter>;

  const columns = (table: string): { name: string; notnull: number }[] =>
    db.prepare(`PRAGMA table_info(${table})`).all();

  const runMigration13 = async () => {
    const m13 = migrations.find((m) => m.version === 13);
    expect(m13).toBeDefined();
    await m13!.up(adapter as any);
  };

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec(SCHEMA_V12);
    db.exec(`PRAGMA user_version = 12;`);

    // Seed 3 groups, inserted in id order — this IS the pre-migration display
    // order (ORDER BY id), which the backfill must reproduce exactly.
    db.exec(`
      INSERT INTO activity_groups (id, name) VALUES (1, 'Sports');
      INSERT INTO activity_groups (id, name) VALUES (2, 'Health');
      INSERT INTO activity_groups (id, name) VALUES (3, 'Social');
    `);
    db.exec(`
      INSERT INTO activities (id, name, group_id, position) VALUES (1, 'Running', 1, 1);
      INSERT INTO activities (id, name, group_id, position) VALUES (2, 'Yoga', 1, 2);
      INSERT INTO activities (id, name, group_id, position) VALUES (3, 'Sleep', 2, 1);
    `);
    db.exec(`
      INSERT INTO entries (id, mood, notes, date) VALUES (1, 7, 'ran today', '2026-08-01T09:00:00Z');
      INSERT INTO entries (id, mood, notes, date) VALUES (2, 6, 'did yoga', '2026-08-02T09:00:00Z');
    `);
    // entry 1 is linked to Running (activity 1); entry 2 is linked to Yoga (activity 2).
    db.exec(`
      INSERT INTO entry_activities (entry_id, activity_id) VALUES (1, 1);
      INSERT INTO entry_activities (entry_id, activity_id) VALUES (2, 2);
    `);

    adapter = makeAdapter(db);
  });

  afterEach(() => {
    __resetWriteTransactionForTests();
    db?.close?.();
  });

  describe('migration 13 backfill', () => {
    it('the v12 activity_groups table has NO sort_order column before the migration', () => {
      expect(columns('activity_groups').map((c) => c.name)).not.toContain('sort_order');
    });

    it('adds a NOT NULL sort_order column, backfilled to id — a visual no-op vs. the old ORDER BY id', async () => {
      await runMigration13();

      const col = columns('activity_groups').find((c) => c.name === 'sort_order');
      expect(col).toBeDefined();
      expect(col!.notnull).toBe(1);

      const rows = db.prepare('SELECT id, sort_order FROM activity_groups').all();
      for (const row of rows) {
        expect(row.sort_order).toBe(row.id);
      }

      const oldOrder = db
        .prepare('SELECT id FROM activity_groups ORDER BY id')
        .all()
        .map((r: any) => r.id);
      const newOrder = db
        .prepare('SELECT id FROM activity_groups ORDER BY sort_order, id')
        .all()
        .map((r: any) => r.id);
      expect(newOrder).toEqual(oldOrder);
    });
  });

  describe('reorderActivityGroups + moveActivityToGroup (real engine, real transaction)', () => {
    beforeEach(async () => {
      await runMigration13();
      __setWriteConnectionForTests(adapter as any);
    });

    it('reorderActivityGroups changes the REAL read order and leaves sort_order contiguous 1..N', async () => {
      // Health (2), Social (3), Sports (1) — deliberately not id order.
      const result = await reorderActivityGroups(adapter as any, [{ id: 2 }, { id: 3 }, { id: 1 }]);
      expect(result.success).toBe(true);

      const groups = await getActivityGroups(adapter as any);
      expect(groups.map((g) => g.id)).toEqual([2, 3, 1]);
      expect(groups.map((g) => g.sort_order)).toEqual([1, 2, 3]);
    });

    it('moveActivityToGroup re-files the activity, compacts BOTH groups, and preserves entry_activities history', async () => {
      // Move Running (activity 1, currently group 1 position 1) into group 2 (Health).
      const result = await moveActivityToGroup(adapter as any, 1, 2);
      expect(result.success).toBe(true);

      const running = db.prepare('SELECT group_id, position FROM activities WHERE id = 1').get();
      expect(running.group_id).toBe(2);
      expect(running.position).toBe(2); // appended after Sleep (position 1)

      // Source group (1) had Running(pos1)/Yoga(pos2) — Yoga must compact to position 1.
      const sourceRemaining = db
        .prepare('SELECT id, position FROM activities WHERE group_id = 1 ORDER BY position')
        .all();
      expect(sourceRemaining).toEqual([{ id: 2, position: 1 }]);

      // Target group (2) is now contiguous 1..2 (Sleep, Running).
      const targetActivities = db
        .prepare('SELECT id, position FROM activities WHERE group_id = 2 ORDER BY position')
        .all();
      expect(targetActivities.map((a: any) => a.position)).toEqual([1, 2]);

      // The load-bearing assertion: entry_activities for Running (activity 1)
      // survived the re-file untouched — moving groups is never a history rewrite.
      const link = db
        .prepare('SELECT entry_id, activity_id FROM entry_activities WHERE activity_id = 1')
        .get();
      expect(link).toEqual({ entry_id: 1, activity_id: 1 });
    });
  });

  describe('deleteActivityGroup — CASCADE claim (foreign_keys = ON on the write connection)', () => {
    beforeEach(async () => {
      await runMigration13();
      __setWriteConnectionForTests(adapter as any);
    });

    it('cascade-deletes the group\'s activities + their entry_activities, but entries survive — matching getGroupDeletionImpact', async () => {
      // Group 1 (Sports) has Running (linked to entry 1) and Yoga (linked to entry 2).
      const impact = await getGroupDeletionImpact(adapter as any, 1);
      expect(impact).toEqual({ exists: true, activityCount: 2, entryCount: 2 });

      // Recycle-bin integration (migration 12): a BINNED entry must not inflate
      // the warning — the count gates copy the user reads against their own
      // VISIBLE history. Bin entry 2 and the impact drops to 1; restore it and
      // the original count comes back.
      db.prepare(`UPDATE entries SET deleted_at = '2026-09-03T00:00:00.000Z' WHERE id = 2`).run();
      const impactWithBinned = await getGroupDeletionImpact(adapter as any, 1);
      expect(impactWithBinned).toEqual({ exists: true, activityCount: 2, entryCount: 1 });
      db.prepare(`UPDATE entries SET deleted_at = NULL WHERE id = 2`).run();

      const activitiesBefore = db.prepare('SELECT COUNT(*) AS n FROM activities WHERE group_id = 1').get().n;
      const linksBefore = db
        .prepare('SELECT COUNT(*) AS n FROM entry_activities WHERE activity_id IN (1, 2)')
        .get().n;
      expect(activitiesBefore).toBe(impact.activityCount);
      expect(linksBefore).toBeGreaterThanOrEqual(impact.entryCount);

      const result = await deleteActivityGroup(adapter as any, 1);
      expect(result.success).toBe(true);

      // The group and its activities are gone.
      expect(db.prepare('SELECT * FROM activity_groups WHERE id = 1').get()).toBeUndefined();
      expect(db.prepare('SELECT COUNT(*) AS n FROM activities WHERE group_id = 1').get().n).toBe(0);
      // Their entry_activities rows cascaded away too.
      expect(
        db.prepare('SELECT COUNT(*) AS n FROM entry_activities WHERE activity_id IN (1, 2)').get().n
      ).toBe(0);

      // The entries themselves survive — only the activity tags were destroyed.
      const remainingEntries = db.prepare('SELECT id FROM entries ORDER BY id').all().map((r: any) => r.id);
      expect(remainingEntries).toEqual([1, 2]);

      // The other group (Health, id 2) and its activity (Sleep) are untouched.
      expect(db.prepare('SELECT * FROM activity_groups WHERE id = 2').get()).toBeDefined();
      expect(db.prepare('SELECT * FROM activities WHERE id = 3').get()).toBeDefined();
    });
  });
});
