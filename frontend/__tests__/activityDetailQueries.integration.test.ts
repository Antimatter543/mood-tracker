/**
 * INTEGRATION test — runs the REAL ENTRIES_FOR_ACTIVITY /
 * ENTRIES_FOR_ACTIVITY_IN_RANGE / CO_OCCURRING_ACTIVITIES / ACTIVITY_ENTRY_COUNTS
 * query strings from queries.ts against a REAL SQLite engine (Node's built-in
 * `node:sqlite`, Node ≥ 22.5) with known seed rows.
 *
 * Why on top of the transform unit tests: the repo's `expo-sqlite` jest mock is
 * a no-op stub that never executes SQL, so a green jest proves NOTHING about
 * whether these joins actually select/aggregate the right rows — the self-join
 * `activity_id <> ...` exclusion, the co-occurrence COUNT/GROUP BY ordering, the
 * range filter's bind order. This executes them for real. Skips cleanly if the
 * runtime lacks node:sqlite.
 */
import {
    ENTRIES_FOR_ACTIVITY,
    ENTRIES_FOR_ACTIVITY_IN_RANGE,
    CO_OCCURRING_ACTIVITIES,
    ACTIVITY_ENTRY_COUNTS,
} from '@/components/visualisations/queries';

let DatabaseSync: any = null;
try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ({ DatabaseSync } = require('node:sqlite'));
} catch {
    DatabaseSync = null;
}
const describeIfSqlite = DatabaseSync ? describe : describe.skip;

describeIfSqlite('per-activity detail queries — real SQLite execution', () => {
    let db: any;

    beforeAll(() => {
        db = new DatabaseSync(':memory:');
        db.exec(`
            CREATE TABLE activities (
                id INTEGER PRIMARY KEY, name TEXT, group_id INTEGER,
                icon_family TEXT, icon_name TEXT, position INTEGER
            );
            CREATE TABLE entries (id INTEGER PRIMARY KEY, mood REAL, notes TEXT, date TEXT);
            CREATE TABLE entry_activities (id INTEGER PRIMARY KEY, entry_id INTEGER, activity_id INTEGER);
        `);
        db.exec(`INSERT INTO activities (id,name,group_id,icon_family,icon_name,position) VALUES
            (1,'Running',1,'Feather','activity',1),
            (2,'Work',1,'Feather','briefcase',2),
            (3,'Gym',1,'MaterialCommunityIcons','dumbbell',3),
            (4,'Reading',1,'Feather','book',4);`);

        // [entryId, mood, dateISO, activityIds]
        const seed: [number, number, string, number[]][] = [
            [1, 4, '2026-06-01T09:00:00Z', [1]],       // Running
            [2, 8, '2026-06-02T09:00:00Z', [1, 3]],    // Running + Gym
            [3, 3, '2026-06-03T09:00:00Z', [1, 3]],    // Running + Gym
            [4, 6, '2026-06-04T09:00:00Z', [2]],       // Work
            [5, 9, '2026-06-05T09:00:00Z', [1, 2]],    // Running + Work
            [6, 5, '2026-06-06T09:00:00Z', [4]],       // Reading
        ];
        for (const [id, mood, date] of seed)
            db.prepare('INSERT INTO entries (id,mood,notes,date) VALUES (?,?,?,?)').run(id, mood, null, date);
        for (const [id, , , acts] of seed)
            for (const aid of acts)
                db.prepare('INSERT INTO entry_activities (entry_id,activity_id) VALUES (?,?)').run(id, aid);
    });

    afterAll(() => db?.close?.());

    it('ENTRIES_FOR_ACTIVITY returns exactly the activity\'s entries, oldest→newest', () => {
        const rows = db.prepare(ENTRIES_FOR_ACTIVITY).all(1); // Running
        expect(rows.map((r: any) => r.id)).toEqual([1, 2, 3, 5]);
        expect(rows.map((r: any) => r.mood)).toEqual([4, 8, 3, 9]);
        // Reading's lone entry is excluded.
        expect(db.prepare(ENTRIES_FOR_ACTIVITY).all(4).map((r: any) => r.id)).toEqual([6]);
    });

    it('ENTRIES_FOR_ACTIVITY_IN_RANGE range-filters on the raw instant', () => {
        // Running entries between Jun 2 and Jun 5 inclusive → ids 2,3,5 (not 1).
        const rows = db
            .prepare(ENTRIES_FOR_ACTIVITY_IN_RANGE)
            .all(1, '2026-06-02T00:00:00Z', '2026-06-05T23:59:59Z');
        expect(rows.map((r: any) => r.id)).toEqual([2, 3, 5]);
    });

    it('CO_OCCURRING_ACTIVITIES ranks other activities by shared entries, excluding itself', () => {
        // Running shares entries with Gym (E2,E3 → 2) and Work (E5 → 1). Running
        // itself and never-paired Reading must not appear.
        const rows = db.prepare(CO_OCCURRING_ACTIVITIES).all(1);
        expect(rows.map((r: any) => ({ id: r.id, name: r.name, n: r.n }))).toEqual([
            { id: 3, name: 'Gym', n: 2 },
            { id: 2, name: 'Work', n: 1 },
        ]);
        // icon columns come through for glyph rendering.
        expect(rows[0].icon_family).toBe('MaterialCommunityIcons');
        expect(rows[0].icon_name).toBe('dumbbell');
    });

    it('CO_OCCURRING_ACTIVITIES is empty for a never-paired activity', () => {
        expect(db.prepare(CO_OCCURRING_ACTIVITIES).all(4)).toEqual([]); // Reading
    });

    it('ACTIVITY_ENTRY_COUNTS counts entries per activity', () => {
        const rows = db.prepare(ACTIVITY_ENTRY_COUNTS).all();
        const byId = new Map(rows.map((r: any) => [r.activity_id, r.n]));
        expect(byId.get(1)).toBe(4); // Running
        expect(byId.get(2)).toBe(2); // Work
        expect(byId.get(3)).toBe(2); // Gym
        expect(byId.get(4)).toBe(1); // Reading
    });
});
