/**
 * INTEGRATION test — runs the REAL ENTRIES_FOR_ACTIVITY_IN_RANGE query (the one
 * the mood calendar's activity-dot layer uses) against a REAL SQLite engine and
 * feeds the raw rows through `activityDaySet`, asserting the correct LOCAL days
 * come back. The repo's expo-sqlite jest mock is a no-op stub, so a green tsc +
 * jest says NOTHING about whether the SQL actually runs — this closes that gap
 * for: the entry⋈entry_activities JOIN, the `activity_id = ?` filter, the
 * inclusive `date BETWEEN ?start AND ?end` range boundary, and JS local-day
 * keying of the returned raw UTC instants (all under the Brisbane UTC+10 pin).
 *
 * Uses Node's built-in `node:sqlite` (Node ≥ 22.5) — no new dependency; skips
 * cleanly if the runtime lacks it.
 */
import { ENTRIES_FOR_ACTIVITY_IN_RANGE } from '@/components/visualisations/queries';
import { monthWindowBounds } from '@/components/visualisations/transforms/monthWindow';
import { activityDaySet } from '@/components/visualisations/transforms/activityDays';

let DatabaseSync: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  DatabaseSync = null;
}
const describeIfSqlite = DatabaseSync ? describe : describe.skip;

describeIfSqlite('ENTRIES_FOR_ACTIVITY_IN_RANGE + activityDaySet (real SQLite, Brisbane)', () => {
  let db: any;

  beforeAll(() => {
    db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE activities (id INTEGER PRIMARY KEY, name TEXT, group_id INTEGER);
      CREATE TABLE entries (id INTEGER PRIMARY KEY, mood REAL, notes TEXT, date TEXT);
      CREATE TABLE entry_activities (id INTEGER PRIMARY KEY, entry_id INTEGER, activity_id INTEGER);
    `);
    db.exec(`INSERT INTO activities (id,name,group_id) VALUES (3,'Running',1),(5,'Coffee',1);`);
    // [entryId, mood, dateUTC, activityId]
    const seed: [number, number, string, number][] = [
      [1, 8, '2026-06-30T14:00:00.000Z', 3], // == July start bound -> local Jul 1 (IN, boundary inclusive)
      [2, 7, '2026-07-14T23:00:00.000Z', 3], // local Jul 15 (IN)
      [3, 6, '2026-07-14T23:00:00.000Z', 3], // same local day Jul 15, different entry -> one day key
      [4, 5, '2026-07-31T15:00:00.000Z', 3], // 01:00 Aug 1 local -> AFTER July end bound (OUT of range)
      [5, 9, '2026-07-10T02:00:00.000Z', 5], // Coffee (not Running) -> excluded by activity filter
    ];
    for (const [id, mood, date] of seed)
      db.prepare('INSERT INTO entries (id,mood,notes,date) VALUES (?,?,?,?)').run(id, mood, null, date);
    for (const [id, , , act] of seed)
      db.prepare('INSERT INTO entry_activities (entry_id,activity_id) VALUES (?,?)').run(id, act);
  });

  afterAll(() => db?.close?.());

  const daysFor = (activityId: number, month: { year: number; month: number }): Set<string> => {
    const { start, end } = monthWindowBounds(month);
    const rows = db.prepare(ENTRIES_FOR_ACTIVITY_IN_RANGE).all(activityId, start, end);
    return activityDaySet(rows as { date: string }[]);
  };

  it('returns the LOCAL days Running was logged within July, range-filtered', () => {
    const days = daysFor(3, { year: 2026, month: 7 });
    expect([...days].sort()).toEqual(['2026-07-01', '2026-07-15']);
    // Jul 1 came from an instant stored on Jun 30 UTC (== the inclusive start
    // bound): proves both JS local-day keying AND the `>= start` boundary.
    // Aug 1 (entry 4, 15:00Z Jul 31) is excluded by the July end bound.
    expect(days.has('2026-08-01')).toBe(false);
    expect(days.has('2026-07-31')).toBe(false);
  });

  it('filters by activity_id — Coffee-only days never appear under Running', () => {
    expect(daysFor(3, { year: 2026, month: 7 }).has('2026-07-10')).toBe(false);
    expect([...daysFor(5, { year: 2026, month: 7 })]).toEqual(['2026-07-10']);
  });

  it('an activity with no entries in the window yields an empty set', () => {
    expect(daysFor(3, { year: 2026, month: 9 }).size).toBe(0);
  });
});
