/**
 * INTEGRATION test — runs EVERY exported SQL constant in `queries.ts` against a
 * REAL SQLite engine over a database whose ONLY entry is soft-deleted, and
 * asserts each one comes back empty/zero.
 *
 * This is the behavioural half of the bin-exclusion invariant (the source-scan
 * half is softDeleteExclusion.test.ts). A predicate can be PRESENT and still
 * wrong — attached to the outer query instead of the CTE, or on the wrong alias
 * in a three-way join — and only executing the SQL can tell. The `expo-sqlite`
 * jest mock never runs SQL, so nothing else in the suite would catch that.
 *
 * The param table is exhaustive BY CONSTRUCTION: the last test asserts that
 * every string export of queries.ts appears in it, so adding a new query without
 * deciding what it does about the bin fails the build.
 */
import * as queries from '@/components/visualisations/queries';

let DatabaseSync: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  DatabaseSync = null;
}
const describeIfSqlite = DatabaseSync ? describe : describe.skip;

// Wide-open bounds so the WINDOW filter can never be the reason a query returns
// nothing — the ONLY thing that should empty these results is the bin predicate.
const START = '2000-01-01T00:00:00.000Z';
const END = '2099-01-01T00:00:00.000Z';
const ACTIVITY_ID = 1;

/**
 * name -> the params that query takes. Ordered exactly as the SQL binds them.
 * MONTHLY_MOOD_AVERAGES / MONTHLY_DAILY_AVERAGES are aliases of
 * WEEKLY_MOOD_AVERAGES, so they share its shape.
 */
const PARAMS: Record<string, unknown[]> = {
  WEEKLY_MOOD_AVERAGES: [START, END],
  MONTHLY_MOOD_AVERAGES: [START, END],
  MONTHLY_DAILY_AVERAGES: [START, END],
  TOTAL_ENTRIES: [],
  EARLIEST_ENTRY_DATE: [],
  MOOD_POINTS_IN_RANGE: [START, END],
  ENTRY_DETAILS_IN_RANGE: [START, END],
  RECENT_ENTRY_DATES: [START],
  DOW_MOOD_PATTERN: [START, END],
  TIME_OF_DAY_PATTERN: [START, END],
  WINDOW_SUMMARY: [START, END],
  ACTIVITY_CORRELATION: [START, END],
  ENTRIES_FOR_ACTIVITY: [ACTIVITY_ID],
  ENTRIES_FOR_ACTIVITY_IN_RANGE: [ACTIVITY_ID, START, END],
  CO_OCCURRING_ACTIVITIES: [ACTIVITY_ID],
  ACTIVITY_ENTRY_COUNTS: [],
};

/**
 * The queries that are scalar AGGREGATES: they always return exactly one row,
 * so "excluded" means every aggregate column in that row is 0 or NULL, not
 * "no rows". Anything else is a row-returning query and must come back empty.
 */
const AGGREGATE_QUERIES = new Set([
  'TOTAL_ENTRIES',
  'EARLIEST_ENTRY_DATE',
  'WINDOW_SUMMARY',
]);

const SCHEMA = `
  CREATE TABLE activity_groups (id INTEGER PRIMARY KEY, name TEXT);
  CREATE TABLE activities (
    id INTEGER PRIMARY KEY, name TEXT, group_id INTEGER,
    icon_family TEXT DEFAULT 'Feather', icon_name TEXT DEFAULT 'circle'
  );
  CREATE TABLE entries (
    id INTEGER PRIMARY KEY, mood REAL, notes TEXT, date TEXT, starred_at TEXT, deleted_at TEXT
  );
  CREATE TABLE entry_activities (id INTEGER PRIMARY KEY, entry_id INTEGER, activity_id INTEGER);
`;

describeIfSqlite('queries.ts — soft-deleted entries are invisible to every read', () => {
  let db: any;

  const sqlExports = Object.entries(queries).filter(
    ([, v]) => typeof v === 'string'
  ) as [string, string][];

  const run = (sql: string, params: unknown[]): any[] =>
    db.prepare(sql).all(...(params as any[]));

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec(SCHEMA);
    db.exec(`INSERT INTO activity_groups (id, name) VALUES (1, 'Sports');`);
    db.exec(`INSERT INTO activities (id, name, group_id) VALUES (1, 'Running', 1), (2, 'Reading', 1);`);
    // ONE entry, LIVE for now, linked to BOTH activities (so the co-occurrence
    // query has something to find) and inside every window used above.
    db.exec(`INSERT INTO entries (id, mood, notes, date) VALUES (1, 7, 'a day', '2026-07-13T10:00:00.000Z');`);
    db.exec(`INSERT INTO entry_activities (entry_id, activity_id) VALUES (1, 1), (1, 2);`);
  });

  afterEach(() => db?.close?.());

  /** Is this result "no data"? Empty rows, or one all-zero/NULL aggregate row. */
  const isEmptyResult = (name: string, rows: any[]): boolean => {
    if (!AGGREGATE_QUERIES.has(name)) return rows.length === 0;
    if (rows.length !== 1) return false;
    return Object.values(rows[0]).every((v) => v === null || v === 0);
  };

  it.each(sqlExports)(
    '%s returns data while the entry is live, and NOTHING once it is binned',
    (name, sql) => {
      const params = PARAMS[name];
      expect(params).toBeDefined();

      // Sanity FIRST: a query that returns nothing even for a live entry would
      // pass the real assertion vacuously — this is the guard against that.
      const live = run(sql, params);
      expect(isEmptyResult(name, live)).toBe(false);

      db.exec(`UPDATE entries SET deleted_at = '2026-08-01T10:00:00.000Z' WHERE id = 1;`);

      const binned = run(sql, params);
      expect(
        isEmptyResult(name, binned)
          ? null
          : `${name} still returned ${binned.length} row(s) for a soft-deleted entry: ` +
              JSON.stringify(binned[0])
      ).toBeNull();
    }
  );

  it('every exported SQL constant is covered by the param table', () => {
    // Class-level guard: a NEW query added to queries.ts fails here until
    // somebody decides (and proves) what it does about the recycle bin.
    const uncovered = sqlExports.map(([n]) => n).filter((n) => !(n in PARAMS));
    expect(uncovered).toEqual([]);
  });

  it('restoring the entry brings every query back (the exclusion is not one-way)', () => {
    db.exec(`UPDATE entries SET deleted_at = '2026-08-01T10:00:00.000Z' WHERE id = 1;`);
    db.exec(`UPDATE entries SET deleted_at = NULL WHERE id = 1;`);
    for (const [name, sql] of sqlExports) {
      expect([name, isEmptyResult(name, run(sql, PARAMS[name]))]).toEqual([name, false]);
    }
  });
});
