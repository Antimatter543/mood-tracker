# Plan: fix/home-blank-after-add — Home cards vanish after adding a mood (intermittent)

## Bug
"Sometimes when I add a new mood, all the homepage things disappear; only an app restart fixes it."
Restart-fixes ⇒ in-memory state corruption, not persisted data. Two systematic defects in the
add→focus-refresh→render pipeline (diagnosis pre-done by CEO; implementing against it):

1. Non-exclusive `db.withTransactionAsync` on a single shared connection. Under the focus-driven
   refresh (`useDataRefresh`→Home `fetchData` fires 6 concurrent reads), a write txn interleaves
   with reads → connection left in a bad in-memory state → reads return empty → Home reverts to
   empty cards, stuck until the DB is reopened (app restart). `withExclusiveTransactionAsync`
   serializes the connection for the callback duration (already used correctly in lifecycle.ts:155).
2. No error boundary anywhere → any render throw blanks the whole screen until restart.

## Baseline (clean tree, fix branch, 2026-06-26)
- tsc: 0 errors.  jest: 62 suites / 584 tests passed, 0 failed.
- (Env now healthier than lessons 2026-06-16 warned — @testing-library/react-native + sortables
  now installed; expo-file-system/legacy still absent but tsc/jest both fully green.)
- DELTA rule: prove (a) 0 NEW tsc errors mentioning my files, (b) jest pass count only GROWS.

## FIX 1 — Exclusive transactions + invariant test
Convert RUNTIME user-facing `withTransactionAsync(` → `withExclusiveTransactionAsync(` (drop-in,
body unchanged) in:
- databases/entries.ts: addMoodEntry (~95), getMoodEntries (~146)
- databases/activities.ts: deleteActivity (~169), updateActivityPositions (~207)
- databases/groups.ts: deleteActivityGroup (~86)
- databases/data-export.ts: importDatabaseData (~212)
Leave init-time: migrations.ts (nested in resetDatabase's exclusive txn — would double-BEGIN),
lifecycle.ts (already exclusive). Dev-only __DEV__ paths: components/generateData.ts,
components/DBViewer.tsx — evaluate; convert only if trivially safe & not nested.
- New class-level invariant test `__tests__/exclusiveTransactions.test.ts`: scan the 4 runtime db
  module sources; FAIL on any non-exclusive `withTransactionAsync(`. Mirror queriesNoDateBucketing.
- Update existing tests asserting `withTransactionAsync` → `withExclusiveTransactionAsync`
  (database.test.ts, entries.test.ts, activities.test.ts, groups.test.ts). Add regression:
  addMoodEntry uses the exclusive variant.

## FIX 2 — expo-router ErrorBoundary (recoverable, themed)
RTFM done: a route/layout file exports a named `ErrorBoundary({error, retry}: ErrorBoundaryProps)`.
expo-router wraps the route in `<Try catch={ErrorBoundary}>`; getDerivedStateFromError captures a
render throw, renders my boundary; `retry()` clears error state and re-renders children (recovers
once the transient state is gone). Scope to the (tabs) navigator subtree → export from
app/(tabs)/_layout.tsx (covers the Home screen where the bug manifests). Themed via
useThemeColors(); @expo/vector-icons (no emoji); a "Try again" button calls retry.
- New component components/ScreenErrorFallback.tsx (UI-free-ish, themed) so it's unit-testable.
- Test `__tests__/errorBoundary.test.tsx` (RNTL 14 async; render-error = rejected promise):
  (a) fallback shows when a child throws inside a Try-equivalent harness;
  (b) after the throwing condition clears, retry re-renders children.

## FIX 3 (secondary) — Home fetchData race guard
app/(tabs)/index.tsx fetchData is async; useDataRefresh ignores the Promise → overlapping runs can
clobber state out of order. Add a useRef run-sequence counter; after Promise.all, bail before any
setState if not the latest. Minimal. Add a focused test if cleanly doable; else skip + report.

## Gate
`npx tsc --noEmit && npx jest` from frontend/. Run own suites directly
(`npx jest exclusiveTransactions errorBoundary`). eslint any file with a new early return.
No native builds. Branch only — CEO owns on-device QA + release.
