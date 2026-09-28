/**
 * The Timeline's row model (components/timeline/timelineRows.ts): everything the
 * FlashList depends on, tested as pure functions because under jest a
 * virtualized list gets no layout events and its rendering proves nothing.
 *
 * The contracts that matter most:
 *   - grouping is by LOCAL day, contiguous, with unique keys (duplicate keys break
 *     FlashList's key-anchored position maintenance and its recycling);
 *   - a day that may continue on the next page never presents a partial count as
 *     the day's total;
 *   - an append is de-duplicated and a no-op append returns the SAME array;
 *   - `shouldRevealInsertion` fires for a row inserted above the viewport near
 *     the top, and NOT for appends, same-day inserts under the visible header,
 *     or a user deep in their history;
 *   - a refresh re-uses unchanged entry objects (memoized cards bail out).
 */
import {
    TIMELINE_PAGE_SIZE,
    appendUnique,
    averageMood,
    buildTimelineRows,
    entryKey,
    firstInsertedIndex,
    headerKey,
    reuseUnchanged,
    rowTypeOf,
    shouldRevealInsertion,
    stickyHeaderIndicesFor,
    TimelineRow,
} from '@/components/timeline/timelineRows';
import type { MoodEntry } from '@/components/types';

// Local-noon timestamps so the day key never depends on the test TZ offset
// (jest.tz.js pins a non-UTC zone on purpose).
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h, 0, 0).toISOString();

const entry = (id: number, date: string, over: Partial<MoodEntry> = {}): MoodEntry => ({
    id,
    mood: 5,
    notes: '',
    date,
    activities: [],
    photos: [],
    starred_at: null,
    ...over,
});

const ids = (rows: TimelineRow[]) =>
    rows.map((r) => (r.type === 'header' ? `H${r.dayKey}` : `E${r.entry.id}`));

describe('buildTimelineRows — grouping', () => {
    it('returns no rows for no entries (the empty-DB path)', () => {
        expect(buildTimelineRows([], false)).toEqual([]);
        expect(buildTimelineRows([], true)).toEqual([]);
    });

    it('emits a header before each local day, then that day\'s entries in order', () => {
        const rows = buildTimelineRows(
            [
                entry(5, at(2026, 9, 28, 20)),
                entry(4, at(2026, 9, 28, 9)),
                entry(3, at(2026, 9, 27, 18)),
                entry(2, at(2026, 9, 25, 8)),
                entry(1, at(2026, 9, 25, 7)),
            ],
            false
        );
        expect(ids(rows)).toEqual([
            'H2026-09-28', 'E5', 'E4',
            'H2026-09-27', 'E3',
            'H2026-09-25', 'E2', 'E1',
        ]);
    });

    it('buckets by the LOCAL calendar day, not the UTC date string', () => {
        // 00:30 local is the previous day in UTC for any zone east of UTC, and
        // 23:30 local is the next day for any zone west of it; both must stay on
        // their local day.
        const early = new Date(2026, 8, 28, 0, 30).toISOString();
        const late = new Date(2026, 8, 28, 23, 30).toISOString();
        const rows = buildTimelineRows([entry(2, late), entry(1, early)], false);
        expect(ids(rows)).toEqual(['H2026-09-28', 'E2', 'E1']);
    });

    it('marks first/last of each day for the rail', () => {
        const rows = buildTimelineRows(
            [entry(3, at(2026, 9, 28, 20)), entry(2, at(2026, 9, 28, 9)), entry(1, at(2026, 9, 27))],
            false
        );
        const flags = rows
            .filter((r) => r.type === 'entry')
            .map((r: any) => [r.entry.id, r.isFirstOfDay, r.isLastOfDay]);
        expect(flags).toEqual([
            [3, true, false],
            [2, false, true],
            [1, true, true],
        ]);
    });

    it('gives every row a unique key, even if a day reappears (corrupt ordering)', () => {
        const rows = buildTimelineRows(
            [entry(3, at(2026, 9, 28)), entry(2, at(2026, 9, 27)), entry(1, at(2026, 9, 28, 8))],
            false
        );
        const keys = rows.map((r) => r.key);
        expect(new Set(keys).size).toBe(keys.length);
        // The user's order is preserved (never silently regrouped).
        expect(ids(rows)).toEqual(['H2026-09-28', 'E3', 'H2026-09-27', 'E2', 'H2026-09-28', 'E1']);
        expect(keys[0]).toBe(headerKey('2026-09-28'));
        expect(keys[4]).toBe(headerKey('2026-09-28#1'));
    });

    it('keys entries by id and headers by day, so keys survive a regroup', () => {
        const a = buildTimelineRows([entry(2, at(2026, 9, 28)), entry(1, at(2026, 9, 27))], true);
        const b = buildTimelineRows(
            [entry(3, at(2026, 9, 29)), entry(2, at(2026, 9, 28)), entry(1, at(2026, 9, 27))],
            true
        );
        const keysA = a.map((r) => r.key);
        const keysB = b.map((r) => r.key);
        for (const k of keysA) expect(keysB).toContain(k);
        expect(keysB).toContain(entryKey(3));
    });

    it('never splits a very large window into anything but contiguous day runs', () => {
        // 5 entries a day for a full page and a half: every header must be
        // followed by exactly that day's entries.
        const many = Array.from({ length: Math.floor(TIMELINE_PAGE_SIZE * 1.5) }, (_, i) =>
            entry(1000 - i, at(2026, 9, 28 - Math.floor(i / 5), 20 - (i % 5)))
        );
        const rows = buildTimelineRows(many, false);
        const headers = rows.filter((r) => r.type === 'header');
        expect(new Set(headers.map((h: any) => h.dayKey)).size).toBe(headers.length);
        expect(headers.every((h: any) => h.count === 5)).toBe(true);
        expect(rows.filter((r) => r.type === 'entry')).toHaveLength(many.length);
    });
});

describe('buildTimelineRows — day summaries', () => {
    it('counts the day and averages its mood to one decimal', () => {
        const rows = buildTimelineRows(
            [
                entry(3, at(2026, 9, 28, 20), { mood: 8 }),
                entry(2, at(2026, 9, 28, 9), { mood: 5 }),
                entry(1, at(2026, 9, 28, 8), { mood: 6 }),
            ],
            false
        );
        const header: any = rows[0];
        expect(header.count).toBe(3);
        expect(header.averageMood).toBe(6.3); // 19/3 = 6.333...
        expect(header.complete).toBe(true);
    });

    it('averageMood ignores non-finite moods and is null for none', () => {
        expect(averageMood([])).toBeNull();
        expect(averageMood([entry(1, at(2026, 1, 1), { mood: NaN })])).toBeNull();
        expect(
            averageMood([entry(1, at(2026, 1, 1), { mood: 7.5 }), entry(2, at(2026, 1, 1), { mood: NaN })])
        ).toBe(7.5);
    });

    it('marks ONLY the last day incomplete while more pages exist', () => {
        const entries = [entry(3, at(2026, 9, 28)), entry(2, at(2026, 9, 27)), entry(1, at(2026, 9, 26))];
        const more = buildTimelineRows(entries, true).filter((r) => r.type === 'header') as any[];
        expect(more.map((h) => h.complete)).toEqual([true, true, false]);
        const done = buildTimelineRows(entries, false).filter((r) => r.type === 'header') as any[];
        expect(done.every((h) => h.complete)).toBe(true);
    });
});

describe('list plumbing', () => {
    const rows = buildTimelineRows(
        [
            entry(3, at(2026, 9, 28), {
                photos: [{ id: 1, entry_id: 3, file_path: 'file:///a.jpg', media_type: 'image' }],
            }),
            entry(2, at(2026, 9, 28, 9)),
            entry(1, at(2026, 9, 27)),
        ],
        false
    );

    it('sticky indices are exactly the header rows', () => {
        expect(stickyHeaderIndicesFor(rows)).toEqual([0, 3]);
    });

    it('recycles photo entries in their own pool', () => {
        expect(rows.map(rowTypeOf)).toEqual(['header', 'entry-photos', 'entry', 'header', 'entry']);
    });
});

describe('appendUnique', () => {
    const loaded = [entry(3, at(2026, 9, 28)), entry(2, at(2026, 9, 27))];

    it('appends new rows and drops ones already on screen', () => {
        const next = appendUnique(loaded, [entry(2, at(2026, 9, 27)), entry(1, at(2026, 9, 26))]);
        expect(next.map((e) => e.id)).toEqual([3, 2, 1]);
    });

    it('returns the SAME array when the page brought nothing new (no re-render)', () => {
        expect(appendUnique(loaded, [entry(3, at(2026, 9, 28))])).toBe(loaded);
        expect(appendUnique(loaded, [])).toBe(loaded);
    });
});

describe('firstInsertedIndex', () => {
    const known = new Set([3, 2, 1]);
    const list = (...idsNewestFirst: number[]) => idsNewestFirst.map((id) => entry(id, at(2026, 9, 1)));

    it('finds an insertion at the top', () => {
        expect(firstInsertedIndex(known, list(9, 3, 2, 1))).toBe(0);
    });

    it('finds an insertion in the middle', () => {
        expect(firstInsertedIndex(known, list(3, 9, 2, 1))).toBe(1);
    });

    it('does NOT treat a page appended after the end as an insertion', () => {
        expect(firstInsertedIndex(known, list(3, 2, 1, 9, 8))).toBe(-1);
    });

    it('is -1 for a first load (nothing was known) and for no change', () => {
        expect(firstInsertedIndex(new Set(), list(3, 2, 1))).toBe(-1);
        expect(firstInsertedIndex(known, list(3, 2, 1))).toBe(-1);
    });
});

describe('shouldRevealInsertion', () => {
    const yesterday = [entry(2, at(2026, 9, 27, 18)), entry(1, at(2026, 9, 27, 9))];
    const prevIds = new Set([2, 1]);
    const prevRows = buildTimelineRows(yesterday, false);

    const decide = (next: MoodEntry[], firstVisibleKey: string | null, scrollOffset: number) =>
        shouldRevealInsertion({
            prevIds,
            next,
            nextRows: buildTimelineRows(next, false),
            firstVisibleKey,
            scrollOffset,
            nearTop: 800,
        });

    it('reveals a new DAY inserted above the visible header when the user is at the top', () => {
        // Content-position maintenance would hold "yesterday" still and push the
        // new "today" group above the viewport — the 2026-09-03 bug.
        const next = [entry(3, at(2026, 9, 28, 8)), ...yesterday];
        expect(decide(next, prevRows[0].key, 0)).toBe(true);
    });

    it('reveals an insertion above the first visible ENTRY within the first screen', () => {
        const next = [entry(3, at(2026, 9, 27, 20)), ...yesterday];
        // The user scrolled a little: the first visible row is entry 2.
        expect(decide(next, entryKey(2), 300)).toBe(true);
    });

    it('does NOT scroll for an insertion under the visible header (it shows in place)', () => {
        const next = [entry(3, at(2026, 9, 27, 20)), ...yesterday];
        expect(decide(next, prevRows[0].key, 0)).toBe(false);
    });

    it('does NOT scroll a user who is deep in their history', () => {
        const next = [entry(3, at(2026, 9, 28, 8)), ...yesterday];
        expect(decide(next, prevRows[0].key, 801)).toBe(false);
    });

    it('does NOT scroll for an insertion BELOW the first visible row', () => {
        const older = [...yesterday, entry(0, at(2026, 9, 20))];
        const next = [yesterday[0], entry(5, at(2026, 9, 27, 12)), yesterday[1], older[2]];
        const ids0 = new Set([2, 1, 0]);
        expect(
            shouldRevealInsertion({
                prevIds: ids0,
                next,
                nextRows: buildTimelineRows(next, false),
                firstVisibleKey: entryKey(2),
                scrollOffset: 100,
                nearTop: 800,
            })
        ).toBe(false);
    });

    it('does nothing when nothing was inserted (a plain refresh, an append)', () => {
        expect(decide([...yesterday], prevRows[0].key, 0)).toBe(false);
        expect(decide([...yesterday, entry(0, at(2026, 9, 20))], prevRows[0].key, 0)).toBe(false);
    });

    it('shows the top when the anchor row is gone', () => {
        const next = [entry(3, at(2026, 9, 28, 8)), yesterday[1]];
        expect(decide(next, entryKey(2), 100)).toBe(true);
    });
});

describe('reuseUnchanged', () => {
    const act = { id: 7, group_id: 1, name: 'Walk', icon_name: 'walk', icon_family: 'MaterialCommunityIcons' as any, position: 0 };
    const prev = [
        entry(2, at(2026, 9, 28), { notes: 'a', activities: [act] }),
        entry(1, at(2026, 9, 27), { photos: [{ id: 4, entry_id: 1, file_path: 'file:///p.jpg', media_type: 'image' }] }),
    ];
    const fresh = () => JSON.parse(JSON.stringify(prev)) as MoodEntry[];

    it('keeps the previous object for every unchanged entry', () => {
        const next = reuseUnchanged(prev, fresh());
        expect(next[0]).toBe(prev[0]);
        expect(next[1]).toBe(prev[1]);
    });

    it.each([
        ['mood', (e: MoodEntry) => ({ ...e, mood: 9 })],
        ['notes', (e: MoodEntry) => ({ ...e, notes: 'changed' })],
        ['date', (e: MoodEntry) => ({ ...e, date: at(2026, 9, 26) })],
        ['starred_at', (e: MoodEntry) => ({ ...e, starred_at: '2026-09-28T00:00:00.000Z' })],
        ['activities', (e: MoodEntry) => ({ ...e, activities: [] })],
        ['activity rename', (e: MoodEntry) => ({ ...e, activities: [{ ...act, name: 'Run' }] })],
        ['photos', (e: MoodEntry) => ({ ...e, photos: [{ id: 9, entry_id: 2, file_path: 'file:///q.jpg', media_type: 'image' }] })],
    ])('hands over a NEW object when %s changed', (_label, change) => {
        const next = fresh();
        next[0] = change(next[0]);
        const out = reuseUnchanged(prev, next);
        expect(out[0]).not.toBe(prev[0]);
        expect(out[0]).toEqual(next[0]);
        expect(out[1]).toBe(prev[1]);
    });

    it('treats null and undefined starred_at as the same (not starred)', () => {
        const next = fresh();
        delete (next[0] as any).starred_at;
        expect(reuseUnchanged(prev, next)[0]).toBe(prev[0]);
    });
});
