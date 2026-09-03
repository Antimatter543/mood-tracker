/**
 * INTEGRATION test — the recycle-bin lifecycle against a REAL SQLite engine
 * (Node's built-in `node:sqlite`, Node ≥ 22.5), driving the REAL functions:
 * `deleteMoodEntry` (soft), `restoreMoodEntry`, `purgeMoodEntry`,
 * `purgeExpiredBinEntries`, `getBinnedEntries`, `getBinCount`.
 *
 * The expo-sqlite jest mock is a no-op stub, so a mocked test can only prove
 * which SQL STRINGS we issue. The properties that actually matter here are
 * behavioural and only a real engine can show them:
 *   - a soft delete PRESERVES entry_activities / entry_media (that's what makes
 *     restore lossless) and does NOT unlink any photo file,
 *   - a purge destroys the rows via the FK cascade AND unlinks the files,
 *   - the 30-day boundary is exclusive on the young side (day 29 survives,
 *     day 31 goes) so an entry is never purged early,
 *   - the empty bin / empty database paths return 0 and touch nothing.
 *
 * mediaHelpers file IO is mocked (no expo-file-system) so we can assert exactly
 * which files would have been unlinked. Mirrors entries.integration.test.ts.
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
  deleteMoodEntry,
  getEntriesPage,
  getMoodEntries,
} from '@/databases/entries';
import { WINDOW_SUMMARY } from '@/components/visualisations/queries';
import {
  BIN_RETENTION_DAYS,
  getBinCount,
  getBinnedEntries,
  purgeExpiredBinEntries,
  purgeMoodEntry,
  restoreMoodEntry,
} from '@/databases/entry-bin';
import { deleteMediaFile } from '@/databases/mediaHelpers';

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

// Post-migration-12 shape.
const SCHEMA = `
  CREATE TABLE activity_groups (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE);
  CREATE TABLE activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, group_id INTEGER NOT NULL,
    icon_family TEXT DEFAULT 'Feather', icon_name TEXT DEFAULT 'circle', position INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(group_id) REFERENCES activity_groups(id) ON DELETE CASCADE
  );
  CREATE TABLE entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT, mood REAL NOT NULL, notes TEXT, date TIMESTAMP,
    starred_at TEXT, deleted_at TEXT
  );
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

const DAY = 86_400_000;

describeIfSqlite('recycle bin — real SQLite lifecycle', () => {
  let db: any;
  let adapter: any;

  const count = (table: string): number =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  const deletedAtOf = (id: number): string | null =>
    (db.prepare('SELECT deleted_at FROM entries WHERE id = ?').get(id) as {
      deleted_at: string | null;
    }).deleted_at;
  /** Stamp `deleted_at` to exactly `daysAgo` days before now. */
  const binAt = (id: number, daysAgo: number) =>
    db
      .prepare('UPDATE entries SET deleted_at = ? WHERE id = ?')
      .run(new Date(Date.now() - daysAgo * DAY).toISOString(), id);
  const addPhoto = (entryId: number, path: string) =>
    db
      .prepare(`INSERT INTO entry_media (entry_id, file_path, media_type) VALUES (?, ?, 'image')`)
      .run(entryId, path);

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    // FK ON is what makes the purge cascade real — the per-connection PRAGMA
    // trap that motivated writeTransaction.ts.
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec(SCHEMA);
    db.exec(`INSERT INTO activity_groups (id, name) VALUES (1, 'Sports');`);
    db.exec(`INSERT INTO activities (id, name, group_id) VALUES (1, 'Running', 1), (2, 'Reading', 1);`);

    adapter = makeAdapter(db);
    __resetWriteTransactionForTests();
    __setWriteConnectionForTests(adapter);
    (deleteMediaFile as jest.Mock).mockClear();
  });

  afterEach(() => {
    __resetWriteTransactionForTests();
    db?.close?.();
  });

  const seedEntry = async (notes = 'a day', date = '2026-07-13T10:00:00.000Z') => {
    await addMoodEntry(adapter, 7, [1, 2], notes, date);
    return (db.prepare('SELECT MAX(id) AS id FROM entries').get() as { id: number }).id;
  };

  // ── Soft delete ──────────────────────────────────────────────────────────

  it('deleteMoodEntry only STAMPS deleted_at — rows and photo files survive', async () => {
    const id = await seedEntry();
    addPhoto(id, 'file:///media/x.jpg');

    const result = await deleteMoodEntry(adapter, id);
    expect(result.success).toBe(true);

    // The row is still there, now stamped with a real UTC ISO instant.
    expect(count('entries')).toBe(1);
    const stamp = deletedAtOf(id);
    expect(stamp).not.toBeNull();
    expect(Number.isNaN(Date.parse(stamp as string))).toBe(false);

    // The whole point: NOTHING was destroyed, so a restore is lossless.
    expect(count('entry_activities')).toBe(2);
    expect(count('entry_media')).toBe(1);
    expect(deleteMediaFile).not.toHaveBeenCalled();
  });

  it('a soft-deleted entry disappears from getMoodEntries', async () => {
    const id = await seedEntry();
    await seedEntry('still here', '2026-07-14T10:00:00.000Z');
    expect(await getMoodEntries(adapter)).toHaveLength(2);

    await deleteMoodEntry(adapter, id);

    const live = await getMoodEntries(adapter);
    expect(live).toHaveLength(1);
    expect(live.map((e) => e.id)).not.toContain(id);
  });

  it('deleting twice does NOT restart the 30-day countdown', async () => {
    // The `AND deleted_at IS NULL` guard. Without it a double-tap (or a retry
    // after a slow UI) would silently re-stamp and give the entry a fresh 30
    // days, which is invisible until an entry outlives its retention window.
    const id = await seedEntry();
    binAt(id, 20);
    const original = deletedAtOf(id);

    await deleteMoodEntry(adapter, id);

    expect(deletedAtOf(id)).toBe(original);
  });

  // ── Restore ──────────────────────────────────────────────────────────────

  it('restoreMoodEntry round-trips an entry back with its activities and photos', async () => {
    const id = await seedEntry('round trip');
    addPhoto(id, 'file:///media/keep.jpg');
    await deleteMoodEntry(adapter, id);

    const result = await restoreMoodEntry(adapter, id);
    expect(result.success).toBe(true);
    expect(deletedAtOf(id)).toBeNull();

    const live = await getMoodEntries(adapter);
    expect(live).toHaveLength(1);
    expect(live[0].id).toBe(id);
    expect(live[0].notes).toBe('round trip');
    // Lossless: both activity links AND the photo came back untouched.
    expect(live[0].activities.map((a) => a.name).sort()).toEqual(['Reading', 'Running']);
    expect(live[0].photos?.map((p) => p.file_path)).toEqual(['file:///media/keep.jpg']);
  });

  it('restoring an entry that is already live is a harmless no-op', async () => {
    const id = await seedEntry();
    const result = await restoreMoodEntry(adapter, id);
    expect(result.success).toBe(true);
    expect(deletedAtOf(id)).toBeNull();
    expect(count('entries')).toBe(1);
  });

  // ── Bin reads ────────────────────────────────────────────────────────────

  it('getBinnedEntries returns ONLY binned entries, newest deletion first', async () => {
    const older = await seedEntry('older', '2026-07-01T10:00:00.000Z');
    const newer = await seedEntry('newer', '2026-07-02T10:00:00.000Z');
    await seedEntry('live one', '2026-07-03T10:00:00.000Z');
    binAt(older, 5);
    binAt(newer, 1);

    const binned = await getBinnedEntries(adapter);
    expect(binned.map((e) => e.id)).toEqual([newer, older]);
    expect(binned[0].notes).toBe('newer');
    expect(binned[0].activityNames.sort()).toEqual(['Reading', 'Running']);
  });

  it('getBinnedEntries handles an entry with NO activities (GROUP_CONCAT returns NULL)', async () => {
    await addMoodEntry(adapter, 5, [], 'no activities', '2026-07-05T10:00:00.000Z');
    const id = (db.prepare('SELECT MAX(id) AS id FROM entries').get() as { id: number }).id;
    await deleteMoodEntry(adapter, id);

    const binned = await getBinnedEntries(adapter);
    expect(binned).toHaveLength(1);
    // NOT [''] — a naive `''.split(',')` yields one empty string and renders a
    // stray separator in the UI.
    expect(binned[0].activityNames).toEqual([]);
  });

  it('an empty database yields an empty bin and a zero count (never throws)', async () => {
    expect(await getBinnedEntries(adapter)).toEqual([]);
    expect(await getBinCount(adapter)).toBe(0);
  });

  it('getBinCount counts only binned entries', async () => {
    const a = await seedEntry('a');
    await seedEntry('b');
    expect(await getBinCount(adapter)).toBe(0);
    await deleteMoodEntry(adapter, a);
    expect(await getBinCount(adapter)).toBe(1);
    await restoreMoodEntry(adapter, a);
    expect(await getBinCount(adapter)).toBe(0);
  });

  // ── Purge (the destructive path) ─────────────────────────────────────────

  it('purgeMoodEntry hard-deletes: cascades the child rows AND unlinks the files', async () => {
    const id = await seedEntry('goodbye');
    addPhoto(id, 'file:///media/a.jpg');
    addPhoto(id, 'file:///media/b.jpg');
    await deleteMoodEntry(adapter, id);

    const result = await purgeMoodEntry(adapter, id);
    expect(result.success).toBe(true);

    expect(count('entries')).toBe(0);
    // CASCADE removed the child rows — proves FK enforcement on the write conn.
    expect(count('entry_activities')).toBe(0);
    expect(count('entry_media')).toBe(0);
    // …and, unlike the soft delete, the FILES went too.
    expect((deleteMediaFile as jest.Mock).mock.calls.map((c) => c[0]).sort()).toEqual([
      'file:///media/a.jpg',
      'file:///media/b.jpg',
    ]);
  });

  it('purgeMoodEntry only touches the target entry', async () => {
    const doomed = await seedEntry('doomed');
    const spared = await seedEntry('spared');
    addPhoto(spared, 'file:///media/spared.jpg');
    await deleteMoodEntry(adapter, doomed);
    await deleteMoodEntry(adapter, spared);

    await purgeMoodEntry(adapter, doomed);

    expect(count('entries')).toBe(1);
    expect(deletedAtOf(spared)).not.toBeNull();
    expect(deleteMediaFile).not.toHaveBeenCalledWith('file:///media/spared.jpg');
  });

  // ── Retention sweep ──────────────────────────────────────────────────────

  it('purgeExpiredBinEntries destroys only entries past the retention window', async () => {
    const live = await seedEntry('live');
    const fresh = await seedEntry('binned today');
    const nearlyDue = await seedEntry('binned 29 days ago');
    const overdue = await seedEntry('binned 31 days ago');
    binAt(fresh, 0);
    binAt(nearlyDue, 29);
    binAt(overdue, 31);

    const purged = await purgeExpiredBinEntries(adapter, BIN_RETENTION_DAYS);

    expect(purged).toBe(1);
    const remaining = db
      .prepare('SELECT id FROM entries ORDER BY id')
      .all()
      .map((r: any) => r.id);
    expect(remaining).toEqual([live, fresh, nearlyDue]);
  });

  it('the 30-day boundary never purges early: day 29 survives, day 31 goes', async () => {
    // The boundary is what a user actually feels ("it said 1 day left and it was
    // gone"), so it gets its own explicit both-sides assertion.
    const day29 = await seedEntry('29');
    const day31 = await seedEntry('31');
    binAt(day29, 29);
    binAt(day31, 31);

    await purgeExpiredBinEntries(adapter, BIN_RETENTION_DAYS);

    expect(deletedAtOf(day29)).not.toBeNull(); // still in the bin
    expect(db.prepare('SELECT id FROM entries WHERE id = ?').get(day31)).toBeUndefined();
  });

  it('the sweep unlinks the photo files of the entries it destroys', async () => {
    const overdue = await seedEntry('overdue');
    addPhoto(overdue, 'file:///media/old.jpg');
    binAt(overdue, 40);

    await purgeExpiredBinEntries(adapter, BIN_RETENTION_DAYS);

    expect(deleteMediaFile).toHaveBeenCalledWith('file:///media/old.jpg');
    expect(count('entry_media')).toBe(0);
  });

  it('the sweep is a no-op on an EMPTY database (a fresh install)', async () => {
    // Empty-database is a real code path in this app: a fresh install runs this
    // on its very first launch, before a single entry exists.
    expect(await purgeExpiredBinEntries(adapter, BIN_RETENTION_DAYS)).toBe(0);
    expect(count('entries')).toBe(0);
    expect(deleteMediaFile).not.toHaveBeenCalled();
  });

  it('the sweep is a no-op when the bin is empty but entries exist', async () => {
    await seedEntry('untouched');
    expect(await purgeExpiredBinEntries(adapter, BIN_RETENTION_DAYS)).toBe(0);
    expect(count('entries')).toBe(1);
  });

  it('the sweep NEVER throws — a broken schema returns 0 instead of blocking app start', async () => {
    // It runs on the boot path (initializeDatabase), where an exception is a
    // white screen. Simulate the worst case: the table is gone.
    db.exec('DROP TABLE entry_activities; DROP TABLE entry_media; DROP TABLE entries;');
    await expect(purgeExpiredBinEntries(adapter, BIN_RETENTION_DAYS)).resolves.toBe(0);
  });

  // ── The QA "restore corrupts the entry" report, at the DATA layer ─────────
  //
  // On-device QA (2026-09-03) reported a restored entry rendering with ONLY its
  // note — no mood, no time, no activity chips — and Statistics showing 0.0
  // average with it present. Two candidate root causes: the restore WRITES
  // something wrong, or the read path is fine and the SCREEN is lying.
  //
  // These pin the data layer down so that question can only ever be answered
  // once. They drive the exact reads the two accusing screens use — the
  // Timeline's `getEntriesPage` (NOT `getMoodEntries`, which is a different
  // query and was the only one previously covered) and Statistics' real
  // `WINDOW_SUMMARY` — over the exact QA sequence: mood + activities + a
  // specific time in, soft delete, restore, read back.
  //
  // (They pass: the data is clean, which is what pushed the fix into the
  //  Timeline's scroll anchoring — see components/DBViewer.tsx.)

  const timelineFilters = { query: '', moodRange: null, starredOnly: false };

  it('restore round-trips the FULL row through getEntriesPage (the Timeline read)', async () => {
    const when = '2026-09-03T06:28:00.000Z';
    await addMoodEntry(adapter, 2, [1, 2], 'Rough day, work stress piling up.', when);
    const id = (db.prepare('SELECT MAX(id) AS id FROM entries').get() as { id: number }).id;

    await deleteMoodEntry(adapter, id);
    expect(await getEntriesPage(adapter, timelineFilters, 0, 20)).toHaveLength(0);

    await restoreMoodEntry(adapter, id);

    const [entry] = await getEntriesPage(adapter, timelineFilters, 0, 20);
    expect(entry).toBeDefined();
    // Every field the card renders, individually — a card that shows only the
    // note is precisely "mood/date/activities came back empty", so assert each
    // rather than a single deep-equal that could pass on a partial object.
    expect(entry.id).toBe(id);
    expect(entry.mood).toBe(2);
    expect(entry.date).toBe(when);
    expect(entry.notes).toBe('Rough day, work stress piling up.');
    expect(entry.starred_at).toBeNull();
    expect(entry.activities.map((a) => a.name).sort()).toEqual(['Reading', 'Running']);
    expect(entry.activities.every((a) => Number.isInteger(a.id))).toBe(true);
  });

  it('restore clears deleted_at to real NULL, not an empty string', async () => {
    // `deleted_at = ''` is NOT NULL in SQL, so it would satisfy neither
    // `IS NULL` (every live-entry read) nor a human eyeball on the row. It is
    // the classic way a "restored" entry stays invisible everywhere. Assert the
    // TYPE, not just falsiness — `expect('').toBeFalsy()` would pass on the bug.
    const id = await seedEntry('type check');
    await deleteMoodEntry(adapter, id);
    await restoreMoodEntry(adapter, id);

    expect(deletedAtOf(id)).toBeNull();
    const matched = db
      .prepare('SELECT COUNT(*) AS n FROM entries WHERE id = ? AND deleted_at IS NULL')
      .get(id) as { n: number };
    expect(matched.n).toBe(1);
  });

  it('an empty-string deleted_at WOULD hide the entry (negative control)', async () => {
    // Proves the assertions above have teeth: if restore ever wrote `''`, the
    // Timeline read really does drop the entry — the test would fail loudly
    // instead of quietly passing on a truthy-ish value.
    const id = await seedEntry('ghost');
    db.prepare(`UPDATE entries SET deleted_at = '' WHERE id = ?`).run(id);

    expect(await getEntriesPage(adapter, timelineFilters, 0, 20)).toHaveLength(0);
    expect(await getBinCount(adapter)).toBe(1);
  });

  it('a restored entry is counted again by the Statistics window aggregate', async () => {
    const when = '2026-09-03T06:28:00.000Z';
    await addMoodEntry(adapter, 2, [1], 'in the window', when);
    const id = (db.prepare('SELECT MAX(id) AS id FROM entries').get() as { id: number }).id;
    const summary = () =>
      db
        .prepare(WINDOW_SUMMARY)
        .get('2026-09-03T00:00:00.000Z', '2026-09-03T23:59:59.999Z') as {
        avg_mood: number | null;
        entry_count: number;
      };

    expect(summary()).toEqual({ avg_mood: 2, entry_count: 1 });

    await deleteMoodEntry(adapter, id);
    // Binned: excluded, and the aggregate over zero rows yields NULL — the
    // empty-database code path the Stats screen renders as 0.0.
    expect(summary()).toEqual({ avg_mood: null, entry_count: 0 });

    await restoreMoodEntry(adapter, id);
    expect(summary()).toEqual({ avg_mood: 2, entry_count: 1 });
  });
});
