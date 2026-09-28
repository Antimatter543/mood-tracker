// timelineRows.ts
//
// Pure data shaping for the Timeline's FlashList: one flat array of rows (a day
// header followed by that day's entries) built from the date-DESC entry window
// the component holds. Extracted from DBViewer so every rule the list depends on
// — grouping, day summaries, stable keys, recycling types, sticky indices, the
// append de-dupe and the "was something inserted above the user?" test — is unit
// tested in isolation instead of being inferred from a virtualized list that gets
// no layout events under jest.
//
// The component keeps a flat `MoodEntry[]` as its ONE source of truth (the rows on
// screen, newest first). Rows are derived from it with `buildTimelineRows`, so the
// SQL offset for the next page is simply `entries.length` — the same "derive, never
// count separately" rule the 2026-09-13 fix established (tasks/lessons.md).

import type { MoodEntry } from '../types';
import { sectionKeyForDate } from './dateHeader';

/**
 * Rows per SQL page. 50, up from 20: a hard fling on a phone covers several
 * screens a second, and with 20-row pages nearly every fling reached the end of
 * the loaded content and fired a page append mid-gesture. Paired with an early
 * `onEndReachedThreshold`, a 50-row page keeps the prefetch ahead of the finger.
 */
export const TIMELINE_PAGE_SIZE = 50;

/** Summary of ONE local calendar day, shown in its header. */
export type DaySummary = {
    /** Local `YYYY-MM-DD` (see dateHeader.ts) — the group identity. */
    dayKey: string;
    /** Entries on this day that are LOADED. */
    count: number;
    /** Mean mood of those entries, rounded to one decimal; null for none. */
    averageMood: number | null;
    /**
     * False when the day may continue on a page that hasn't loaded yet (it is the
     * LAST day in the window and the window is not the whole result set). Its
     * count and average are then a prefix, not the day — the header must not
     * present them as the day's totals.
     */
    complete: boolean;
};

export type TimelineHeaderRow = { type: 'header'; key: string } & DaySummary;

export type TimelineEntryRow = {
    type: 'entry';
    key: string;
    entry: MoodEntry;
    /** First entry of its day (the rail starts at this node). */
    isFirstOfDay: boolean;
    /** Last loaded entry of its day (the rail ends at this node). */
    isLastOfDay: boolean;
};

export type TimelineRow = TimelineHeaderRow | TimelineEntryRow;

/** Recycling pools. Cells only ever recycle into a cell of the same type. */
export type TimelineRowType = 'header' | 'entry' | 'entry-photos';

export const headerKey = (dayKey: string): string => `day:${dayKey}`;
export const entryKey = (id: number): string => `entry:${id}`;

/** Mean of the moods, one decimal. Non-finite moods are ignored. */
export const averageMood = (entries: readonly MoodEntry[]): number | null => {
    const moods = entries.map((e) => e.mood).filter((m) => Number.isFinite(m));
    if (moods.length === 0) return null;
    const mean = moods.reduce((sum, m) => sum + m, 0) / moods.length;
    return Math.round(mean * 10) / 10;
};

/**
 * Flatten a date-DESC entry window into header + entry rows.
 *
 * Entries arrive ordered by `date DESC, id DESC` (a TOTAL order, see
 * databases/entries.ts), so a day's entries are contiguous; grouping is a single
 * pass that starts a new group whenever the local day key changes. A day key that
 * reappears later (only possible with a corrupt date) starts a second group rather
 * than silently reordering the user's entries — keys stay unique because the
 * second header gets a `#n` suffix.
 *
 * @param mayContinue true while more rows exist past this window (`hasMore`): the
 *   last day may be split across the page boundary, so its summary is marked
 *   incomplete.
 */
export const buildTimelineRows = (
    entries: readonly MoodEntry[],
    mayContinue: boolean
): TimelineRow[] => {
    const groups: { dayKey: string; entries: MoodEntry[] }[] = [];
    for (const entry of entries) {
        const dayKey = sectionKeyForDate(entry.date);
        const last = groups[groups.length - 1];
        if (last && last.dayKey === dayKey) last.entries.push(entry);
        else groups.push({ dayKey, entries: [entry] });
    }

    const seenDays = new Map<string, number>();
    const rows: TimelineRow[] = [];
    groups.forEach((group, groupIndex) => {
        const occurrence = seenDays.get(group.dayKey) ?? 0;
        seenDays.set(group.dayKey, occurrence + 1);
        const isLastGroup = groupIndex === groups.length - 1;
        rows.push({
            type: 'header',
            key: headerKey(occurrence === 0 ? group.dayKey : `${group.dayKey}#${occurrence}`),
            dayKey: group.dayKey,
            count: group.entries.length,
            averageMood: averageMood(group.entries),
            complete: !(isLastGroup && mayContinue),
        });
        group.entries.forEach((entry, i) => {
            rows.push({
                type: 'entry',
                key: entryKey(entry.id),
                entry,
                isFirstOfDay: i === 0,
                isLastOfDay: i === group.entries.length - 1,
            });
        });
    });
    return rows;
};

/** Indices of the header rows — FlashList's `stickyHeaderIndices`. */
export const stickyHeaderIndicesFor = (rows: readonly TimelineRow[]): number[] =>
    rows.reduce<number[]>((acc, row, index) => {
        if (row.type === 'header') acc.push(index);
        return acc;
    }, []);

/**
 * Recycling type of a row. Entries with photos get their own pool: their cell
 * tree differs (an image hero or a thumbnail strip), and recycling a photo cell
 * into a text-only entry — or the reverse — forces a subtree rebuild during the
 * fling, which is exactly the work recycling exists to avoid.
 */
export const rowTypeOf = (row: TimelineRow): TimelineRowType => {
    if (row.type === 'header') return 'header';
    return row.entry.photos && row.entry.photos.length > 0 ? 'entry-photos' : 'entry';
};

/**
 * Append a page to the loaded window, de-duplicated by id.
 *
 * An entry added between two page reads shifts the whole result set down a row,
 * so an OFFSET-based page can hand back a row already on screen; a duplicate id
 * would be a duplicate list key. Returns the SAME array when nothing is new so a
 * no-op append does not re-render the list.
 */
export const appendUnique = (
    loaded: readonly MoodEntry[],
    page: readonly MoodEntry[]
): readonly MoodEntry[] => {
    const seen = new Set(loaded.map((e) => e.id));
    const fresh = page.filter((e) => !seen.has(e.id));
    return fresh.length > 0 ? [...loaded, ...fresh] : loaded;
};

/**
 * Index (in `next`) of the first entry that is NEW relative to `prevIds` AND sits
 * above at least one entry that was already loaded — i.e. an INSERTION into the
 * list (a just-added entry, an undone delete, a bin restore), not a page appended
 * after the end. Returns -1 when there is none.
 *
 * The Timeline uses this to reveal an insertion the user caused while they are
 * near the top: FlashList's content-position maintenance keeps the rows the user
 * is looking at still, which is right when an off-screen row above them changes
 * height and exactly wrong when the row above them is the entry they just made.
 */
export const firstInsertedIndex = (
    prevIds: ReadonlySet<number>,
    next: readonly MoodEntry[]
): number => {
    if (prevIds.size === 0) return -1;
    let candidate = -1;
    for (let i = 0; i < next.length; i++) {
        const known = prevIds.has(next[i].id);
        if (!known && candidate === -1) candidate = i;
        // An already-loaded entry BELOW the new one proves it was inserted, not
        // appended.
        if (known && candidate !== -1) return candidate;
    }
    return -1;
};

/**
 * Should the Timeline scroll back to the top after a refresh, to REVEAL rows that
 * were inserted above the user?
 *
 * FlashList v2 keeps the first visible row still across data changes
 * (`maintainVisibleContentPosition`, on by default). That is what stops a fast
 * fling from "teleporting" the user when rows above them are re-measured — and,
 * left alone, it would also park a just-added entry off-screen above the viewport
 * (the 2026-09-03 bug, when the SectionList carried the same prop). So: when the
 * refresh INSERTED something (see `firstInsertedIndex`), the insertion landed
 * above the row the user was looking at, and the user was near the top anyway
 * (within `nearTop` px), scroll to the top so they see it. A user who is deep in
 * their history keeps their place — the back-to-top pill is one tap away.
 *
 * `firstVisibleKey` is the key of the first visible row BEFORE the update (null
 * when the list has not laid out yet — treated as the very top).
 */
export const shouldRevealInsertion = (args: {
    prevIds: ReadonlySet<number>;
    next: readonly MoodEntry[];
    nextRows: readonly TimelineRow[];
    firstVisibleKey: string | null;
    scrollOffset: number;
    nearTop: number;
}): boolean => {
    const { prevIds, next, nextRows, firstVisibleKey, scrollOffset, nearTop } = args;
    if (scrollOffset > nearTop) return false;
    const inserted = firstInsertedIndex(prevIds, next);
    if (inserted === -1) return false;
    const insertedKey = entryKey(next[inserted].id);
    let insertedRow = nextRows.findIndex((r) => r.key === insertedKey);
    // The first entry of a day brings its header with it, and the header is the
    // row that has to come into view.
    const row = nextRows[insertedRow];
    if (row && row.type === 'entry' && row.isFirstOfDay && insertedRow > 0) insertedRow -= 1;
    const anchorRow =
        firstVisibleKey === null ? 0 : nextRows.findIndex((r) => r.key === firstVisibleKey);
    // The anchor row is gone (e.g. it was a day header replaced by a new one):
    // there is nothing to hold still, so show the top.
    if (anchorRow === -1) return true;
    return insertedRow < anchorRow;
};

/** Content equality of two entries — every field the Timeline renders. */
const sameEntry = (a: MoodEntry, b: MoodEntry): boolean =>
    a.id === b.id &&
    a.mood === b.mood &&
    a.notes === b.notes &&
    a.date === b.date &&
    (a.starred_at ?? null) === (b.starred_at ?? null) &&
    a.activities.length === b.activities.length &&
    a.activities.every((act, i) => {
        const other = b.activities[i];
        return (
            act.id === other.id &&
            act.name === other.name &&
            act.icon_name === other.icon_name &&
            act.icon_family === other.icon_family
        );
    }) &&
    (a.photos?.length ?? 0) === (b.photos?.length ?? 0) &&
    (a.photos ?? []).every((p, i) => {
        const other = b.photos![i];
        return p.id === other.id && p.file_path === other.file_path;
    });

/**
 * Re-use the previous object for every entry whose content did not change.
 *
 * A refresh re-reads the whole loaded window from SQL, which hands back a brand
 * NEW object for every row. `EntryCard` is memoized on its `entry` prop, so fresh
 * objects would re-render every mounted card on every refresh — and a refresh
 * fires after every write anywhere in the app and on every focus. Carrying
 * unchanged entries over by reference makes a refresh cost only the rows that
 * really changed.
 */
export const reuseUnchanged = (
    prev: readonly MoodEntry[],
    next: readonly MoodEntry[]
): MoodEntry[] => {
    const byId = new Map(prev.map((e) => [e.id, e]));
    return next.map((entry) => {
        const old = byId.get(entry.id);
        return old && sameEntry(old, entry) ? old : entry;
    });
};
