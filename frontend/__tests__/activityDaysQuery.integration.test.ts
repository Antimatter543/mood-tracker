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
 * It runs against the ACTUAL window the app fetches — `gridWindowBounds` (the
 * whole week-aligned rendered grid, not just the calendar month) — so it also
 * covers the Bug A fix: entries on the LEADING/TRAILING adjacent-month cells the
 * grid renders (Jun 30 / Aug 1 inside July's grid) ARE returned, while days just
 * outside the grid edge are excluded.
 *
 * Uses Node's built-in `node:sqlite` (Node ≥ 22.5) — no new dependency; skips
 * cleanly if the runtime lacks it.
 */
import { ENTRIES_FOR_ACTIVITY_IN_RANGE } from '@/components/visualisations/queries';
import { gridWindowBounds } from '@/components/visualisations/transforms/monthWindow';
import { activityDaySet } from '@/components/visualisations/transforms/activityDays';

let DatabaseSync: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  DatabaseSync = null;
}
const describeIfSqlite = DatabaseSync ? describe : describe.skip;

// July 2026's rendered grid (Monday-first) spans local Jun 29 .. Aug 2 — its
// first row leads with Jun 29/30, its last row trails into Aug 1/2.
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
      [1, 8, '2026-06-30T14:00:00.000Z', 3], // 14:00Z Jun 30 -> local Jul 1 (JS local-keying across the UTC day)
      [2, 7, '2026-07-14T23:00:00.000Z', 3], // local Jul 15 (IN)
      [3, 6, '2026-07-14T23:00:00.000Z', 3], // same local Jul 15, different entry -> one day key
      [4, 5, '2026-07-31T15:00:00.000Z', 3], // 15:00Z Jul 31 -> local Aug 1 -> TRAILING spill-over IN July's grid
      [5, 9, '2026-07-10T02:00:00.000Z', 5], // Coffee (not Running) -> excluded by activity filter
      [6, 4, '2026-06-29T14:00:00.000Z', 3], // 14:00Z Jun 29 -> local Jun 30 -> LEADING spill-over IN July's grid
      [7, 3, '2026-06-28T13:00:00.000Z', 3], // 13:00Z Jun 28 -> local Jun 28 (23:00) -> BEFORE grid start -> OUT
      [8, 2, '2026-08-02T14:00:00.000Z', 3], // 14:00Z Aug 2 -> local Aug 3 (00:00) -> AFTER grid end -> OUT
    ];
    for (const [id, mood, date] of seed)
      db.prepare('INSERT INTO entries (id,mood,notes,date) VALUES (?,?,?,?)').run(id, mood, null, date);
    for (const [id, , , act] of seed)
      db.prepare('INSERT INTO entry_activities (entry_id,activity_id) VALUES (?,?)').run(id, act);
  });

  afterAll(() => db?.close?.());

  const daysFor = (activityId: number, month: { year: number; month: number }): Set<string> => {
    const { start, end } = gridWindowBounds(month);
    const rows = db.prepare(ENTRIES_FOR_ACTIVITY_IN_RANGE).all(activityId, start, end);
    return activityDaySet(rows as { date: string }[]);
  };

  it('returns Running days across the WHOLE rendered grid, incl. adjacent-month spill-over', () => {
    const days = daysFor(3, { year: 2026, month: 7 });
    expect([...days].sort()).toEqual([
      '2026-06-30', // LEADING spill-over (adjacent June) — the Bug A cell
      '2026-07-01',
      '2026-07-15',
      '2026-08-01', // TRAILING spill-over (adjacent August)
    ]);
  });

  it('the adjacent-month spill-over days the grid draws ARE fetched (Bug A)', () => {
    const days = daysFor(3, { year: 2026, month: 7 });
    expect(days.has('2026-06-30')).toBe(true); // leading cell in July's first row
    expect(days.has('2026-08-01')).toBe(true); // trailing cell in July's last row
  });

  it('days JUST outside the grid edges are excluded (BETWEEN boundary)', () => {
    const days = daysFor(3, { year: 2026, month: 7 });
    expect(days.has('2026-06-28')).toBe(false); // before the grid start (Jun 29)
    expect(days.has('2026-08-03')).toBe(false); // after the grid end (Aug 2)
  });

  it('filters by activity_id — Coffee-only days never appear under Running', () => {
    expect(daysFor(3, { year: 2026, month: 7 }).has('2026-07-10')).toBe(false);
    expect([...daysFor(5, { year: 2026, month: 7 })]).toEqual(['2026-07-10']);
  });

  it('an activity with no entries in the grid window yields an empty set', () => {
    expect(daysFor(3, { year: 2026, month: 11 }).size).toBe(0);
  });
});
