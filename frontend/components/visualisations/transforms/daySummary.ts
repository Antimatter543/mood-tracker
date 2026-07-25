// daySummary.ts
//
// Pure transform behind the calendar's day-press summary. Takes the RAW rows
// from ACTIVITY_CORRELATION over a single-day window (one row per entry×activity,
// plus one activity_id=NULL row per activity-less entry) and folds them into a
// per-entry summary for ONE local day.
//
// DOCTRINE: SQL returns raw UTC instants; day membership is decided HERE via
// `localDateString`, so an entry that is the previous/next UTC day but the
// SELECTED local day is included (and vice-versa), matching every other view.

import { localDateString } from '@/databases/dateHelpers';

/** A raw ACTIVITY_CORRELATION row. */
export type CorrelationRow = {
  entry_id: number;
  date: string; // raw UTC ISO instant
  mood: number;
  activity_id: number | null;
  activity_name: string | null;
};

/** One mood entry on the day, with the activities logged on it. */
export type DayEntry = {
  id: number;
  instant: string; // raw UTC instant — the component formats the LOCAL time
  mood: number;
  activities: string[];
};

export type DaySummary = {
  day: string; // the local "YYYY-MM-DD"
  count: number;
  avgMood: number | null; // 1dp; null when the day has no entries
  entries: DayEntry[]; // chronological (oldest first)
};

/**
 * Fold correlation rows into the summary for local `day`. Rows on other local
 * days (a windowed query can include a boundary instant) and degenerate rows
 * are dropped. Entries are grouped by `entry_id`; each entry's `activities` are
 * its non-null activity names. Never throws on empty/garbage input.
 */
export const dayEntriesSummary = (
  rows: CorrelationRow[],
  day: string,
): DaySummary => {
  const byEntry = new Map<number, DayEntry>();
  for (const row of rows ?? []) {
    if (!row || typeof row.date !== 'string') continue;
    if (Number.isNaN(new Date(row.date).getTime())) continue;
    if (localDateString(row.date) !== day) continue; // keep only this local day
    let entry = byEntry.get(row.entry_id);
    if (!entry) {
      entry = { id: row.entry_id, instant: row.date, mood: row.mood, activities: [] };
      byEntry.set(row.entry_id, entry);
    }
    if (row.activity_name) entry.activities.push(row.activity_name);
  }

  const entries = [...byEntry.values()].sort((a, b) =>
    a.instant < b.instant ? -1 : a.instant > b.instant ? 1 : 0,
  );
  const count = entries.length;
  const avgMood =
    count === 0
      ? null
      : Math.round((entries.reduce((s, e) => s + e.mood, 0) / count) * 10) / 10;

  return { day, count, avgMood, entries };
};
