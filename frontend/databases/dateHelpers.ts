/**
 * Date helpers for the database layer.
 *
 * STORAGE CONTRACT: All mood entry timestamps in the database are stored as
 * ISO-8601 strings in UTC (e.g. `2025-05-19T13:42:00.000Z`). This is what
 * `new Date().toISOString()` returns and what SQLite's `CURRENT_TIMESTAMP`
 * approximates.
 *
 * READ CONTRACT — SQL NEVER day-buckets; JS owns day-keying:
 *   1. RANGE-FILTER entries in SQL using parameterised UTC ISO bounds computed
 *      here in JS (`startOfLocalDay` / `endOfLocalDay`): `WHERE date BETWEEN
 *      ?start AND ?end`. The SET of entries in a window is thus correct.
 *   2. To bucket those entries by "day" (grouping, keying, day-of-week), NEVER
 *      use SQLite's `date()` / `strftime()` on the stored timestamp — those run
 *      in UTC and misattribute entries for any user east/west of UTC. Instead
 *      return the RAW stored instant from SQL and key it in JS via
 *      `localDateString` (or `aggregateDailyAverages` in
 *      components/visualisations/transforms/dailyAverages.ts, which wraps it).
 *      `localDateString` is the ONE day-keying authority in the app.
 *
 * Why this matters: a backdated entry is normalised to LOCAL midnight (e.g.
 * Thursday 00:00 in AEST/UTC+10 = Wednesday 14:00 UTC). SQLite's `date()` would
 * bucket it onto WEDNESDAY; `localDateString` correctly keys it to THURSDAY.
 * The same backdated-entry case is what made the bug invisible in tests until
 * the suite was pinned to a non-UTC timezone (see jest.tz.js).
 *
 * Example: an entry at 2025-05-19T01:30:00Z is on May 19th in UTC but on
 * May 18th in PST (UTC-8). `startOfLocalDay` / `endOfLocalDay` give you the
 * right UTC range for "May 18th in PST"; `localDateString` keys it to May 18th.
 *
 * All functions here are pure and side-effect-free so they can be safely
 * imported into any worker (e.g. the visualisation worker) without pulling
 * in the SQLite runtime.
 */

/**
 * Returns the UTC ISO timestamp for the start of the local-timezone day
 * containing `date` (i.e. 00:00:00.000 local time).
 *
 * Use this as the lower bound of a `WHERE date >= ?` clause when bucketing
 * by user-local day.
 */
export function startOfLocalDay(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const local = new Date(d.getTime());
  local.setHours(0, 0, 0, 0);
  return local.toISOString();
}

/**
 * Returns the UTC ISO timestamp for the end of the local-timezone day
 * containing `date` (i.e. 23:59:59.999 local time).
 *
 * Use this as the upper bound of a `WHERE date <= ?` clause when bucketing
 * by user-local day.
 */
export function endOfLocalDay(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const local = new Date(d.getTime());
  local.setHours(23, 59, 59, 999);
  return local.toISOString();
}

/**
 * Returns the local-timezone date as `YYYY-MM-DD`. Accepts either a Date or
 * an ISO string (which will be parsed and then formatted in local TZ).
 *
 * This is what you'd use as a key when grouping entries by day for display.
 */
export function localDateString(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) {
    throw new Error(`Invalid date passed to localDateString: ${date}`);
  }
  // Use local getters (NOT getUTC*) so the date reflects the user's TZ.
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Returns the integer number of *local-timezone calendar days* between two
 * ISO timestamps. Sign indicates direction (`daysBetween(earlier, later)`
 * is positive).
 *
 * "Calendar days" means we ignore time-of-day — two timestamps one minute
 * apart but on different sides of local midnight count as 1 day apart.
 * This is what users mean when they say "yesterday vs today", and it
 * correctly handles DST transitions where a calendar day is 23 or 25 hours
 * long.
 */
export function daysBetween(a: string, b: string): number {
  const dayA = new Date(localDateString(a) + 'T00:00:00');
  const dayB = new Date(localDateString(b) + 'T00:00:00');
  // Round to handle DST 23h/25h days — the difference will be very close
  // to an integer multiple of 86_400_000 but not exact across DST.
  const MS_PER_DAY = 86_400_000;
  return Math.round((dayB.getTime() - dayA.getTime()) / MS_PER_DAY);
}

/**
 * Returns the default timestamp to assign to a new mood entry when the
 * caller doesn't specify one. Always UTC ISO-8601.
 *
 * Exists as a named export so tests can stub it via `jest.spyOn` and so
 * future requirements (e.g. "round to nearest minute") have a single
 * place to live.
 */
export function getDefaultEntryDate(): string {
  return new Date().toISOString();
}

/**
 * Returns a Date at 00:00:00.000 local time for the same calendar day as
 * `date`. Use this for in-memory picker normalisation (DatePicker) where
 * you need a Date object back, not an ISO string for SQL.
 */
export function startOfLocalDayDate(date: Date): Date {
  const d = new Date(date.getTime());
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Returns a Date at 23:59:59.999 local time for the same calendar day as
 * `date`. In-memory counterpart of `endOfLocalDay`.
 */
export function endOfLocalDayDate(date: Date): Date {
  const d = new Date(date.getTime());
  d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * Returns true if both Dates land on the same local calendar day. Useful
 * for asserting day-stable round trips (e.g. the DatePicker normalisation
 * never crosses a UTC boundary).
 */
export function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Returns the date `days` days after the YYYY-MM-DD string `date`. Negative
 * `days` walks backwards. Operates in local time so DST 23h/25h days don't
 * accidentally roll the calendar.
 */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const result = new Date(y, m - 1, d);
  result.setDate(result.getDate() + days);
  return localDateString(result);
}
