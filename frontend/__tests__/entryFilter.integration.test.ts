/**
 * INTEGRATION test — runs the REAL `buildEntryFilter` output inside the EXACT
 * Timeline CTE against a REAL SQLite engine, with known seed rows, and asserts
 * the right entries come back.
 *
 * Why this exists on top of `entryFilter.test.ts`: that suite locks the WHERE
 * *string* buildEntryFilter emits; the repo's `expo-sqlite` jest mock is a stub
 * that never executes SQL, so nothing else proves the string actually RUNS
 * correctly — correlated-EXISTS alias scoping (`ea2`/`a2` vs the outer `ea`/`a`),
 * param-bind order when the filter params precede LIMIT/OFFSET, `LIKE ? ESCAPE`
 * for literal `%`, `mood BETWEEN`, NULL-notes matching via activity, and
 * newest-first ordering. Uses Node's built-in `node:sqlite` (Node ≥ 22.5) — no
 * new dependency. If the runtime lacks it, the suite skips cleanly rather than
 * failing CI.
 *
 * INVARIANT: the `PAGE_QUERY` below MUST mirror `DBViewer.fetchEntriesPage`'s
 * CTE (same FROM/JOINs, the `${where && 'WHERE '+where}` splice BEFORE GROUP BY,
 * and `[...params, LIMIT, OFFSET]` bind order). If that query changes, update
 * this mirror.
 */
import { buildEntryFilter, moodPresetToRange, EntryFilters, MoodRange } from '@/components/timeline/entryFilter';

// Load Node's built-in SQLite; skip the whole suite if unavailable (e.g. Node < 22.5).
let DatabaseSync: any = null;
try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ({ DatabaseSync } = require('node:sqlite'));
} catch {
    DatabaseSync = null;
}
const describeIfSqlite = DatabaseSync ? describe : describe.skip;

const ITEMS_PER_PAGE = 20;

// Mirror of DBViewer.fetchEntriesPage's CTE (activity columns trimmed to the
// `name` GROUP_CONCAT needed to assert identity; the filterable shape is exact).
const pageQuery = (where: string) => `
    WITH EntryData AS (
        SELECT e.id, e.mood, e.notes, e.date,
               GROUP_CONCAT(a.name) as activity_names
        FROM entries e
        LEFT JOIN entry_activities ea ON e.id = ea.entry_id
        LEFT JOIN activities a ON ea.activity_id = a.id
        ${where ? 'WHERE ' + where : ''}
        GROUP BY e.id
        ORDER BY e.date DESC
        LIMIT ? OFFSET ?
    )
    SELECT * FROM EntryData`;

const F = (query = '', moodRange: MoodRange | null = null): EntryFilters => ({ query, moodRange });

describeIfSqlite('entryFilter — real SQLite execution', () => {
    let db: any;
    const idsFor = (filters: EntryFilters, page = 0): number[] => {
        const { where, params } = buildEntryFilter(filters);
        const rows = db
            .prepare(pageQuery(where))
            .all(...params, ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);
        return rows.map((r: any) => r.id).sort((a: number, b: number) => a - b);
    };

    beforeAll(() => {
        db = new DatabaseSync(':memory:');
        db.exec(`
            CREATE TABLE activities (id INTEGER PRIMARY KEY, name TEXT, group_id INTEGER);
            CREATE TABLE entries (id INTEGER PRIMARY KEY, mood REAL, notes TEXT, date TEXT);
            CREATE TABLE entry_activities (id INTEGER PRIMARY KEY, entry_id INTEGER, activity_id INTEGER);
        `);
        db.exec(`INSERT INTO activities (id,name,group_id) VALUES
            (1,'Running',1),(2,'Work',1),(3,'Gym',1),(4,'Reading',1),(5,'50% Sale',1);`);
        // [id, mood, notes, date, activityIds]
        const seed: [number, number, string | null, string, number[]][] = [
            [1, 2,   'Felt tired after work',       '2026-07-01T09:00:00Z', [1]],
            [2, 8,   'Great day overall',           '2026-07-02T09:00:00Z', [2, 3]],
            [3, 5,   null,                          '2026-07-03T09:00:00Z', [4]],
            [4, 9,   'Bought at 50% off, big win',  '2026-07-04T09:00:00Z', []],
            [5, 3.5, 'boundary case',               '2026-07-05T09:00:00Z', []],
            [6, 4,   'boundary case two',           '2026-07-06T09:00:00Z', []],
        ];
        for (const [id, mood, notes, date] of seed)
            db.prepare('INSERT INTO entries (id,mood,notes,date) VALUES (?,?,?,?)').run(id, mood, notes, date);
        for (const [id, , , , acts] of seed)
            for (const aid of acts)
                db.prepare('INSERT INTO entry_activities (entry_id,activity_id) VALUES (?,?)').run(id, aid);
    });

    afterAll(() => db?.close?.());

    it('no filter returns every entry, newest-first (order + no stray WHERE)', () => {
        const { where, params } = buildEntryFilter(F());
        expect(where).toBe('');
        const ordered = db.prepare(pageQuery(where)).all(...params, ITEMS_PER_PAGE, 0).map((r: any) => r.id);
        expect(ordered).toEqual([6, 5, 4, 3, 2, 1]);
    });

    it('notes-text match includes the entry', () => {
        expect(idsFor(F('tired'))).toEqual([1]);
    });

    it('activity-name match includes the entry (OR notes), case-insensitively', () => {
        // "work" hits E1's note ("after work") AND E2's activity ("Work").
        expect(idsFor(F('work'))).toEqual([1, 2]);
        expect(idsFor(F('GYM'))).toEqual([2]);
    });

    it('matches via activity even when notes are NULL', () => {
        expect(idsFor(F('reading'))).toEqual([3]); // E3 has NULL notes
    });

    it('a query with no matches returns empty (drives the "no matches" state)', () => {
        expect(idsFor(F('zzzzzq'))).toEqual([]);
    });

    it('escapes a literal % so it is not a wildcard', () => {
        // Must match ONLY E4 ("50% off"), never every row.
        expect(idsFor(F('50%'))).toEqual([4]);
    });

    it('mood-band presets filter by the numeric range, boundaries included', () => {
        // Honest bands: Low 0–3, Mid 3.5–6.5, High 7–10. A 3.5 entry (E5) now
        // falls in Mid, NOT Low — the bug this fix closes.
        expect(idsFor(F('', moodPresetToRange('low')))).toEqual([1]);       // mood 2 only (E5's 3.5 moved to Mid)
        expect(idsFor(F('', moodPresetToRange('mid')))).toEqual([3, 5, 6]); // 5, 3.5, 4
        expect(idsFor(F('', moodPresetToRange('high')))).toEqual([2, 4]);   // 8, 9
    });

    it('combines text AND mood (both constraints apply)', () => {
        expect(idsFor(F('day', moodPresetToRange('high')))).toEqual([2]); // note "day" & mood 8
        // Both boundary entries carry "case"; under the honest bands E5(3.5) & E6(4)
        // land in Mid [3.5–6.5], and NEITHER falls in Low (0–3) — regression guard.
        expect(idsFor(F('case', moodPresetToRange('mid')))).toEqual([5, 6]);
        expect(idsFor(F('case', moodPresetToRange('low')))).toEqual([]);
    });
});
