// queries.ts
//
// Visualisation SQL.
//
// DOCTRINE — SQL NEVER day-buckets; JS owns day-keying
// ----------------------------------------------------
// Entries are stored as UTC ISO instants (see databases/dateHelpers.ts STORAGE
// CONTRACT). These queries do exactly two things and nothing more:
//   (a) RANGE-FILTER on the stored instant using parameterised UTC ISO bounds
//       (`WHERE date BETWEEN ?start AND ?end`), where ?start/?end are computed
//       in JS local time (startOfLocalDay / endOfLocalDay / computeWindow).
//   (b) RETURN RAW INSTANTS (the stored `date` column), never a SQL-derived day.
//
// They MUST NOT call SQLite's `date()` / `strftime()` on a stored timestamp to
// group or key it. SQLite's date() / strftime() operate in UTC, so any
// stored-instant day-bucketing mis-attributes entries for users east/west of
// UTC: a backdated entry normalised to LOCAL midnight is stored at the PREVIOUS
// (or next) UTC day, and would bucket onto the wrong day. ALL "which local day
// is this entry on" logic goes through `aggregateDailyAverages` /
// `localDateString` (transforms/dailyAverages.ts) — one tested authority.
//
// This is enforced by a class-level invariant test (queriesNoDateBucketing
// .test.ts) that scans every exported SQL string here for `date(date)` /
// `strftime(... date ...)` and fails the build if one reappears.

// -----------------------------------------------------------------------------
// Per-day mood averages over a window — RAW rows.
//
// `start`/`end` are UTC ISO bounds (use startOfLocalDay / endOfLocalDay or
// computeWindow). Returns one row per ENTRY (raw instant + mood); the caller
// aggregates per local day via `aggregateDailyAverages`. Days with no entries
// are filled in JS by the consuming transform.
// -----------------------------------------------------------------------------
export const WEEKLY_MOOD_AVERAGES = `
  SELECT
    date,
    mood
  FROM entries
  WHERE date BETWEEN ? AND ?
  ORDER BY date
`;

// Kept for backwards-compat / monthly view — same shape, same parameters.
export const MONTHLY_MOOD_AVERAGES = WEEKLY_MOOD_AVERAGES;

// -----------------------------------------------------------------------------
// Home "Last 30 days" stats source — RAW rows.
//
// Replaces the inline `WITH DailyAverages AS (... GROUP BY date(date))` block
// that lived in app/(tabs)/index.tsx (its bestDay was UTC-keyed). The caller
// computes average / count / bestDay in JS from `aggregateDailyAverages` so the
// "best day" is the right LOCAL day. Exported (not inline) so the no-bucketing
// invariant test covers it too.
//
// Caller supplies `?start, ?end` (UTC ISO bounds).
// -----------------------------------------------------------------------------
export const MONTHLY_DAILY_AVERAGES = WEEKLY_MOOD_AVERAGES;

// -----------------------------------------------------------------------------
// All-time entry count. The single source of truth for "is the DB empty?" used
// by the Home + Statistics empty states. No parameters.
// -----------------------------------------------------------------------------
export const TOTAL_ENTRIES = `SELECT COUNT(*) as count FROM entries`;

// -----------------------------------------------------------------------------
// Raw mood points in a window (rarely used; kept for completeness). Raw instant
// + mood; day-keying (if any) is the caller's job.
// -----------------------------------------------------------------------------
export const MOOD_POINTS_IN_RANGE = `
  SELECT
    date,
    mood
  FROM entries
  WHERE date BETWEEN ? AND ?
  ORDER BY date
`;

// -----------------------------------------------------------------------------
// Entry instants for streak computation — RAW instants.
//
// Was `SELECT DISTINCT date(date)`, which both UTC-keyed the day AND collapsed
// to a day-string the caller could no longer re-key. Now returns the raw stored
// instants; the caller maps them through `localDateString` and de-dupes in JS
// before `currentStreak` (which already tolerates duplicates).
//
// Caller supplies `?start` (typically 60 days ago in local time).
// -----------------------------------------------------------------------------
export const RECENT_ENTRY_DATES = `
  SELECT date
  FROM entries
  WHERE date >= ?
  ORDER BY date DESC
`;

// -----------------------------------------------------------------------------
// Day-of-week pattern over a window — RAW rows.
//
// Was `strftime('%w', date)` (extracted the DOW in UTC — drifted by one for
// late-evening entries near midnight in non-UTC zones). Now returns raw instant
// + mood; the day-of-week is derived in JS from the LOCAL day (see
// transforms/dayOfWeekPattern.ts), so the bucket is always the user's DOW.
//
// Caller supplies `?start, ?end` (use computeWindow).
// -----------------------------------------------------------------------------
export const DOW_MOOD_PATTERN = `
  SELECT
    date,
    mood
  FROM entries
  WHERE date BETWEEN ? AND ?
  ORDER BY date
`;

// -----------------------------------------------------------------------------
// Single-window scalar summary: average mood + entry count.
//
// Used by the KPI summary card (over the timeframe window) and the
// month-over-month card (run twice, once per calendar month). No day-bucketing
// here — it's a window-wide scalar aggregate, so it's TZ-safe as long as the
// ?start/?end bounds are local-derived (they are).
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
// NOT, per activity. RAW rows — day-keying happens in JS.
//
// The previous version day-bucketed with `date(e.date)` inside the SQL (UTC).
// Now SQL just joins each entry to its activity ids within the window and
// returns one row per (entry instant, mood, activity_id|null). The transform
// (activityCorrelation.ts) keys each entry to its LOCAL day, builds per-day
// averages and the per-activity day sets, then does the with-vs-without split
// and the >= MIN_SAMPLES gate. This keeps the rigorous "with vs without" causal
// framing while fixing the day attribution.
//
// One row per entry×activity (activity_id repeats per activity on that entry),
// plus one row per entry with activity_id = NULL is NOT emitted — entries with
// no activities still need a day-average, so we LEFT JOIN and emit a single
// NULL-activity row for activity-less entries. Dedup of (day, activity) and the
// day-average are the transform's responsibility.
//
// Boundaries are parameterised UTC ISO strings (?start, ?end).
// -----------------------------------------------------------------------------
export const ACTIVITY_CORRELATION = `
  SELECT
    e.id AS entry_id,
    e.date AS date,
    e.mood AS mood,
    ea.activity_id AS activity_id,
    a.name AS activity_name
  FROM entries e
  LEFT JOIN entry_activities ea ON ea.entry_id = e.id
  LEFT JOIN activities a ON a.id = ea.activity_id
  WHERE e.date BETWEEN ? AND ?
  ORDER BY e.date
`;
