/**
 * Date helpers for the database layer.
 *
 * STORAGE CONTRACT: All mood entry timestamps in the database are stored as
 * ISO-8601 strings in UTC (e.g. `2025-05-19T13:42:00.000Z`). This is what
 * `new Date().toISOString()` returns and what SQLite's `CURRENT_TIMESTAMP`
 * approximates.
 *
 * READ CONTRACT: When you need to bucket entries by "day", you MUST compute
 * day boundaries in the *user's local timezone* and convert to UTC for the
 * SQL query — never rely on SQLite's `date('now')` or `date(entries.date)`
 * because those use UTC and will misattribute entries near midnight.
 *
 * Example: an entry at 2025-05-19T01:30:00Z is on May 19th in UTC but on
 * May 18th in PST (UTC-8). `startOfLocalDay` / `endOfLocalDay` give you the
 * right UTC range for "May 18th in PST".
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
export function startOfLocalDay(date: Date): string {
  const local = new Date(date.getTime());
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
export function endOfLocalDay(date: Date): string {
  const local = new Date(date.getTime());
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
