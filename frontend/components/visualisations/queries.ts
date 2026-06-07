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

// -----------------------------------------------------------------------------
// Day-of-week pattern over a window, with best/worst per DOW.
//
// strftime('%w', date) returns 0=Sun..6=Sat. Note: strftime treats the stored
// datetime as UTC for the %w extraction (a known small leak for late-evening
// entries near midnight in non-UTC zones). The window BOUNDARIES, however, are
// parameterised local-time UTC ISO strings, so the SET of entries considered is
// correct; only the DOW bucket can drift by one for borderline entries.
//
// Caller supplies `?start, ?end` (use computeWindow from windowHelpers).
// -----------------------------------------------------------------------------
export const DOW_MOOD_PATTERN = `
  SELECT
    CAST(strftime('%w', date) AS INTEGER) as day_of_week,
    ROUND(AVG(mood), 2) as avg_mood,
    MAX(mood) as best_mood,
    MIN(mood) as worst_mood,
    COUNT(*) as entry_count
  FROM entries
  WHERE date BETWEEN ? AND ?
  GROUP BY day_of_week
  ORDER BY day_of_week
`;

// -----------------------------------------------------------------------------
// Single-window scalar summary: average mood + entry count.
//
// Used by the KPI summary card (over the timeframe window) and the
// month-over-month card (run twice, once per calendar month).
//
// Caller supplies `?start, ?end`.
// -----------------------------------------------------------------------------
export const WINDOW_SUMMARY = `
  SELECT
    ROUND(AVG(mood), 2) as avg_mood,
    COUNT(*) as entry_count
  FROM entries
  WHERE date BETWEEN ? AND ?
`;

// -----------------------------------------------------------------------------
// Activity correlation: avg mood on days an activity WAS logged vs days it was
// NOT, per activity. This is the rigorous "with vs without" causal framing that
// replaces the old delta-from-overall-mean approach.
//
// Strategy:
//   1. window_entries  — entries within the parameterised local-time window.
//   2. day_avg         — one mood average per calendar day in the window.
//   3. activity_days   — the set of days each activity appears on.
//   4. For each activity, cross-join against every day in the window and split
//      day_avg into "with" (day is in the activity's set) vs "without".
//
// Boundaries are parameterised UTC ISO strings (?start, ?end), NOT date('now').
// -----------------------------------------------------------------------------
export const ACTIVITY_CORRELATION = `
  WITH window_entries AS (
    SELECT e.id, e.mood, e.date
    FROM entries e
    WHERE e.date BETWEEN ? AND ?
  ),
  activity_days AS (
    SELECT DISTINCT
      ea.activity_id,
      date(e.date) as day
    FROM entry_activities ea
    JOIN window_entries e ON ea.entry_id = e.id
  ),
  day_avg AS (
    SELECT
      date(date) as day,
      AVG(mood) as day_mood
    FROM window_entries
    GROUP BY date(date)
  )
  SELECT
    a.name as activity_name,
    ROUND(AVG(CASE WHEN ad.activity_id IS NOT NULL THEN da.day_mood END), 2) as avg_with,
    ROUND(AVG(CASE WHEN ad.activity_id IS NULL     THEN da.day_mood END), 2) as avg_without,
    COUNT(CASE WHEN ad.activity_id IS NOT NULL THEN 1 END) as count_with,
    COUNT(CASE WHEN ad.activity_id IS NULL     THEN 1 END) as count_without
  FROM activities a
  CROSS JOIN day_avg da
  LEFT JOIN activity_days ad
    ON da.day = ad.day
    AND ad.activity_id = a.id
  GROUP BY a.id, a.name
  HAVING count_with >= 3
  ORDER BY ABS(IFNULL(avg_with, 0) - IFNULL(avg_without, 0)) DESC
`;
