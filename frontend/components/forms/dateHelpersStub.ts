/**
 * TEMPORARY local stub for date helpers.
 *
 * A parallel worker is creating the canonical `databases/dateHelpers.ts`
 * with the same API. The parent agent will reconcile imports at merge time.
 * Until then, every form file in this branch imports from here.
 *
 * Why this matters (the bug we're fixing in [[DatePicker]]):
 *   A user picks "March 5 8:00 AM" on a device in UTC-10. The native picker
 *   returns a Date whose local time is 2026-03-05T08:00 but whose UTC
 *   representation is 2026-03-05T18:00Z. Calling `.toISOString()` and storing
 *   that is fine — the round-trip back through `new Date(iso)` lands on the
 *   same moment. The bug is when later code does `date.toISOString().slice(0,10)`
 *   to get a "day key": that produces `'2026-03-05'` in this case (lucky), but
 *   for "March 5 11:00 PM" UTC-10 it produces `'2026-03-06'` — the entry hops
 *   forward a day. We need a *local* day string and a *local* day-boundary
 *   helper for grouping/queries.
 */

/**
 * Returns a YYYY-MM-DD string in the local timezone (NOT UTC).
 * Stable across timezones for the user's perceived "day".
 */
export function localDateString(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/** Returns a new Date set to 00:00:00.000 local time. */
export function startOfLocalDay(date: Date): Date {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}

/** Returns a new Date set to 23:59:59.999 local time. */
export function endOfLocalDay(date: Date): Date {
    const d = new Date(date);
    d.setHours(23, 59, 59, 999);
    return d;
}

/**
 * Returns true if both Dates fall on the same local calendar day.
 * Useful in DatePicker tests to assert the round-trip is day-stable.
 */
export function isSameLocalDay(a: Date, b: Date): boolean {
    return (
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate()
    );
}
