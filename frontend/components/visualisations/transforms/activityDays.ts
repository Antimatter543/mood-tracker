// activityDays.ts
//
// The calendar's "activity dot layer" day-keying. Given the RAW stored instants
// of every entry that logged a selected activity in a window (from
// ENTRIES_FOR_ACTIVITY_IN_RANGE), return the SET of LOCAL days those entries
// fall on — so a small dot can be rendered on each such day.
//
// DOCTRINE (mirror of dailyAverages.ts): SQL returns raw UTC instants and NEVER
// day-buckets; JS owns day-keying via `localDateString`, the ONE authority. This
// is what makes a late-evening entry whose UTC calendar day differs from its
// LOCAL calendar day land on the user's day, not the UTC one.

import { localDateString } from '@/databases/dateHelpers';

/** A raw row straight from SQL: a stored UTC ISO instant. */
export type InstantRow = { date: string };

/**
 * Map raw activity-entry instants to the SET of LOCAL "YYYY-MM-DD" days they
 * fall on. Degenerate rows (missing/invalid `date`) are skipped rather than
 * throwing — an empty/garbage window must render an unmarked calendar, never
 * crash (mirrors the heatmap/streak guards).
 */
export const activityDaySet = (rows: InstantRow[]): Set<string> => {
  const days = new Set<string>();
  for (const row of rows ?? []) {
    if (!row || typeof row.date !== 'string') continue;
    // Guard BEFORE localDateString (which throws on an invalid instant).
    if (Number.isNaN(new Date(row.date).getTime())) continue;
    days.add(localDateString(row.date));
  }
  return days;
};
