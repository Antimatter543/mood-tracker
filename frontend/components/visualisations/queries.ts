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
// DEPRECATED: Backwards-compat shims for `app/(tabs)/{index,timeline}.tsx`.
//
// These are the original UTC-anchored queries. They remain only so the
// non-viz files (out of this refactor's scope) keep compiling — the parent
// agent will migrate those callers in a follow-up. Do not use in new code.
//
// New code should use `WEEKLY_MOOD_AVERAGES` + transforms instead.
// -----------------------------------------------------------------------------

/** @deprecated Use WEEKLY_MOOD_AVERAGES with computed local-time window + transforms/weeklyMood. */
export const WEEKLY_MOOD_AVERAGES_NULLED = `
WITH RECURSIVE dates(date) AS (
  SELECT date('now', '-7 days')
  UNION ALL
  SELECT date(date, '+1 day')
  FROM dates
  WHERE date < date('now')
)
SELECT
  dates.date,
  ROUND(AVG(entries.mood), 1) as avgMood
FROM dates
LEFT JOIN entries ON date(entries.date) = dates.date
GROUP BY dates.date
ORDER BY dates.date`;

/** @deprecated Use MOOD_POINTS_IN_RANGE. */
export const WEEKLY_MOOD_POINTS = `
  SELECT
    date(date) as date,
    mood
  FROM entries
  WHERE date >= date('now', '-7 days')
  ORDER BY date
`;

/** @deprecated Use RECENT_ENTRY_DATES + transforms/streak#currentStreak. */
export const GET_CURRENT_STREAK = `
WITH RECURSIVE dates(date) AS (
  SELECT date('now', '-30 days')
  UNION ALL
  SELECT date(date, '+1 day')
  FROM dates
  WHERE date < date('now', '+1 day')
),
daily_entries AS (
  SELECT
    dates.date,
    CASE WHEN COUNT(entries.id) > 0 THEN 1 ELSE 0 END as has_entry
  FROM dates
  LEFT JOIN entries ON date(entries.date) = dates.date
  GROUP BY dates.date
  ORDER BY dates.date DESC
),
streak AS (
  SELECT
    date,
    has_entry,
    (
      SELECT COUNT(*)
      FROM daily_entries d2
      WHERE d2.date >= daily_entries.date
      AND d2.has_entry = 1
      AND NOT EXISTS (
        SELECT 1 FROM daily_entries d3
        WHERE d3.date > daily_entries.date
        AND d3.date <= date('now')
        AND d3.has_entry = 0
      )
    ) as streak_length
  FROM daily_entries
  WHERE date <= date('now')
)
SELECT MAX(streak_length) as streak
FROM streak
WHERE date <= date('now');
`;

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
