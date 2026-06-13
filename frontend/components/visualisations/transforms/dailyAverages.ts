// dailyAverages.ts
//
// THE single source of truth for "which local day does this entry belong to".
//
// DOCTRINE (see databases/dateHelpers.ts READ CONTRACT and queries.ts header):
// SQL stores entries as UTC ISO instants and range-filters them with
// parameterised UTC ISO bounds — but SQL NEVER day-buckets stored timestamps
// (no `date(date)` / `strftime` for grouping/keying). Day-keying happens HERE,
// in JS, via `localDateString` from the canonical date helpers. This is the one
// place that decides day membership, so a backdated entry (stored at local
// midnight = the PREVIOUS day in UTC for any UTC+N user) lands on the correct
// local day everywhere: Home weekly chart, monthly stats/bestDay, the heatmap,
// the calendar, day-of-week patterns, and activity correlation.
//
// Why not SQLite's `'localtime'` modifier? It would work on-device but is
// untestable under jest and would create a SECOND timezone authority. One
// authority (`localDateString`) keeps the whole app coherent and tested.

import { localDateString } from '@/databases/dateHelpers';

/** A raw row straight from SQL: a stored UTC ISO instant + a numeric value. */
export type InstantValueRow = {
  date: string; // UTC ISO instant, e.g. "2026-06-10T14:00:00.000Z"
  mood: number;
};

/** One aggregated local day. `avg` is rounded to 1 dp to match prior SQL. */
export type DailyAverage = {
  day: string; // local "YYYY-MM-DD"
  avg: number; // average mood that local day, 1 dp
  count: number; // entries that local day
};

/**
 * Aggregate raw `{date: instant, mood}` rows into per-LOCAL-day averages,
 * sorted ascending by day. Rows whose `date` doesn't parse to a valid instant
 * are skipped (degenerate input must never throw — mirrors the heatmap/streak
 * guards). Non-finite moods are ignored for the average but the day is still
 * created if it has at least one valid mood; a day with only invalid moods is
 * dropped (no `count`, nothing to plot).
 *
 * `avg` is rounded to 1 decimal place so it exactly matches what the old
 * `ROUND(AVG(mood), 1)` SQL produced.
 */
export function aggregateDailyAverages(rows: InstantValueRow[]): DailyAverage[] {
  const sums = new Map<string, { sum: number; count: number }>();

  for (const row of rows ?? []) {
    if (!row || typeof row.date !== 'string') continue;
    const t = new Date(row.date).getTime();
    if (Number.isNaN(t)) continue;
    if (typeof row.mood !== 'number' || !Number.isFinite(row.mood)) continue;

    const day = localDateString(row.date);
    const bucket = sums.get(day);
    if (bucket) {
      bucket.sum += row.mood;
      bucket.count += 1;
    } else {
      sums.set(day, { sum: row.mood, count: 1 });
    }
  }

  const out: DailyAverage[] = [];
  for (const [day, { sum, count }] of sums) {
    out.push({ day, avg: Math.round((sum / count) * 10) / 10, count });
  }
  out.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  return out;
}

/**
 * Map of local day -> average mood. Convenience for consumers that join by day
 * key (Home weekly fill, heatmap gap-fill, calendar markers).
 */
export function dailyAverageMap(rows: InstantValueRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const { day, avg } of aggregateDailyAverages(rows)) map.set(day, avg);
  return map;
}

/** One `{date, avgMood}` row, ascending by local day. */
export type DayAvgRow = { date: string; avgMood: number };

/**
 * Per-local-day `{date: 'YYYY-MM-DD', avgMood}` rows — the exact shape the chart
 * transforms (buildWeeklyMoodChartData, buildCalendarMarkers) consume. The one
 * adapter every line/calendar/trend chart uses instead of re-implementing the
 * `aggregateDailyAverages(...).map(...)` dance per screen.
 */
export function dailyAverageRows(rows: InstantValueRow[]): DayAvgRow[] {
  return aggregateDailyAverages(rows).map((d) => ({ date: d.day, avgMood: d.avg }));
}

/**
 * The local "YYYY-MM-DD" day with the highest average mood over the rows, or
 * `''` when there are no entries. Powers the Home "Best Day" stat. Ties resolve
 * to the EARLIEST day (rows are sorted ascending and we keep the first max),
 * matching the prior SQL's `LIMIT 1` over an ORDER-BY-day scan.
 */
export function bestDayLocal(rows: InstantValueRow[]): string {
  let best = '';
  let bestAvg = -Infinity;
  for (const { day, avg } of aggregateDailyAverages(rows)) {
    if (avg > bestAvg) {
      bestAvg = avg;
      best = day;
    }
  }
  return best;
}
