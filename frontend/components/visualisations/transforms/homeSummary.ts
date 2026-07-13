import { InstantValueRow, bestDayLocal } from './dailyAverages';

/**
 * Pure Home-dashboard summary math, extracted from the Home screen so the
 * falsy-zero traps below are unit-testable without mounting a component (mirrors
 * the rest of transforms/).
 *
 * Both functions exist because a *legitimate* mood value of 0 is falsy: the old
 * `today?.mood || null` and the old `stats.average ? … : '-- / 10'` both treated
 * a real 0.0 as "no data".
 */

/**
 * Today's mood, or `null` when there is genuinely no entry today.
 *
 * Uses `?? null`, NOT `|| null`: a real 0.0 mood is falsy but IS an entry, so
 * `||` would collapse it to "No entry yet". Only `null`/`undefined` (no row)
 * means no entry.
 */
export function todaysMoodValue(today: { mood: number } | null | undefined): number | null {
  return today?.mood ?? null;
}

/** The Home "Last 30 days" overview tile values. */
export type MonthlyOverview = {
  /** Mean mood over the window, 1 dp. `null` = NO data (distinct from a real 0.0 average). */
  average: number | null;
  totalEntries: number;
  /** Local day with the highest daily average, or '' when there's no data. */
  bestDay: string;
};

/**
 * Compute the last-30-days overview from raw `{date, mood}` rows.
 *
 * `average` is `null` when there are no rows — the sentinel MUST be null, not 0,
 * so a window whose real average happens to be 0.0 doesn't read as "no data".
 */
export function monthlyOverview(rows: InstantValueRow[]): MonthlyOverview {
  if (rows.length === 0) {
    return { average: null, totalEntries: 0, bestDay: '' };
  }
  const sum = rows.reduce((s, r) => s + r.mood, 0);
  return {
    average: Math.round((sum / rows.length) * 10) / 10,
    totalEntries: rows.length,
    bestDay: bestDayLocal(rows),
  };
}

/**
 * Format the average for display. Uses `!== null`, NOT truthiness, so a real
 * 0.0 average shows "0.0 / 10" while genuinely-absent data shows "-- / 10".
 */
export function formatAverageDisplay(average: number | null): string {
  return average !== null ? `${average.toFixed(1)} / 10` : '-- / 10';
}
