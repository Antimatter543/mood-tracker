# Plan: v2.3.0 QoL — version auto-derive + timezone day-keying fix

## Goal
Auto-derive the Settings version line; move ALL day-keying out of SQL into one tested JS transform (`localDateString`) so backdated entries land on the correct local day in Home charts/streak/heatmap/calendar/insights.

## Task 1 — Settings version display
- [x] Read `expo.version` via `expo-constants` `Constants.expoConfig?.version` (fall back '—').
- [x] Derive `© <year>` from `new Date().getFullYear()`.
- [x] Extract pure `versionLine(version, year)` helper + unit test it.

## Task 2 — Timezone day-keying
Doctrine: SQL range-filters with parameterised UTC ISO bounds and returns RAW instants; SQL NEVER day-buckets via `date()`/`strftime` on stored timestamps. JS owns day-keying via `localDateString`.

### New transform (one source of truth)
- [x] `transforms/dailyAverages.ts`: rows `{date: isoInstant, mood}` → array of `{day: 'YYYY-MM-DD' local, avg, count}`, sorted by day. Reused everywhere a query did `GROUP BY date(date)`.

### Query changes (queries.ts — keep ?start/?end bounds, drop date())
- [x] `WEEKLY_MOOD_AVERAGES`/`MONTHLY_MOOD_AVERAGES` → return `date, mood` raw rows.
- [x] `MOOD_POINTS_IN_RANGE` → drop `date(date)`, return raw `date`.
- [x] `RECENT_ENTRY_DATES` → return raw `date` instants (no DISTINCT date()), JS maps localDateString + dedupe.
- [x] `DOW_MOOD_PATTERN` → return raw `date, mood`; compute DOW in JS via localDateString (kills the strftime %w UTC drift).
- [x] `ACTIVITY_CORRELATION` → restructure: window_entries returns raw, day-key both `activity_days` and `day_avg` in JS. New `MONTH_OVER_MONTH`? No — keep WINDOW_SUMMARY (scalar, no day-key).
- [x] Move inline Home `monthStats` SQL → named export `MONTHLY_DAILY_AVERAGES` (raw rows) so the invariant test covers it; bestDay computed in JS.
- [x] Move inline `_layout.tsx` RECENT_ENTRY_DATES inline SQL → use the exported RECENT_ENTRY_DATES.
- [x] Heatmap CTE → return raw entries in JS-keyed form; gap-fill in JS.

### Consumer changes
- [x] index.tsx fetchData: weekly + month bestDay + streak via dailyAverages/localDateString.
- [x] WeeklyMoodChart.tsx: inline QUERY → raw rows → dailyAverages.
- [x] MoodCalendar.tsx: inline SQL → raw rows → dailyAverages → calendarMarkers.
- [x] DailyMoodBar.tsx + dayOfWeekPattern transform: DOW from localDateString.
- [x] ActivityCorrelationChart.tsx + activityCorrelation transform: day-key in JS.
- [x] CustomHeatMap.tsx + heatmap transform: build day→mood map in JS.
- [x] chartUtils.ts `getLast7Days`: use localDateString (audit consumers first).

### Tests (as important as the fix)
- [x] `jest.tz.js` pins `process.env.TZ='Australia/Brisbane'` FIRST in setupFiles. Sanity test: offset === -600.
- [x] Regression: local-midnight-Thursday instant → dailyAverages day '2026-06-11'; streak today + yesterday-backdated → 2.
- [x] Class invariant: every exported SQL string in queries.ts must NOT match `/date\s*\(\s*(e\.)?date\s*\)|strftime\s*\([^)]*date/i`.
- [x] Per-consumer transform tests (heatmap, DOW, activity correlation, dailyAverages).

## Gate
`npx tsc --noEmit && npx jest` — both clean.

## Decisions made
- Day-keying centralized in `localDateString` (databases/dateHelpers.ts) — single TZ authority, NOT SQLite 'localtime'.
- DOW computed in JS (was strftime %w UTC) — fixes a secondary leak the header admitted.
- Brisbane (UTC+10, no DST) pin = deterministic non-UTC TZ to expose the whole bug class.
