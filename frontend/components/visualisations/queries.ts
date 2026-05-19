// queries.ts
//
// Visualisation SQL.
//
// TIMEZONE NOTE
// -------------
// Every query that previously used `date('now')` was UTC-anchored. For users
// east of UTC (notably AU/NZ — UTC+10/+13), this caused entries logged late
// in the local evening to appear on tomorrow's UTC date, dropping them out
// of "today"/"this week" charts.
//
// The fix: queries that compute a date window now accept `?start, ?end`
// parameters. The React components compute the window in JS using local
// time (see `transforms/dateHelpers.ts` and chart components) and pass the
// boundaries in.

// -----------------------------------------------------------------------------
// Per-day mood averages over a window.
//
// `start` and `end` should be SQLite-comparable datetime strings like
// "YYYY-MM-DD HH:MM:SS" (use `startOfLocalDay` / `endOfLocalDay`).
//
// Returns rows like: [{ date: "2025-01-15", avgMood: 7.5 }, ...] — but only
// for days that actually have entries. Missing days must be filled in JS via
// the relevant transform; the brittle recursive-CTE date-generator approach
// is gone.
// -----------------------------------------------------------------------------
export const WEEKLY_MOOD_AVERAGES = `
  SELECT
    date(date) as date,
    ROUND(AVG(mood), 1) as avgMood
  FROM entries
  WHERE date BETWEEN ? AND ?
  GROUP BY date(date)
  ORDER BY date
`;

// Kept for backwards-compat / monthly view — same shape, same parameters.
export const MONTHLY_MOOD_AVERAGES = WEEKLY_MOOD_AVERAGES;

// -----------------------------------------------------------------------------
// Raw mood points in a window (rarely used; kept for completeness).
// -----------------------------------------------------------------------------
export const MOOD_POINTS_IN_RANGE = `
  SELECT
    date(date) as date,
    mood
  FROM entries
  WHERE date BETWEEN ? AND ?
  ORDER BY date
`;

// -----------------------------------------------------------------------------
// Entry dates for streak computation.
//
// REPLACES the previous recursive-CTE streak SQL, which was timezone-broken
// and impossible to unit-test. Now:
//   1. Fetch distinct local-date strings in the last N days.
//   2. Let JS compute the streak via `transforms/streak.ts`.
//
// Caller supplies `?start` (typically 60 days ago in local time).
// -----------------------------------------------------------------------------
export const RECENT_ENTRY_DATES = `
  SELECT DISTINCT date(date) as date
  FROM entries
  WHERE date >= ?
  ORDER BY date DESC
`;
