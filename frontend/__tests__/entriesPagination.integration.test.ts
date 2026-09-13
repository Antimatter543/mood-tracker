/**
 * INTEGRATION test — paginates the REAL `getEntriesWindow` / `getEntriesPage` over
 * a REAL SQLite engine (`node:sqlite`) and asserts the property the Timeline
 * depends on: walking the list page by page yields EVERY live entry EXACTLY ONCE,
 * in date order, whatever the offsets and whatever the data looks like.
 *
 * This is not a restatement of the SQL. It is the one thing the `expo-sqlite` jest
 * stub can never tell us (it never executes SQL — see databases/CLAUDE.md), and it
 * is a real trap: `ORDER BY e.date DESC` alone is a PARTIAL order because `date` is
 * not unique. Two entries logged in the same instant, or rows imported from a
 * backup that only carried day precision, tie — and nothing obliges SQLite to break
 * a tie the same way for `LIMIT 20 OFFSET 20` as it did for `LIMIT 20 OFFSET 0`
 * (the bounded top-N sorter it uses for `LIMIT+OFFSET` is sized from limit+offset,
 * so a different offset is genuinely a different sort job). When ties do get
 * reordered between pages, one row comes back on two pages — duplicate ids,
 * duplicate SectionList keys, corrupted cell measurement — and another never comes
 * back at all, silently missing from the user's history. The fix is the TOTAL order
 * `e.date DESC, e.id DESC`; these tests are what keeps it there.
 *
 * The tie cases are deliberately extreme (a whole page of identical timestamps,
 * then a table of nothing but one timestamp) because a partial order can happen to
 * behave on mild data and fail on a real user's.
 */
jest.mock('expo-sqlite');
jest.mock('@/databases/mediaHelpers', () => ({
  MEDIA_DIR: 'file:///media/',
  copyToMediaDir: jest.fn(),
  deleteMediaFile: jest.fn().mockResolvedValue(undefined),
}));

import { getEntriesWindow, getEntriesPage } from '@/databases/entries';
import { EntryFilters } from '@/components/timeline/entryFilter';

let DatabaseSync: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  DatabaseSync = null;
}
const describeIfSqlite = DatabaseSync ? describe : describe.skip;

/** An expo-sqlite-shaped async adapter over a synchronous node:sqlite database. */
function makeAdapter(db: any) {
  return {
    getAllAsync: async (sql: string, params: any[] = []) => db.prepare(sql).all(...(params ?? [])),
    getFirstAsync: async (sql: string, params: any[] = []) =>
      db.prepare(sql).get(...(params ?? [])) ?? null,
  } as any;
}

const SCHEMA = `
  CREATE TABLE activity_groups (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE);
  CREATE TABLE activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, group_id INTEGER NOT NULL,
    icon_family TEXT DEFAULT 'Feather', icon_name TEXT DEFAULT 'circle', position INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE entries (id INTEGER PRIMARY KEY AUTOINCREMENT, mood REAL NOT NULL, notes TEXT, date TIMESTAMP, starred_at TEXT, deleted_at TEXT);
  CREATE TABLE entry_media (
    id INTEGER PRIMARY KEY AUTOINCREMENT, entry_id INTEGER NOT NULL, file_path TEXT NOT NULL,
    media_type TEXT NOT NULL DEFAULT 'image'
  );
  CREATE TABLE entry_activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT, entry_id INTEGER NOT NULL, activity_id INTEGER NOT NULL
  );
`;

const NO_FILTER: EntryFilters = { query: '', moodRange: null, starredOnly: false };
const PAGE = 20;
const DAY_MS = 86_400_000;

describeIfSqlite('Timeline pagination — every entry exactly once, at any depth', () => {
  let db: any;
  let adapter: any;

  /**
   * Seed `count` live entries. `tiesPerTimestamp` controls how many consecutive
   * entries share one identical `date` value (1 = all distinct).
   */
  const seed = (count: number, tiesPerTimestamp: number) => {
    const insert = db.prepare('INSERT INTO entries (mood, notes, date) VALUES (?, ?, ?)');
    const link = db.prepare('INSERT INTO entry_activities (entry_id, activity_id) VALUES (?, ?)');
    for (let i = 0; i < count; i++) {
      const bucket = Math.floor(i / tiesPerTimestamp);
      const date = new Date(Date.UTC(2026, 8, 1) - bucket * DAY_MS).toISOString();
      const { lastInsertRowid } = insert.run(6.5, `note ${i}`, date);
      // Multi-activity rows exercise the GROUP_CONCAT/GROUP BY shape: the JOINs
      // must not multiply an entry into several rows and skew LIMIT.
      link.run(Number(lastInsertRowid), 1);
      if (i % 3 === 0) link.run(Number(lastInsertRowid), 2);
    }
  };

  /** Walk the list the way DBViewer does: offset = rows already loaded. */
  const walkRowsByOffset = async (pageSize = PAGE): Promise<{ id: number; date: string }[]> => {
    const rows: { id: number; date: string }[] = [];
    for (;;) {
      const page = await getEntriesWindow(adapter, NO_FILTER, rows.length, pageSize);
      rows.push(...page.map((e) => ({ id: e.id, date: e.date })));
      if (page.length < pageSize) return rows;
      if (rows.length > 5000) throw new Error('pagination did not terminate');
    }
  };
  const walkByOffset = async (pageSize = PAGE): Promise<number[]> =>
    (await walkRowsByOffset(pageSize)).map((r) => r.id);

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec(SCHEMA);
    db.exec(`INSERT INTO activity_groups (id, name) VALUES (1, 'Life');`);
    db.exec(`INSERT INTO activities (id, name, group_id) VALUES (1, 'Gym', 1), (2, 'Read', 1);`);
    adapter = makeAdapter(db);
  });

  afterEach(() => {
    db?.close?.();
  });

  /**
   * Assert the TOTAL order directly rather than restating the expected sequence:
   * dates never increase, and inside a run of equal dates the ids strictly
   * decrease. Any tie left unordered — the actual bug — shows up here as an
   * out-of-order id pair, whatever the seed happens to look like.
   */
  const expectTotallyOrdered = (rows: { id: number; date: string }[]) => {
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1];
      const curr = rows[i];
      expect(curr.date <= prev.date).toBe(true);
      if (curr.date === prev.date) expect(curr.id).toBeLessThan(prev.id);
    }
  };

  it.each([
    ['all timestamps distinct', 1],
    ['5 entries share each timestamp', 5],
    ['a whole page shares one timestamp', PAGE],
    ['more than a page shares one timestamp', PAGE + 7],
  ])('walks 137 entries with %s and returns each exactly once', async (_label, ties) => {
    seed(137, ties as number);
    const rows = await walkRowsByOffset();
    const ids = rows.map((r) => r.id);

    expect(ids).toHaveLength(137);
    expect(new Set(ids).size).toBe(137);
    // Nothing skipped either — every seeded row came back on some page.
    expect([...ids].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 137 }, (_, i) => i + 1)
    );
    expectTotallyOrdered(rows);
  });

  it('returns every entry exactly once even when EVERY row shares one timestamp', async () => {
    // The pathological case: the ORDER BY's leading column can't discriminate at
    // all, so the tiebreaker is doing 100% of the ordering work.
    seed(60, 60);
    const ids = await walkByOffset();
    expect(ids).toHaveLength(60);
    expect(new Set(ids).size).toBe(60);
  });

  it('is stable across page sizes — the same rows in the same order', async () => {
    seed(80, 4);
    const byTwenty = await walkByOffset(20);
    const bySeven = await walkByOffset(7);
    const bySixtyOne = await walkByOffset(61);
    expect(bySeven).toEqual(byTwenty);
    expect(bySixtyOne).toEqual(byTwenty);
  });

  it('never returns a binned entry on any page', async () => {
    seed(45, 5);
    // Bin every third entry — they must vanish from the walk entirely, and the
    // walk must still terminate rather than looping on short pages.
    db.exec(`UPDATE entries SET deleted_at = '2026-09-10T00:00:00.000Z' WHERE id % 3 = 0;`);
    const ids = await walkByOffset();
    expect(ids.some((id) => id % 3 === 0)).toBe(false);
    expect(ids).toHaveLength(30);
    expect(new Set(ids).size).toBe(30);
  });

  it('getEntriesPage is exactly getEntriesWindow at page * pageSize', async () => {
    seed(50, 5);
    for (const page of [0, 1, 2]) {
      const viaPage = await getEntriesPage(adapter, NO_FILTER, page, PAGE);
      const viaWindow = await getEntriesWindow(adapter, NO_FILTER, page * PAGE, PAGE);
      expect(viaPage.map((e) => e.id)).toEqual(viaWindow.map((e) => e.id));
    }
  });

  it('a multi-page window is the concatenation of the pages it spans', async () => {
    // This is what a depth-preserving refresh reads. If a single big window
    // disagreed with the pages that built it, every refresh would reshuffle the
    // user's list.
    seed(70, 6);
    const wide = await getEntriesWindow(adapter, NO_FILTER, 0, 60);
    const paged = [
      ...(await getEntriesWindow(adapter, NO_FILTER, 0, PAGE)),
      ...(await getEntriesWindow(adapter, NO_FILTER, PAGE, PAGE)),
      ...(await getEntriesWindow(adapter, NO_FILTER, 2 * PAGE, PAGE)),
    ];
    expect(wide.map((e) => e.id)).toEqual(paged.map((e) => e.id));
  });

  it('hydrates activities without letting the JOIN multiply rows', async () => {
    // The LIMIT counts GROUPED entries, so a 2-activity row must still cost one
    // slot — otherwise every page would be short and pagination would stall early.
    seed(25, 5);
    const first = await getEntriesWindow(adapter, NO_FILTER, 0, PAGE);
    expect(first).toHaveLength(PAGE);
    expect(new Set(first.map((e) => e.id)).size).toBe(PAGE);
    // Seeded so that entries where (id - 1) % 3 === 0 carry both activities.
    for (const entry of first) {
      const expected = (entry.id - 1) % 3 === 0 ? ['Gym', 'Read'] : ['Gym'];
      expect(entry.activities.map((a) => a.name).sort()).toEqual(expected);
    }
  });
});
