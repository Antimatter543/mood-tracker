// dateHeader.ts
//
// Pure helpers for the Timeline's date-group section headers. Extracted from
// DBViewer so the labelling logic (group key + humanized title) is unit-testable
// in isolation and timezone-correct.
//
// TIMEZONE: all bucketing is done on the viewer's LOCAL calendar day, never via
// UTC string slicing. An entry's `date` is an ISO timestamp; two entries on the
// same local day must land in the same group even across a UTC midnight, and
// "Today"/"Yesterday" are relative to the viewer's local now. We therefore key
// on a local `YYYY-MM-DD` derived from the Date's local getFullYear/Month/Date.

/** Local-calendar `YYYY-MM-DD` for a Date (NOT UTC). */
export const localDayKey = (d: Date): string => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};

/**
 * The stable group key for an entry's ISO date string. Entries sharing a local
 * calendar day share a key. Invalid/empty dates fall back to the raw string so
 * grouping never throws (they just bucket together under that raw value).
 */
export const sectionKeyForDate = (isoDate: string): string => {
    const d = new Date(isoDate);
    if (Number.isNaN(d.getTime())) return isoDate;
    return localDayKey(d);
};

/**
 * Humanized section title for a `YYYY-MM-DD` local day key, relative to `now`:
 *   - same local day as `now`        -> "Today"
 *   - the local day before `now`     -> "Yesterday"
 *   - otherwise                      -> long-form date ("Monday, June 9, 2025")
 *
 * `dateKey` is parsed as a LOCAL midnight (we append no `Z`), so the comparison
 * stays on the local calendar. A non-`YYYY-MM-DD` key (the degenerate fallback
 * from `sectionKeyForDate`) is returned verbatim.
 */
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export const formatSectionTitle = (dateKey: string, now: Date = new Date()): string => {
    if (!YMD.test(dateKey)) return dateKey;

    // Parse the key as local midnight (split avoids `new Date('YYYY-MM-DD')`,
    // which the spec parses as UTC midnight and would shift the day for some
    // zones).
    const [y, m, d] = dateKey.split('-').map(Number);
    const dayDate = new Date(y, m - 1, d);
    if (Number.isNaN(dayDate.getTime())) return dateKey;

    if (localDayKey(now) === dateKey) return 'Today';

    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    if (localDayKey(yesterday) === dateKey) return 'Yesterday';

    return dayDate.toLocaleDateString(undefined, {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
};
