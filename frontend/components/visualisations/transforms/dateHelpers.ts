// dateHelpers.ts
//
// Local-timezone date helpers used by the visualisations layer.
//
// IMPORTANT: All queries that previously used SQLite's `date('now')` treated
// "today" as UTC. For a user in UTC+10, an entry made at 11pm local time
// would be stored as 1pm UTC the next day relative to the user's expected
// local "today" window — silently dropping it from "this week" charts.
//
// These helpers compute window boundaries in the user's *local* timezone
// and emit ISO-like strings the SQL layer compares as TEXT.
//
// NOTE: The parallel DB worktree is creating `databases/dateHelpers.ts` with
// the same surface. If/when that lands, this file becomes a re-export. For
// now we stub locally so the visualisations transforms can be tested and
// shipped independently.

/**
 * Returns the local-date portion of a Date as "YYYY-MM-DD".
 * Uses local timezone components, NOT toISOString() (which is UTC).
 */
export const localDateString = (d: Date | string): string => {
    const date = typeof d === 'string' ? new Date(d) : d;
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};

/**
 * Returns the local start-of-day for the given date, as an SQLite-comparable
 * datetime string ("YYYY-MM-DD 00:00:00").
 *
 * Entries in the `entries` table are stored as ISO-8601 datetimes; comparing
 * against "YYYY-MM-DD HH:MM:SS" works because both are lexicographically
 * comparable when zero-padded.
 */
export const startOfLocalDay = (d: Date | string): string => {
    return `${localDateString(d)} 00:00:00`;
};

/**
 * Returns the local end-of-day for the given date, as an SQLite-comparable
 * datetime string ("YYYY-MM-DD 23:59:59").
 */
export const endOfLocalDay = (d: Date | string): string => {
    return `${localDateString(d)} 23:59:59`;
};

/**
 * Number of whole calendar days between two local-date strings.
 * Positive when `b` is after `a`. Operates on the DATE part only so it is
 * unaffected by DST jumps within a day.
 *
 * @example daysBetween('2025-01-01', '2025-01-05') === 4
 */
export const daysBetween = (a: string, b: string): number => {
    // Parse as UTC midnights to avoid DST off-by-one when the two dates
    // straddle a DST boundary in the local zone.
    const da = new Date(`${a}T00:00:00Z`).getTime();
    const db = new Date(`${b}T00:00:00Z`).getTime();
    return Math.round((db - da) / (24 * 60 * 60 * 1000));
};

/**
 * Returns a new local-date string offset by `days` from the given date.
 * Negative values go backwards.
 *
 * @example addDays('2025-01-05', -2) === '2025-01-03'
 */
export const addDays = (date: string, days: number): string => {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return localDateString(
        new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
    );
};
