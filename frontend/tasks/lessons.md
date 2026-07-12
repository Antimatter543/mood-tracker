# SoulSync — Project Lessons

## 2026-07-13: "Home doesn't update after adding a mood" survived TWO fixes because focus-gain and data-changed-while-focused are DIFFERENT events sharing one unreliable mechanism

**Mistake**: `useDataRefresh` drove live updates by putting `refreshCount` in the `useFocusEffect` callback's dep list, betting that a changed callback identity makes the effect "re-run while focused." That bet holds for a tab you NAVIGATE to (focus gain), so Timeline always looked fixed — you switch to it and the focus-gain reload fires. But it is unreliable for the ALREADY-focused screen on expo-router v6 bottom-tabs, so Home — focused when you tap its own FAB — never reloaded and showed a stale Today's Mood until you left and came back. The 2026-06-26 transaction work listed this as a mild "self-healing" follow-up and never owned it; device QA of 2.3.8 proved it was still fully live. It was invisible to jest because the faithful `useFocusEffect` mock (`useEffect(()=>cb(),[cb])`) ALWAYS re-runs on identity change — it over-models the real hook and hid the exact gap.

**Rule**: (a) Treat "reload on focus gain" and "reload because data changed while I'm focused" as TWO vectors with separate owners: `useFocusEffect` for the first, an explicit `useEffect` keyed on the change signal + gated by the reactive `useIsFocused()` for the second (`hooks/useDataRefresh.ts` VECTOR 1 / VECTOR 2). Don't smuggle a data-change signal through a focus hook's dep list. (b) When a bug is device-reported as "doesn't update in place" but a test asserts it updates, SUSPECT THE MOCK is more capable than production — model the unreliable behavior (here: useFocusEffect as focus-gain-ONLY) so the test can actually fail. (c) A "mild, self-healing" follow-up that reproduces on every add is not mild — it was the user's original complaint.

**Date**: 2026-07-13

## 2026-07-13: The transactions were FAKE — expo's `withExclusiveTransactionAsync` ran every statement OUTSIDE the transaction; the FK-per-connection trap; error-swallowing masked real failures as EmptyState

**Mistake (three intertwined bugs)**:

1. **Every write "transaction" was empty.** `db.withExclusiveTransactionAsync(task)` (expo-sqlite) opens a
   SEPARATE connection and passes it as the `txn` callback arg (`Transaction.createAsync` →
   `useNewConnection: true`); statements MUST run on `txn`. Every call site in this app wrote
   `async () => { await db.runAsync(...) }` — ignoring `txn`, using the OUTER `db` (the main connection). So
   `BEGIN`/`COMMIT` wrapped NOTHING on the idle second connection while the real statements ran on the main
   connection in autocommit. Consequence: ZERO atomicity (a mid-write failure left an entry without its
   activities; a retry could duplicate a row), and the "exclusive lock" the 2026-06-26 Home-blank fix believed
   it shipped never existed. Green `tsc + jest` proved nothing — the mock's `withExclusiveTransactionAsync`
   just runs the callback, indistinguishable from a real transaction. This is "verified for the wrong reason"
   theater: the 2026-06-26 fix passed its tests but the mechanism was inert.
2. **The FK-per-connection trap.** A naive fix (just use `txn`) silently breaks cascades: `PRAGMA
   foreign_keys` is PER-CONNECTION, set ON only on the main connection in `initializeDatabase`; a fresh `txn`
   connection has FK OFF, so `ON DELETE CASCADE` stops firing. `PRAGMA foreign_keys` is also a silent no-op
   inside an open transaction, and expo BEGINs before your callback — so expo's API can't be salvaged.
3. **Swallowed read errors masked failures as "empty".** `DBViewer.fetchEntriesPage` caught errors and
   returned `[]` → a transient read failure blanked the Timeline into `<EmptyState/>` ("add your first entry")
   over a FULL DB (the user-reported "shows nothing at all"). `AddEntryButton`/`DBViewer` update/delete
   swallowed failures to console with no user feedback. Home's `today?.mood || null` + `average ? … : '--'`
   treated a legitimate 0.0 mood/average as "no data" (falsy-zero bug).

**Rule**:
1. ALL multi-statement writes go through `withWriteTransaction` (`databases/writeTransaction.ts`): ONE
   singleton write connection (`openDatabaseAsync(DATABASE_NAME, { useNewConnection: true })` + `busy_timeout`
   + `foreign_keys = ON` set BEFORE any BEGIN), an in-process mutex serializing all writes, `BEGIN IMMEDIATE`
   → task(`txn`) → `COMMIT`/`ROLLBACK`. Statements on `txn` ONLY. NEVER expo's
   `withExclusiveTransactionAsync`/`withTransactionAsync` in runtime code (migrations.ts is the one documented
   exception). `initializeDatabase` sets `journal_mode = WAL` (persisted) so the read + write connections
   coexist without blocking. Enforced by `__tests__/writeTransactionInvariant.test.ts` (no expo txn APIs in
   runtime modules, every write module imports the primitive, no `db.<dml>` inside a write callback body).
2. Verify the crown-jewel write path against a REAL engine: `__tests__/entries.integration.test.ts`
   (`node:sqlite`) proves atomicity (a forced mid-txn failure rolls back the entries row), rollback+rethrow,
   and that delete cascades to entry_activities/entry_media with FK ON. Unit tests inject the write connection
   (`__setWriteConnectionForTests(db)`) so `txn === db` and statements land on the asserted mock.
3. Reads THROW on failure (no `return []`) so a component can show a recoverable "Couldn't load" + retry,
   never the EmptyState. Writes surface failures to the user (`Alert`) and preserve state (keep the modal
   open / the row on screen). Home falsy-zero: `today?.mood ?? null` and a `null` average sentinel (extracted
   to the testable `transforms/homeSummary.ts`).

**Meta**: a passing test over a no-op mock is not verification. When a fix's mechanism lives in a 3rd-party
API's contract (here: "run statements on the `txn` arg"), assert the mechanism against a real engine, and
add a class-level invariant so the whole category can't regress.

**Date**: 2026-07-13

## 2026-07-05: The `expo-sqlite` jest mock is a NO-OP stub — jest can't verify actual SQL behavior; use a `node:sqlite` integration test

**Mistake/gap**: Building the Timeline search+filter (a `WHERE` with `LIKE ? ESCAPE`, a correlated `EXISTS` on activity names, `mood BETWEEN`, spliced into the paged CTE), I wanted to prove the query actually FILTERS correctly — but `__mocks__/expo-sqlite.ts` is a 19-line stub whose `getAllAsync` is `jest.fn().mockResolvedValue([])`. Every db-layer test (`entries.test.ts`, `database.test.ts`, …) `jest.mock('expo-sqlite')`, so they exercise the JS AROUND the query, never the SQL itself. A green `tsc + jest` says NOTHING about whether a query returns the right rows. The usual real-run check — Expo Go on the Pixel — was also unavailable (a second live Claude session was concurrently driving the same physical device via astra-adb/uiautomator; `UiAutomationService … already registered!` conflict + foreground stolen by a Nudge test → only 1/7 device checks completed).

**Rule**: To verify DB-layer SQL deterministically (no device, no emulator, no new dependency), write a jest **integration test against Node's built-in `node:sqlite`** (Node ≥ 22.5; CI is Node 22, laptop 24): create the real schema, seed known rows, import the REAL query-builder (e.g. `buildEntryFilter`), run the ACTUAL query string (mirror the component's CTE, keeping the `${where && 'WHERE '+where}` splice + `[...params, LIMIT, OFFSET]` bind order), assert the returned ids. Guard the suite with `try { require('node:sqlite') } catch → describe.skip` so it never breaks an env without it. Reference impl: `__tests__/entryFilter.integration.test.ts` (8 cases: notes/activity/NULL-notes/case-insensitive/`%`-escape/mood-bands/combined/ordering). This is strictly stronger than a string-shape unit test — it catches alias-scope, param-order, and ESCAPE bugs the stub mock and a passing `tsc` both miss. Keep `entryFilter.test.ts` too (locks the emitted WHERE string; the integration test proves that string executes).

**Meta**: verify the crown-jewel data path against a REAL engine, not a stub that returns `[]`. When the device is contended, don't fabricate a pass and don't just trust the mock — reach for `node:sqlite`.

**Date**: 2026-07-05

## 2026-06-26: Home blanked after adding a mood (only an app restart fixed it) -- non-exclusive SQLite transactions race the focus-refresh

**Mistake**: Every runtime WRITE path used expo-sqlite's `db.withTransactionAsync(...)`, which is NON-exclusive: per the official docs, any async query that runs while the transaction is active is swept into it, and on the single shared connection a write's BEGIN/COMMIT can interleave with the focus-driven reads that fire on every `refetchEntries()`. After adding a mood, Home's reads came back empty and the cards reverted to their empty-states ("all the homepage things disappear"), stuck until the app reopened the DB (a fresh process == clean connection -- which is why the bug was data-NON-deterministic and only a restart cleared it). `lifecycle.ts:155` already used the safe `withExclusiveTransactionAsync` but the add/edit paths did not. There was also NO error boundary anywhere, so any render-throw white-screens a whole screen until restart (3 prior incidents in this file).

**Rule**:
1. Runtime WRITES (`addMoodEntry`, activities delete/reorder, groups delete, data-export import, DBViewer edit, generateData) MUST use `db.withExclusiveTransactionAsync`. Enforced by `__tests__/exclusiveTransactions.test.ts` (class-level invariant: no non-exclusive `withTransactionAsync(` in the runtime db modules; each write module opens >=1 exclusive txn). Proven in both revert directions.
2. READS get NO transaction. Over-applying exclusive to a READ (`getMoodEntries`: `SELECT *` plus a per-entry `Promise.all` of sub-reads) held the exclusive lock across ~510 serialized queries on a 255-entry DB = a ~3.2s main-thread block (`Choreographer: Skipped 191 frames!`). A list read needs neither exclusivity nor a transaction; the focus-refresh re-reads anyway.
3. Every data screen exports a recoverable `ErrorBoundary` (`components/ScreenErrorFallback.tsx`, "Try again" -> `retry`) so a render-throw is recoverable inline, not blank-until-restart. Attach at SCREEN level (inside `SettingsProvider`) -- a layout-level boundary renders OUTSIDE its own providers and crashes on `useThemeColors()`.
4. Async loaders consumed by `useDataRefresh` need an out-of-order guard (`hooks/useLatestRun.ts`) so a slow stale reload can't clobber fresh data (applied to Home `fetchData`).

**Verified**: v2.3.4 release APK on the Pixel 3 (data survived the v2.3.1 -> v2.3.4 `adb install -r` update path), Home never blanks across adds + tab-switch stress + background/foreground.

**Follow-ups**:
- **Timeline can blank under aggressive rapid tab-switching** -- **FIXED 2026-06-27 (ships in 2.3.5, NOT in the in-review v2.3.4)**. Root cause confirmed in-code: `DBViewer`'s `loadInitialData` (and `loadMoreData`) is an uncancelled async loader driven by `useDataRefresh` with no recency guard -- the same race class as Home's old `fetchData`, but it never got the latch. Two overlapping loads resolve in either order; a stale run resolving last overwrites fresh state, and when its read came back short/empty the list blanks (`sections=[]` -> `<EmptyState/>`) until remount. (`getMoodEntries` was correctly ruled out as DEAD CODE -- not the cause.) Fix: applied `hooks/useLatestRun.ts` to BOTH DBViewer loaders (mirrors Home `fetchData`) so a stale run can never clobber a fresher one. Regression test `__tests__/dbViewerLoadRace.test.tsx` forces the out-of-order resolution deterministically and was verified RED before the fix; full suite 605/605 green. Still owes the one consolidated on-device QA pass when 2.3.5 is built (rapid tab-switch Home<->Timeline with many entries -> list never blanks).
- **Home does not update the new entry IMMEDIATELY in-place** after Submit on the already-focused Home tab (shows stale "No entry yet" for a few seconds; corrects on next focus / tab return). Mild, pre-existing, self-healing -- NOT the catastrophic blank. The refreshCount-bump-while-focused path may not re-run `fetchData` promptly.

**Date**: 2026-06-26

## 2026-06-16: Local `node_modules` is missing test-only deps — judge the GATE by DELTA, not absolute pass
**Context**: A clean v2.3.1 working tree already produces **26 `tsc` errors** and **17 jest suites that
"fail to run"** locally. Every one is a missing-module error (`@testing-library/react-native`,
`expo-file-system/legacy`, `react-native-sortables`) — i.e. the local install lacks some dev/legacy deps;
they resolve in CI (`release-apk.yml` / `release.sh` do a full `npm ci`). The actual unit tests all PASS.
**Rule**: Don't panic at the 26 tsc errors / 17 failing suites — they are a pre-existing ENV gap. Gate your
change by the DELTA: stash your edits, capture the baseline `tsc` error count + `jest` "Tests: N passed" line,
then confirm (a) zero new tsc errors mention YOUR files and (b) the jest pass count only grew. Run your own
suite directly (`npx jest <yourSuite>`) to prove your tests are green.
**Date**: 2026-06-16

> **v1.2.3 SHIPPED (2026-06-12)** via a NEW free GitHub Actions CI lane (the modal->overlay
> touch fix). Release: https://github.com/Antimatter543/mood-tracker/releases/tag/v1.2.3 —
> signed `SoulSync-1.2.3.apk`, cert-parity == v1.2.2 (verified), update-path tested on the Pixel
> (`adb install -r` over v1.2.2, no INSTALL_FAILED_UPDATE_INCOMPATIBLE), and the previously-DEAD
> mood-picker swipe + activity form drive cleanly on the release build. EAS quota was exhausted
> until 2026-07-01, so we built on CI instead (see "GitHub Actions release lane" below). The repo
> invariant held throughout (tag == app.json 1.2.3 == APK versionName 1.2.3 == release asset).

> **v2.0.0 SHIPPED (2026-06-12)** — the Expo **SDK 52→56** platform upgrade (RN 0.76→0.85, React
> 19.2.3, TS 6.0, Reanimated 4, RTR→RNTL, react-navigation deps dropped). Built+released on the SAME
> free CI lane (tag push → signed `SoulSync-2.0.0.apk` → GitHub Release). Full device QA on the Pixel
> 3 passed: cert parity `db328ae9…c4e02ab`, **data-survival update-path verified TWICE** (`adb install
> -r` SDK-56 over v1.2.3, then v2.0.0 over that — both `Success`, zero data loss, 3 entries intact
> through the whole chain), **chart-kit renders fine on RN 0.85/new-arch** (the one open risk — line +
> bar + heatmap + distribution all draw; gifted-charts swap NOT needed), all 5 themes + edge-to-edge
> clean (corner pixels = theme bg, not white), **expo-notifications 56.0.17 fires on the R8 build**
> (notification rendered in the shade; receiver class + channel + alarm all survive minification).
> Release: https://github.com/Antimatter543/mood-tracker/releases/tag/v2.0.0. Endgame detail +
> the per-check QA table: `frontend/docs/sdk56-endgame-notes.md`.

## 2026-06-13: Edge-to-edge bottom safe-area + keyboard — two non-obvious gotchas (v2.3.1)
**Context**: This app is unconditionally edge-to-edge (Expo SDK 56 / RN 0.85 / targetSdk 36).
Owner reported (a) the app "doesn't respect the bottom of the phone" (tab bar flush UNDER the
Android nav buttons; FAB overlapping them) and (b) the keyboard covered the entry-form notes input.

**Gotcha 1 — a FIXED `tabBarStyle.height` SUPPRESSES react-navigation's bottom-inset padding.**
expo-router's BottomTabBar (`node_modules/expo-router/.../bottom-tabs/views/BottomTabBar.js`
`getTabBarHeight`) normally adds `insets.bottom` to its DEFAULT height + paddingBottom — BUT it
short-circuits: `const customHeight = 'height' in flattenedStyle ? flattenedStyle.height : undefined;
if (customHeight != null) return customHeight;`. So our fixed `height: 64` returned verbatim, the
`+ insets.bottom` was bypassed, and on a 3-button-nav Pixel (inset ≈ 48dp) the bar sat flush under
the nav buttons. **Rule**: when you OVERRIDE the tab bar `height`, you OWN the inset — compute
`height = BASE + insets.bottom` AND `paddingBottom = BASE_PAD + insets.bottom` (so the icon/label
band keeps its visual height and the bar only GROWS downward into the system-nav region). Same for
the FAB (`bottom = GAP + insets.bottom`) and any absolute bottom-anchored element. NEVER hardcode the
inset (3-button ≈ 48dp, gesture ≈ 24dp, 0 on no-inset displays) — read `useSafeAreaInsets().bottom`.
The tab-bar style math lives in the UI-free `lib/tabBarStyle.ts` (`buildTabBarStyle`) so it's
jest-testable without importing the route module (which drags expo-router's untranspilable ESM
`standard-navigation` into jest — importing `app/(tabs)/_layout.tsx` in a test FAILS).

**Gotcha 2 — keyboard occlusion under edge-to-edge took THREE attempts; the trap was the height SOURCE,
not the padding architecture.** This is the load-bearing lesson — read it before touching keyboard code.

- **Attempt 1 (FAILED on release APK): `KeyboardAvoidingView`.** Followed Expo's guide
  (docs.expo.dev/guides/keyboard-handling): KAV with `behavior={Platform.OS === 'ios' ? 'padding' : undefined}`.
  Passed jest + Expo Go, FAILED on the release APK (Pixel 3, Android 12, edge-to-edge, 3-button nav,
  `decorFitsSystemWindows=false`): the Notes EditText stayed at its no-keyboard bounds [55,1435][1025,1710],
  fully BEHIND the keyboard; the ScrollView stayed full-height with the keyboard up. Under enforced
  edge-to-edge `adjustResize` no longer resizes the window, so a KAV with `behavior=undefined` is a NO-OP
  (and even an ACTIVE KAV only resizes the container — it won't PAN a ScrollView to the focused field).
  `softwareKeyboardLayoutMode: "resize"` in app.json is necessary-but-insufficient for the same reason.
  (Also note: KAV's 'padding' case does `StyleSheet.compose(style, {paddingBottom: <kbHeight>})`, so a
  static `paddingBottom` set on the KAV itself gets CLOBBERED — keep static padding on an inner View.)
- **Attempt 2 (FAILED, identical bounds): right architecture, DEAD height source.** Replaced the KAV with
  the correct deterministic structure — pad the scroll container's `contentContainer.paddingBottom +=
  keyboardHeight` (gives physical scroll RANGE; without it content fits the window exactly so there's
  nothing to scroll) + `scrollToEnd` on Notes focus — BUT fed it `keyboardHeight` from RN's JS
  `Keyboard.addListener('keyboardDidShow')`. **That source returns 0 under Android edge-to-edge**: RN
  derives the Android keyboard height from the window-RESIZE delta, and the window never resizes under
  edge-to-edge, so the event reports height 0. Padding by 0 = zero movement (corroborated: the centered
  activity dialog padded by an "804px" keyboard barely moved). The padding/scroll architecture was 100%
  correct; only the number flowing into it was dead.
- **Attempt 3 (the fix): keep the architecture, swap the height SOURCE to `useAnimatedKeyboard`.** The
  correct edge-to-edge height source is Android's native `WindowInsetsAnimation` callback, which
  reanimated 4.3.1 (ALREADY a dep, bundled in Expo Go → no new native dep, dev loop intact) exposes via
  `useAnimatedKeyboard()`. It returns `{ height: SharedValue<number>, state: SharedValue<KeyboardState> }`
  on the UI thread. `hooks/useKeyboardHeight.ts` now wraps it and bridges height→JS state via
  `useAnimatedReaction(() => Math.round(keyboard.height.value), (cur,prev)=>{ if(cur!==prev) runOnJS(setHeight)(cur); })`,
  so EVERY existing consumer (EntryForm contentContainer padding, OverlayModal card-layer / fullScreen
  padding, the Notes scrollToEnd-on-focus + keyboard-rise effect) keeps consuming a plain number,
  unchanged. (Hook is `@deprecated` in favour of `react-native-keyboard-controller` — a native module not
  in Expo Go — so the built-in hook is the correct in-budget choice.)
- **CRITICAL edge-to-edge options (prescribed, NOT guessed)** — the native math in
  `node_modules/react-native-reanimated/android/.../keyboard/Keyboard.java updateHeight`:
  `keyboardHeight = ime.bottom - (isNavigationBarTranslucent ? 0 : systemBar.bottom)`. Our app is
  UNCONDITIONAL edge-to-edge (both system bars drawn behind), so pass **BOTH** translucent flags `true`:
  `useAnimatedKeyboard({ isStatusBarTranslucentAndroid: true, isNavigationBarTranslucentAndroid: true })`.
  `true` → the FULL keyboard height from the screen bottom (~804 on the Pixel 3, exactly what we pad by);
  `false` → the nav-bar inset (~48dp) is wrongly SUBTRACTED, under-reporting the height. (Docs:
  translucent=true → margin 0; status-bar-translucent=true → top margin 0.)

**Rule**: For keyboard-over-input on an edge-to-edge Expo app, do NOT use `KeyboardAvoidingView` or RN's
`Keyboard` JS events (both dead on Android edge-to-edge). Get the height from reanimated
`useAnimatedKeyboard` with BOTH `*TranslucentAndroid` flags `true`, pad the scroll container's
contentContainer by it (real scroll range), and scrollToEnd / scroll-the-field-into-view on focus +
keyboard-rise. Do NOT add `react-native-keyboard-controller` (native, not in Expo Go → breaks the dev loop).
**Verify keyboard behavior on the RELEASE-shape APK, NEVER Go/jest** — Expo Go's host app has a different
`windowSoftInputMode` and jest has no live keyboard, so BOTH gave a false PASS on the two broken versions.
A live on-screen `kb:<height>` debug readout (gated by a `DEBUG_KB` const) makes the next QA decisive:
`kb:0` = source still dead, `kb:~300-800` + field lifts = ship.

**Demo data for release builds (no `__DEV__` seed button)**: `scripts/make-demo-data.js`
(`node scripts/make-demo-data.js > /tmp/x.json`) emits SoulSync export-format v2 JSON loadable via
Settings → Import Data on ANY build. Generation is a pure exported `generateDemoData({today,days,seed})`
(mulberry32 PRNG → reproducible); CLI is a thin wrapper. Round-trip test feeds the output through the
REAL `importDatabaseData` over a mock DB. Key schema facts: importer requires `{version, data}`; entries
upsert via `INSERT OR REPLACE INTO entries (id,mood,notes,date)`; activities reference comma-joined
`activity_ids` mapped to seeded rows by `(name, group_id)` — so include the default activities/groups
(mirrored from `components/seedData.ts`, AUTOINCREMENT ids 1..N in group order). Dates pinned to LOCAL
NOON so the local-day key (`localDateString`) is timezone-robust. Photos OMITTED (export carries
file-path refs only, broken on a new device).

**On-device verification deferred to QA** (jest has no live keyboard / real insets): the v2.3.1 KEYBOARD
re-fix MUST be re-verified on the release APK — focus Notes → field + typed text visible above the
keyboard, form scrolls with the keyboard up, same for the activity-name edit field. (Task 1 bottom insets
+ Task 3 demo data already PASSED release-APK QA; only the keyboard re-fix is outstanding.)
**Date**: 2026-06-13

## 2026-06-13: Keep icon/data registries UI-free so lightweight consumers (+ their tests) don't transitively import reanimated
**Mistake/friction**: The icon catalog + family map + icon types lived INSIDE `IconPicker.tsx`,
which imports `OverlayModal` -> `react-native-reanimated`. Reanimated initialises the native
worklets runtime at module-eval, which THROWS under jest. So every lightweight consumer that
only needed the family map (ActivityRow, the new shared `activityIcon`, ActivityReorder,
`components/types`) transitively pulled reanimated, and any test importing them had to
`jest.mock('react-native-reanimated', ...)` — and when one suite forgot the shim, it poisoned
OTHER suites running in the same worker (iconCatalog passed alone but failed when a sibling
unmocked-reanimated suite ran first). Symptom: `new WorkletsErrorConstructor ... NativeWorklets`
at an import line, intermittent based on suite order.
**Rule**: Data + registries (catalogs, family->component maps, types, pure config) belong in a
UI-FREE module (`components/iconRegistry.ts`) with ZERO modal/reanimated/animation imports. The
heavy UI component (the picker) re-exports them for back-compat, but lightweight renderers and
tests import from the registry directly — no reanimated in their graph, no per-test shim. The
single shared glyph renderer is `components/activityIcon.tsx` (`ActivityIcon`, takes
`iconName`+`iconFamily` strings, not a full Activity), used by Timeline + Home so mood/activity
glyphs map identically app-wide. General principle: a module's import graph is part of its API —
a "just a constant" import that drags a native runtime into jest is a layering bug; fix the
layering, don't paper it with mocks.
**Date**: 2026-06-13

## 2026-06-13: Custom SVG charts > chart-kit — measure width via onLayout, put path math in a tested pure transform
**Context**: Replaced react-native-chart-kit's `LineChart` on Home with our own
`components/visualisations/MoodWeekChart.tsx` (react-native-svg, already a direct dep). chart-kit
was the unpolished piece (cramped y-axis, bezier overshoot beyond the data range, clipped end
dots, red dots for interpolated points reading as "error days"). Durable patterns for the next
chart we build:
- **Width via `onLayout` measurement, NOT `SCREEN_WIDTH - padding` guessing.** The measured
  card-content width is theme/orientation robust and never clips end dots. Gate the SVG render on
  `width > 0` (mirrors ActivityCorrelationChart). In jest the `onLayout` never auto-fires, so a
  width-gated chart renders nothing until you `await act(async () => fireEvent(node,'layout',{
  nativeEvent:{layout:{width,height,x,y}}}))` — give the wrap a `testID` to target it.
- **ALL path math in a pure transform** (`transforms/chartGeometry.ts`, zero React/svg imports)
  so it's exhaustively jest-tested: mapping orientation (mood 0->bottom, 10->top), even index
  spread, the **no-overshoot invariant** (every path y within the real-points y-range — straight
  segments guarantee this; a sampling test proves it), and the edge shapes (empty / single point
  / all-same / leading+trailing null / interior gap / all null / NaN-as-missing / degenerate
  dims never NaN). The SVG component is then a thin renderer.
- **Missing data must read as ABSENCE, never alarm**: real points = solid dots colored by the
  canonical `moodColor` ramp (consistent with timeline/heatmap); missing days get NO dot and the
  line is DASHED across an interior gap (not a red dot). Reuse `moodColor.ts` for chart dot color
  so mood color is one authority app-wide.
- Straight segments (not bezier) for the line — they CANNOT overshoot and read clean/systematic.
  Scope was Home only; Stats/Insights still use chart-kit (a later batch), but MoodWeekChart is
  built reusable so they can adopt it.
- **Shared "Overview" tile primitive** `components/StatTile.tsx` (36px accent chip + 18/700 value
  + 12 muted label) now backs BOTH the Stats StatSummaryCard grid and Home's monthly-overview —
  one systematic component, not two hand-rolled grids. (NEEDS on-device QA: see below.)
**Date**: 2026-06-13

## 2026-06-13: SQL must NEVER day-bucket a stored timestamp — JS owns day-keying via localDateString; pin jest to a non-UTC TZ
**Mistake**: Entries store as UTC ISO instants (correct), and the DatePicker normalises a
backdated entry to LOCAL midnight (correct: Thursday 00:00 AEST = Wednesday 14:00 UTC). But the
visualisation SQL bucketed days with `date(date)` / `GROUP BY date(date)` / `strftime('%w', date)`,
and SQLite's `date()`/`strftime()` run in UTC. So for ANY UTC+N user, every entry between local
00:00 and local N:00 — which includes EVERY backdated entry — mis-bucketed to the PREVIOUS day:
the Home chart's green dot landed a day early, the streak dropped (Anti: "streak says 1 instead of
2"), and the heatmap/calendar/insights all mis-placed it. The bug was INVISIBLE to 416 passing
tests because (a) the SQL strings never EXECUTE under jest, and (b) jest ran in the machine's TZ
with no pin — almost always UTC, where local==UTC and the bug can't reproduce.
**Rule** (DOCTRINE — enforced by `__tests__/queriesNoDateBucketing.test.ts`, a class-level
invariant): SQL does exactly two things — (a) RANGE-FILTER on the stored instant with
parameterised UTC ISO bounds (`WHERE date BETWEEN ?start AND ?end`, bounds from
`startOfLocalDay`/`endOfLocalDay`/`computeWindow` in JS), and (b) return the RAW `date` instant.
SQL must NEVER call `date()`/`strftime()` on a stored timestamp to group/key/extract-DOW. ALL "which
local day is this entry on" logic goes through `localDateString` — wrapped by the ONE transform
`components/visualisations/transforms/dailyAverages.ts` (`aggregateDailyAverages` / `dailyAverageRows`
/ `dailyAverageMap` / `bestDayLocal`). Day-of-week is derived in JS too (`aggregateDowRows`), and
activity-correlation day-keying (`aggregateActivityCorrelation`). Do NOT "fix" this with SQLite's
`'localtime'` modifier — it works on-device but is untestable under jest and creates a SECOND TZ
authority. The invariant test scans every exported SQL string in queries.ts + every visualisation
source file (comments stripped, JS `new Date(` excluded) for `date(date)` / `strftime(...date...)`
and fails the build if one reappears — so move any inline screen SQL into queries.ts as a named
export (did this for Home's monthStats -> `MONTHLY_DAILY_AVERAGES` and `_layout`'s reminder feed ->
`RECENT_ENTRY_DATES`) so the invariant covers it.
**Testing rule (load-bearing)**: jest is pinned to a non-UTC TZ via `jest.tz.js`
(`process.env.TZ='Australia/Brisbane'`, UTC+10 no DST) as the FIRST entry in package.json
`jest.setupFiles` (before jest.setup.ts, so TZ is set before any Date is touched).
`__tests__/timezonePin.test.ts` asserts the offset is -600 so the pin can't silently drop. Any new
TZ-sensitive logic gets a regression test that would FAIL under UTC keying (proven here by a
temporary revert: flipping `aggregateDailyAverages` back to `toISOString().slice(0,10)` made 13
assertions fail). The reported bug's exact regression lives in
`__tests__/timezoneDayKeying.regression.test.ts`. Construct local-day instants with
`new Date(2026, 5, 11).toISOString()` (NOT a UTC ISO literal) so the local-vs-UTC distinction is
real under the pin. The READ CONTRACT in `databases/dateHelpers.ts` documents the doctrine.
**Date**: 2026-06-13

## 2026-06-13: The Yoga shrink-wrap law has now bitten THREE times — treat every % / stretch child as suspect until its parent's width chain is verified
**Mistake(s)**: (1) v2.1.0: OverlayModal's styleless `<Pressable>` shrink-wrapped → dialog `width:'94%'`
rendered at ~49% (entry below). (2) v2.2.0: EntryPhotos' single-photo hero `Image width:'100%'` resolved
against an unsized `<Pressable>` wrapper → ~40%-wide portrait box instead of full-width hero. (3) v2.2.0:
EntryCard passed `flexDirection:'row'` via `Card`'s `style` prop — but `Card` styles its OUTER container
and renders children inside its own inner `<View>` (column) → the in-flow 4px accent bar collapsed to a
4px-TALL invisible sliver.
**Rule**: Two laws, check both whenever a size "mysteriously" shrinks:
- **%-width/stretch resolves against the DIRECT parent.** Any `width:'100%'`/percentage child inside a
wrapper you didn't explicitly size (especially a bare `<Pressable>`/`<View>` between a flex parent and the
sized child) → give the wrapper `alignSelf:'stretch'` or absolute-fill, or remove it. Grep candidates:
`width: '100%'` and `%'` near `Pressable`.
- **Shared wrapper components are composition-opaque.** `Card`-style components apply your `style` prop to
their OUTER box while your children land in an INNER wrapper — layout styles (flexDirection, alignItems)
passed through `style` never reach your children's real parent. Read the wrapper's source before styling
through it; for edge-decorations (accent bars) prefer `position:'absolute'` + the wrapper's own
`overflow:'hidden'` clipping.
On-device screenshot is the only reliable verifier — all three shipped past tsc/jest and were caught by eyes.
**Date**: 2026-06-13

## 2026-06-13: Data refresh must be FOCUS-aware, not just a refreshCount counter (frozen blurred tabs)
**Mistake**: Every data-reading screen reloaded via `useEffect(() => load(), [db, refreshCount])`.
Adding an entry bumped `refreshCount` but the timeline/stats stayed STALE until a full app reopen.
Root cause: expo-router v6 bottom-tabs (SDK-56 forked react-navigation) FREEZE blurred tabs —
`BottomTabView.js:202` wraps each inactive tab in `<MaybeScreen shouldFreeze={activityState===STATE_INACTIVE && !isPreloaded}>` → react-native-screens `<Screen>` → react-freeze `<Freeze>`. A frozen
subtree is SUSPENDED, so React never runs its effects. A `refreshCount` bump while a screen is blurred
is invisible to that screen's reload effect.
**Rule**: Read data through `hooks/useDataRefresh(load, extraDeps)` (wraps expo-router's `useFocusEffect`).
It reloads on every FOCUS gain (navigating to a tab always refetches — no reopen) AND re-runs while
focused when `refreshCount`/extraDeps change (live in-focus updates). Verified against
`expo-router/build/useFocusEffect.js`: it resolves the NEAREST route's focus, so chart cards nested in a
tab screen correctly refetch on that tab's focus; it forwards a returned cleanup on blur/unmount and
swallows async Promises (the hook matches that contract). KEEP `refreshCount`/`refetchEntries` — writers
bump it, the hook consumes it. Put `db` + any timeframe/prop in `extraDeps`. NEVER add a new
`useEffect([db, refreshCount])` data-load — use the hook. Tests: `__tests__/useDataRefresh.test.tsx`.
**Corollary (DBViewer)**: a modal/edit form whose mount sits BELOW an `if (isLoading) return` /
`if (empty) return` gets UNMOUNTED when a focus refetch flips `isLoading` — destroying the user's draft.
Render such overlays UNCONDITIONALLY (loading/empty/list chosen inline, form always mounted), and show the
full-screen spinner only on the INITIAL load (keep the stale list visible on refetch — no spinner flash).
Guard: `__tests__/dbViewerEntryFormMount.test.tsx`.
**Date**: 2026-06-13

## 2026-06-13: Icon catalog + seed icons need a glyphmap-validation test (invalid names render "?")
**Mistake**: `IconPicker.tsx` `ICON_CATEGORIES` carried names that don't exist in their family's glyphmap
(`refresh`/Feather, `brain-freeze` + `guitar`/MaterialCommunityIcons) → console warns + fallback "?"
glyph. Separately, line-8 imported `FontAwesome6` from `@expo/vector-icons/MaterialCommunityIcons`, so the
seeded "Okay Sleep" activity (`icon_family:'FontAwesome6', icon_name:'bed'`, persisted by
`databases/migrations.ts` `updateV1ActivitiesToV2`) rendered a fallback glyph.
**Rule**: Every catalog/seed icon name MUST exist in its family's glyphmap at
`node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/<Family>.json` (FA6 uses
`FontAwesome6Free.json`; the FA6 import must be the REAL `@expo/vector-icons/FontAwesome6`, NOT MCI — a
migrated DB can reference the FA6 family, so fix the import, don't drop the family). `__tests__/iconCatalog.test.ts`
asserts the whole catalog + all seeds against the glyphmaps — a CLASS-LEVEL invariant test (validate every
icon, not one) that permanently blocks invalid-icon regressions. When adding an icon, run that test.
**Date**: 2026-06-13

## 2026-06-12: OverlayModal dialog width collapse + Expo-Go boots crash on the notifications native import

Two gotchas hit while fixing the Edit-Activity device-QA batch on `qol/v2.1.0`.

**1) A %-width dialog card collapsed to ~49% because a STYLELESS `<Pressable>` shrink-wrapped it.**
`components/OverlayModal.tsx` (dialog variant) used to render the centered card as
`<Pressable backdrop flex:1 center><Pressable onPress={noop}>{children}</Pressable></Pressable>`.
The inner no-op `<Pressable>` had NO style → `width: auto` → under the backdrop's `alignItems:
'center'` it shrink-wraps to its content. A child card sized `width: '94%'` (ActivityEditModal's
`modalContent`) then resolves that `94%` against the shrink-wrapped Pressable, not the screen — Yoga
settles at a fixed point of ~49% of screen width (measured 530px on the 1080px Pixel). The buttons
inside (`flex:1`) then truncated to "Delet"/"Updat". **Rule:** a `%`-width view must have an ancestor
with a CONCRETE width as its basis; never let a styleless `auto`-width node sit between the centering
container and a `%`-sized card. Fix that ships: split into a full-screen **backdrop** Pressable +
a sibling full-screen **`box-none` card layer** (`justifyContent/alignItems:center`) so the card's
`%` resolves against the real screen width (→94%); the no-op tap-swallow Pressable is
`alignSelf:'stretch'` (full width, does NOT shrink-wrap) so card-padding taps are still swallowed
while top/bottom-margin taps fall through to close. All 3 dialog consumers (ActivityEditModal 94%,
Add/Group modals 90%) inherit the fix and each resolve their own declared %. **Verify card width
on-device by isolating the DIALOG node** (y-extent ~199..966, width 800–1080) — the hub/Home cards
behind the modal are 970px (`marginHorizontal`) and will mask the real modal node if you just grep
the widest node.

**2) The app WHITE-SCREENS at splash in Expo Go (Android) because `lib/notifications.ts` did a bare
top-level `import * as Notifications from 'expo-notifications'`.** Expo Go strips expo-notifications'
native module on Android (since SDK 53), so that import THROWS at module-eval. Because
`app/(tabs)/_layout.tsx:16` imports `lib/notifications`, the throw aborts the ROUTE module's
evaluation → its default export is undefined → expo-router crashes reading `.ErrorBoundary` off
undefined → stuck on the splash, no UI. This is the real reason "Expo Go can't run this app" beyond
the old SDK-mismatch note. **Fix:** load expo-notifications LAZILY via a guarded `getNotifications()`
(try/catch `require`, cached, returns null when absent) and make every public fn no-op/default when
null — mirrors the already-guarded `react-native-haptic-feedback`. On a dev-client/release build the
module is present and behaves exactly as before (the v2.0.0 R8 notification-fire test still holds).
After this, Go boots fully and the overlays drive via adb. The remaining LogBox warning in Go
("push notifications… removed from Expo Go") is the caught warning — non-fatal. **Rule:** NEVER do a
bare top-level import of an optional native module that Expo Go strips, anywhere in the route-module
import graph — one such import white-screens the whole app. Guard it (lazy require + null no-op).

**Date**: 2026-06-12

## 2026-06-12: A Sortable.Grid chip can't ALSO host a long-press-to-edit — give edit its own door

**Mistake**: After wrapping the activity chips in `react-native-sortables` `Sortable.Grid`
(`dragActivationDelay={300}`), the chip's `Pressable onLongPress` (`delayLongPress={500}`) that
opened the edit modal became UNREACHABLE on a real finger — the drag gesture activates at 300ms at
the RNGH/worklet layer and cancels the Pressable long-press. Hold-duration can't discriminate
edit-vs-drag on the same element: the shorter timer eats the other.

**Rule**: On this grid, **drag owns reorder; editing gets a SEPARATE, explicit path** — the group
"..." popover -> "Edit Activities" hub (`components/forms/ActivityReorder.tsx`), where each row taps
to open `ActivityEditModal` (which already holds BOTH Update and Delete, so deletion stays
reachable). Do NOT try to restore a chip long-press via `react-native-sortables`' `Sortable.Touchable`:
it exists (`onTap/onDoubleTap/onLongPress/onTouchesDown/Up`, `failDistance` default 10, `gestureMode`
default `exclusive`) and composes each gesture `simultaneousWithExternalGesture(itemDragGesture)`, so
its `onLongPress` fires SIMULTANEOUSLY with the drag's own activation -> the edit modal pops mid-drag
= worse than the original bug. `onTap` is the only clean one, but tap is already owned by
toggle-selection on this grid. There is no grid-level `onItemPress`/stationary-hold-and-release
callback. (v1.9.4 — re-check the dist/typescript types if the lib is bumped.)

**Date**: 2026-06-12

## 2026-06-12: SDK-56 endgame device-QA gotchas (carries forward to every future on-device pass)

**Mistake / friction encountered during the v2.0.0 endgame device QA, and how to avoid it:**

1. **uiautomator dump coords are DEVICE resolution (1080×2160), NOT the downscaled screenshot.**
   The `adb exec-out screencap` PNG is ~500px wide; tapping at screenshot coords misses. ALWAYS get
   tap targets from `uiautomator dump` bounds (e.g. the FAB "Add mood entry" is at device-center
   ~(937,1841) on Home, not the ~(432,791) the screenshot suggests). The floating-tab-bar centers are
   at **y≈2011** (Home 108 / Stats 324 / Timeline 540 / Insights 756 / Settings 972). The FAB y SHIFTS
   per screen (1841 on Home, 1709 on the activity step) — re-dump, don't reuse a stale y.

2. **The Settings layout SHIFTS when a non-System theme is selected** (the "Dark Theme" toggle row is
   hidden with the note "The Dark Theme toggle is hidden because you've selected a specific theme"),
   so the App-Theme select value moves from y≈1002 (System Default) up to y≈790 (explicit theme).
   Re-dump after every theme change before tapping. The 5 themes drive cleanly via the overlay theme
   picker (System Default / Light / Dark / Cherry Blossom / Midnight Blue / Forest → Close).

3. **The native Android TimePickerDialog (Reminder Time) is hostile to synthetic `adb input text`** —
   keyboard-entry mode kept dismissing the dialog. The reliable path is the **analog clock face**:
   tap PM → tap the hour number on the ring → it auto-advances to minute mode → tap the minute tick →
   tap OK. (Clock numbers + minute ticks are at fixed ring positions; get them from the dump.) `adb`
   CANNOT set the system clock on this production device (`adbd cannot run as root in production
   builds`), so you cannot fast-forward to a scheduled time — instead set the reminder a few minutes
   ahead of the real device clock and wait (the wait is fine).

4. **Notification R8-survival has FOUR independent proofs** (use them; don't rely only on the visual):
   `adb shell dumpsys package … | grep Receiver` shows
   `expo.modules.notifications.service.NotificationsService` un-obfuscated (class not stripped);
   `dumpsys notification | grep <pkg>` shows the `daily-reminder` `NotificationChannel` (color
   `0xff4caf50`); `dumpsys alarm | grep <pkg>` shows the scheduled `RTC_WAKEUP`; and after firing, a
   live `NotificationRecord` with `tag=soulsync-daily-reminder`. All four present = R8 didn't strip it.

5. **Maestro `soulsync-tour.yaml` is BRITTLE on a cold start** — its `assertVisible "Good
   (morning|afternoon|evening)"` raced the JS bundle render and FAILED on a healthy app (the failure
   screenshot showed a fully-rendered Home; a manual dump confirmed "Good afternoon"). It was ALSO
   written for the seeded-50-entries dev build (photo-picker beats don't apply to a release APK). So:
   treat a single Maestro greeting-assert failure as a flow-timing artifact, confirm via `uiautomator
   dump` before calling it a regression. (Cleanup TODO: add a wait/retry before the greeting assert,
   and make the photo beats `optional`.) Manual adb-driven QA covered every beat the tour would.

**Rule**: On-device QA for this app = drive overlays via `uiautomator dump`-derived DEVICE coords
(re-dump per screen, layouts shift); verify notifications via the 4 dumpsys signals not just the
shade; set reminder times via the clock FACE not keyboard entry; and don't trust a lone Maestro
greeting-assert failure — verify against a dump. The data-safety gate is the `adb install -r` (NO
uninstall) update-path test — `Success` + entries visible on Home/Timeline/Stats = migrations
survived. **Date**: 2026-06-12

## 2026-06-12: GitHub Actions release lane — free, EAS-quota-free signed APK builds

**Context**: `.github/workflows/release-apk.yml` builds a SIGNED release APK on a tag push (-> GitHub
Release) or `workflow_dispatch` (-> APK as a run artifact, for branch QA). Born because the EAS free Android
build quota was exhausted until 2026-07-01 and this is a public repo (CI = free + unlimited). Full doc:
`frontend/docs/RELEASING.md` "Two build lanes". Durable gotchas a future session will hit:

1. **Exporting the keystore from EAS = interactive pty, no flag.** `eas credentials -p android` has NO
   non-interactive download flag (RTFM'd: only `-p`). Drive the menu: profile selector (arrow to `preview`)
   -> "Keystore: Manage everything..." (Enter) -> submenu order is `Set up a new` / `Change default` /
   `Download existing keystore` (2x DOWN from default) / `Delete` (NEVER select Set-up or Delete) -> Enter
   -> "Do you want to display the sensitive information? (Y/n)" -> `y`. It writes the `.jks` to CWD as
   `@<account>__<slug>.jks` and PRINTS the keystore password / key alias / key password. A reusable
   text-matching pty driver is at `~/tmp-keystore/download_keystore.py` (reacts to prompts by name, never
   blind arrow-counting; ALWAYS probe the menu read-only first to confirm item order before selecting).
   **EAS downloads into CWD — move the `.jks` OUT of the repo tree immediately** (`*.jks` is NOT in the
   frontend `.gitignore`).

2. **CI signs via `-Pandroid.injected.signing.*`, not a keystore.properties file.** Cleaner for the
   CNG-generated `android/` (gitignored + regenerated by `expo prebuild`): pass
   `-Pandroid.injected.signing.store.file=$RUNNER_TEMP/release.keystore` + `.store.password` + `.key.alias`
   + `.key.password` to `gradlew assembleRelease`. Secrets flow via `env:` into that step only; no `set -x`/echo.

3. **Cert parity is the whole game** (a mismatched signature = can NEVER update over installed builds = user
   data loss). The CI keystore MUST equal the cert that signed the last release. Verify three ways, all must
   match: `keytool -list -v -keystore <jks>`, `apksigner verify --print-certs <deployed.apk>`, and EAS's
   printed "SHA256 Fingerprint". For SoulSync:
   `DB:32:8A:E9:F4:88:16:44:BE:0D:40:30:21:2E:2E:65:09:38:78:F3:5E:71:9D:9D:62:E2:9B:06:3C:4E:02:AB`.
   **`keytool -printcert -jarfile <apk>` prints NOTHING for these APKs** — v2/v3-signed only (no legacy v1
   JAR signature, normal for R8 builds); `apksigner` is authoritative. Android's `dumpsys package ...
   signatures:[hex]` is a truncated 32-bit id, NOT the SHA-256 — to confirm an INSTALLED build's cert,
   `adb pull` its `base.apk` and run apksigner on it.

4. **The config plugins survive CI prebuild.** `withReleaseAbis` (arm-only ABI split via gradle.properties)
   and `expo-build-properties` (R8 minify + resource shrink) are config plugins, so `npx expo prebuild`
   applies them in CI exactly like EAS. Verified: CI APK ~45.5MB (== EAS), `unzip -l | grep lib/` shows ONLY
   `arm64-v8a` + `armeabi-v7a` (zero x86). No need to hand-edit `android/`.

5. **`scripts/*.js` trips eslint `no-undef` on `__dirname`** with eslint-config-expo 8 (it doesn't assume a
   node env for plain `.js`). So `npm run check` (runs `expo lint`) reports 1 ERROR on `scripts/bump-version.js`
   even though the script is correct. PRE-EXISTING + non-blocking: `scripts/release.sh` gates on
   `tsc --noEmit + jest` ONLY (not lint), so a release is unaffected. The `upgrade/sdk-56` branch added a
   `.eslintrc.js` `overrides` node-env block for `scripts/`+`plugins/` `*.js` — backport that to main if the
   lint error becomes annoying.

**Rule**: To release while EAS quota is out, use the CI lane — `tsc + jest` -> `node scripts/bump-version.js`
-> commit `release: vX.Y.Z` -> tag -> `git push origin main --tags` (the tag push builds + releases).
`workflow_dispatch --ref <branch>` builds any branch as an artifact (this is the SDK-56 runbook's
build step now). Keystore lives in EAS + GitHub repo secrets + Bitwarden; verify cert parity with
`apksigner` before trusting any new APK.

**Date**: 2026-06-12

## SDK 52→56 upgrade — TS6, RN 0.85, RNTL 14, react-navigation drop (2026-06-12, branch `upgrade/sdk-56`)

Full hop-4 notes + the July-1 release runbook: `frontend/docs/sdk56-hop4-notes.md`. The durable
gotchas a future session WILL hit:

1. **TypeScript 6.0 dropped `@types/*` auto-discovery.** TS6's `types` defaults to `[]` (was: include
   all `node_modules/@types`). Without an explicit list, every test loses `describe`/`it`/`expect`/
   `jest` (TS2708/TS2593). The fix lives in `tsconfig.json`: `"types": ["jest", "node", "react"]` —
   **load-bearing, do not remove**; add any new ambient-global `@types/*` package to it or tsc won't
   see it. Expo's own types come via `include`, not this array.

2. **RN 0.85 removed `StyleSheet.absoluteFillObject`** (runtime AND types — only `absoluteFill`
   remains, and it IS the spreadable object now). `...StyleSheet.absoluteFillObject` silently spreads
   `undefined` on 0.85 (a real latent bug, not just a type error). Use `...StyleSheet.absoluteFill`.
   Grep for `absoluteFillObject` before assuming it's gone everywhere (was only in IconPicker).

3. **SDK 56 forked react-navigation into expo-router.** doctor 56 FAILS if `@react-navigation/*` are
   direct deps. They were dropped (our source had zero `@react-navigation` imports incl. hidden
   DarkTheme/ThemeProvider/NavigationContainer cases; expo-router 56 uses internal `standard-navigation`).
   Run `npx expo-codemod sdk-56-expo-router-react-navigation-replace .` first (it was a 0-file no-op
   for us). `@types/react-test-renderer` is now transitive via react-native-gesture-handler — harmless.

4. **react-test-renderer → @testing-library/react-native (RNTL 14).** RTR + @types removed; RNTL 14 +
   `test-renderer@^1.2.0` (a peer, list it explicitly) added. RNTL 14 is ASYNC: `render()`/
   `renderHook()` return Promises; `act`/`rerender`/`unmount` are async. `renderHook().result` is a
   ref → `result.current`. For tree queries use `screen.container.queryAll(n => n.type === 'Text')`
   (string type names, NOT the component; and `container` not `root` — root misses descendants). A
   render error is a REJECTED promise: `await expect(render(<Bad/>)).rejects.toThrow(...)`. Only 3
   files ever used a renderer (overlayHost, useEntryDraft, useMoodScale); the other 29 suites don't.

5. **eslint-config-expo 56 bundles react-hooks 7.x (React Compiler rules) as ERRORS.**
   `react-hooks/immutability` (Reanimated `.value =`; hook-capture test helpers) and
   `react-hooks/set-state-in-effect` (prop-to-state sync; async mount data loads) fire on correct
   code. We don't compile with React Compiler → both **downgraded to `warn` in `.eslintrc.js`** (keeps
   the "0 errors" gate). Also there: a `node` env override for `scripts/`+`plugins/` `.js` (config-expo
   56 stopped assuming node env → `__dirname` no-undef). Flat-config migration still deferred.

6. **babel-preset-expo 56 STILL auto-injects `react-native-worklets/plugin`** (logic moved to
   `node_modules/babel-preset-expo/build/configs/expo.js:109` from `build/index.js` at 55). **NEVER
   create a babel.config.js** — and never add `react-native-reanimated/plugin`.

7. **EOVERRIDE on `--fix` every React bump.** `--fix` writes `dependencies` then aborts before
   devDeps+lockfile. Escape hatch: set the printed devDep targets + bump the `overrides` block
   manually, then `rm -rf node_modules package-lock.json && npm install` (node v24.14 / npm 11.9).
   overrides is now react/react-dom **19.2.3**. expo-notifications locked at **56.0.17** (≥56.0.11 R8
   proguard floor — we minify; the notification-fire device test confirms it at runtime).

## Native `<Modal>` touch dispatch is BROKEN on Fabric — use in-tree overlays; old "synthetic-taps-can't-drive-modals = not a bug" doctrine was WRONG (2026-06-12)

**Doctrine reversal (this supersedes every "Synthetic touch CANNOT drive an open
`<Modal>`" / "real finger only" / "not a bug, automation wall" note below — those
are now WRONG and kept only for history).** Anti (real finger) reported the FAB
"add mood" picker as dead TWICE, including after the v1.2.2 GestureHandlerRootView
"fix". A real finger failing identically to synthetic input proves the modal's
touch dispatch is genuinely broken — it was never merely "un-automatable".

**Root cause**: A native `<Modal>` (transparent or opaque) on RN 0.76 Android new
arch (Fabric, `newArchEnabled: true`) renders into a SECOND native window with its
own React/Fabric root. The JS touch dispatcher for that window's root only ever
receives DOWN, never UP/CANCEL (`Got DOWN touch before receiving UP or CANCEL from
last gesture`), so every control inside the modal — ScrollView, Pressable, FlatList
— is inert to a REAL finger. Fixed in later RN versions we can't reach on SDK 52.
GestureHandlerRootView does NOT fix it (the problem is the window boundary, not the
gesture root).

**The fix (shipped v1.2.3)**: stop using native `<Modal>` entirely. Render
modal-like content as an IN-TREE, full-window overlay that stays in the SINGLE
Fabric root, so touch routing never crosses a window boundary.
- `context/OverlayHost.tsx` — `OverlayProvider` + `useOverlay()`. Mounts content as
  the LAST child of the layout view (paints above the floating tab bar).
- `components/OverlayModal.tsx` — drop-in `<Modal>` replacement (centered-dialog
  variant + `fullScreen` variant) with dimmed backdrop, tap-outside-to-close,
  Android hardware-back (`BackHandler`), and a Reanimated `FadeIn`.
- `EntryFormModal` (EntryForm.tsx) renders through the host directly. SettingRow's
  theme dropdown, ActivityEditModal, ActivitySelector add/group, IconPicker, and
  DBViewer's photo viewer all use `OverlayModal`. Public APIs unchanged.

**CRITICAL placement rule**: `OverlayProvider` MUST sit INSIDE the
SQLite/Data/Settings providers (it lives in `app/(tabs)/_layout.tsx` wrapping
`TabNavigator`), NOT at the root `app/_layout.tsx`. Overlay content consumes those
contexts (`useSQLiteContext`, `useSettings`, `useDataContext`); a root-level host is
above them and redboxes `useSQLiteContext must be used within a <SQLiteProvider>`
the moment overlay content touches the DB (caught on-device advancing the form to
step 2 — ActivitySelector). It still renders above the tab bar because its slots
mount after `<Tabs>` in the same parent.

**QA REVERSAL — synthetic input CAN drive these overlays.** Because there is no
second native window, `mCurrentFocus` stays `MainActivity` when an overlay is open,
uiautomator READS the overlay tree, and `adb input swipe`/`tap` DRIVE it. Verified
the whole bug on-device synthetically: FAB -> swipe picker (`Selected: 5`->`10`->`6`,
the exact dead interaction) -> Continue -> activity step -> Submit -> Home shows the
entry; nested IconPicker 3 overlays deep scrolls + selects. So Maestro/adb full-flow
QA of these forms is now valid — the "verify modal interactions with a real finger
only" rule is DEAD. (A native `<Modal>`, if one is ever reintroduced, would still be
un-drivable — but don't reintroduce one; use the overlay.)

**Rule**: NEVER add a native `<Modal>` (from `react-native`) to this app. Use
`OverlayModal` (dialog/fullScreen) or render through `useOverlay()` directly. New
overlay content that needs DB/settings is automatically fine since the host is inside
those providers. Verify on-device with adb/Maestro — synthetic input now works.

**Date**: 2026-06-12

## Empty-state early return BELOW its hooks -> "Rendered more hooks" crash (2026-06-08)

**Mistake**: While adding the Home weekly-chart empty placeholder, the
`if (isWeekEmpty(data)) return <placeholder/>` early return was placed ABOVE the
two `useMemo` hooks (`interpolateData` + `chartData`) in `WeeklyChartCard`
(`app/(tabs)/index.tsx`). On a FRESH/empty DB the week is empty -> the component
returns early and runs 4 hooks. As soon as the user logs an entry the week is no
longer empty -> the component runs 6 hooks. React throws
`Render Error: Rendered more hooks than during the previous render.` and the
whole Home screen redboxes. The empty path looked fine on-device; the bug only
surfaced when transitioning empty -> populated (i.e. exactly the first-entry
moment we were polishing for). Pure-transform jest tests (`isWeekEmpty`) cannot
catch this; it is a component hook-ordering bug.

**Rule**: A conditional/early `return` inside a component MUST sit BELOW every
hook call. Compute all `useMemo`/`useState`/etc. unconditionally first, then
branch on the result. The work done by a now-unused `useMemo` on the empty
branch is cheap and harmless. `npx eslint app/(tabs)/index.tsx` flags this via
`react-hooks/rules-of-hooks` -- run eslint (not just tsc + jest) on any file
where you add an early return, and ALWAYS verify the empty->populated TRANSITION
on-device, not just the two end states in isolation. (`stats.tsx`'s
`hasEntries === null / !hasEntries` early returns are correctly placed below all
its hooks -- that one is the right pattern to copy.)

**Date**: 2026-06-08

## Four UI/chart fixes + dev-loop notes (2026-06-07)

Fixed four user-reported issues on the standalone release. Notes for future work:

1. **White framing around the floating tab bar** -> the Android window root
   background defaulted to white, peeking through the rounded-corner gaps + the
   safe-area strip below the floating tab bar. Fix:
   `SystemUI.setBackgroundColorAsync(colors.background)` in `TabNavigator`
   (reactive to theme) + `sceneContainerStyle.backgroundColor` on `<Tabs>`.
   `expo-system-ui` is installed; `expo-navigation-bar` is NOT. Verify by
   sampling corner pixels next to the tab bar (should equal theme `background`,
   not `#fff`) — the downscaled screenshot makes `secondaryBackground` look
   "white-ish" so trust the pixel sample, not the eyeball.

2. **Modal forms must scroll** -> the entry form's `contentContainer` was
   `flex:1, center`; on short screens the Continue button was unreachable. Fix:
   the form's root is a `<ScrollView>` with `contentContainerStyle` using
   `flexGrow:1` (NOT `flex:1`) + centred justify + vertical padding, so it stays
   centred when it fits and scrolls when it overflows. Any future modal form
   should do the same.

3. **chart-kit x-axis overlaps on long timeframes** -> `weeklyMood.ts`
   `formatLabel` returned `month:'short'` for EVERY daily point (year/alltime
   plot one point PER DAY, 365+ points), cramming dozens of labels. The chart is
   NOT down-sampled. Fix: for year/alltime, label only ~5 evenly-spaced index
   positions (`isSparseLabelIndex`, anchored at both ends), blank the rest, and
   format as `"Mon 'YY"` so years are explicit. Spread by INDEX, not calendar
   month, because `formatLabel` only sees the current point (no neighbour info).

4. **Year context + recency** -> heatmap `monthLabels` and the trend axis never
   showed the year. Fix: append 2-digit year at each year boundary (January /
   first label) in `heatmap.ts` ("Jan 26"); trend uses `"Mon 'YY"`. Heatmap
   recency: replaced the racy `setTimeout(scrollToEnd, 200)` with
   `onContentSizeChange={() => scrollToEnd()}` on the horizontal ScrollView so
   the newest (rightmost) data is reliably in view on open.

**Dev-loop gotcha**: the device's installed **Expo Go is SDK 56**, but this
project is **SDK 52** — Expo Go refuses to load it ("Project is incompatible").
So the coordinator's "use Expo Go for fast iteration" doesn't apply here; the
`expo run:android` incremental dev build (android/ prebuilt, ~26s) is the loop.

**Seeding year-boundary data without the flaky 50-entry button**: the in-app
"Generate 50 Sample Entries" / Import dialogs are `<Modal>`/`Alert`-based and
CANNOT be driven by synthetic taps (documented modal-touch limitation below).
Instead, on a DEBUG build, seed SQLite directly:
`adb shell run-as com.raeduslabs.soulsync cat files/SQLite/moodTracker.db > /tmp/x.db`,
edit with host `sqlite3`/python, `adb push` to `/data/local/tmp`, then
`run-as ... cp` back into `files/SQLite/` and `rm` the `-wal`/`-shm` journals.
`generateData.ts seedMoodEntries` already spreads dates `2025-01-01..now`, so it
crosses the year boundary if you CAN trigger it.

## Empty-database (fresh-install) crash: heatmap NULL date -> RangeError (2026-06-07)

**Symptom**: On a fresh/empty `entries` table (every new user before their first
entry), the **Statistics** screen white-screened with
`RangeError: Date value out of bounds`, pinned to `CustomHeatmap`.

**Root cause**: `CustomHeatMap.tsx`'s SQL is the ONLY visualisation query that
seeds its date axis from `(SELECT MIN(date) FROM all_entries)`. On an empty
table MIN(date) is NULL, so `start_date` is NULL and the query returns a single
row `{date: null}`. `buildHeatmapGrid` had an empty-array guard but not a
null-date-row guard (`rows.length === 1`), so `addDaysUTC(null, ...)` ran
`new Date("nullT00:00:00Z").toISOString()` which throws. Unhandled in render ->
whole Stats screen unmounts to white.

**Rule**:
1. Any SQL that derives a date axis from `MIN/MAX(date)` (not JS-supplied
   `BETWEEN ?start AND ?end` bounds) MUST filter out null/invalid-date rows in
   the component before handing them to a transform: `results.filter(r => r.date)`.
2. A pure date transform must NEVER throw on degenerate input. Validate dates
   with a `^\d{4}-\d{2}-\d{2}$` regex at the top and early-return the empty
   shape if nothing valid remains. An empty-array guard is NOT enough — a single
   `{date: null}` row passes a length check.
3. Audit the WHOLE empty-db class at once, not one rebuild at a time. The other
   charts were already safe BECAUSE they filter by JS-supplied window bounds
   (empty db -> `[]`, handled by transform empty-guards) or read a null-coalesced
   scalar aggregate (`avg_mood: NULL, count: 0`, div-by-zero guarded). The
   `MIN(date)`-seeded query was the structural outlier.

**Verifying empty-db on-device**: `adb uninstall com.raeduslabs.soulsync` gives
a guaranteed-empty db (wipes app data; EAS keystore differs from dev keystore so
uninstall is needed anyway). Dev build: load the bundle via a deep link, NOT by
tapping the dev-launcher row (synthetic taps on that list are unreliable):
`adb shell am start -a android.intent.action.VIEW -d "myapp://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081"`
(scheme is `myapp`), then tap "Continue" to dismiss the first-launch dev menu.
Maestro `assertVisible "Overview"` on the Stats tab is the decisive empty-db
check (if the heatmap threw, StatisticsContent unmounts and the assert fails).
Flows: `.maestro/empty-db-verify.yaml` (dev, already-loaded) and
`.maestro/release-empty-verify.yaml` (release, standalone `launchApp`).

**Date**: 2026-06-07

## Fabric / new-architecture transparent `<Modal>` flex-collapse on Android (2026-06-07)

**Symptom**: A transparent `<Modal>` (e.g. the FAB entry form) opens but renders
BLANK — only intrinsic-height children (close button) paint; the `flex: 1` content
tree collapses to zero height. No JS error. BACK dismisses the invisible modal.
uiautomator shows the content ViewGroup at `Rect(0,77 - 0,77)`.

**Root cause**: On RN 0.76 Android new architecture (`newArchEnabled: true`, Fabric),
a transparent `<Modal>`'s host window does not give its child Fabric ShadowTree a
measured height on first mount. A root content view styled `flex: 1` therefore
resolves to height 0 and collapses all flex children. Documented in expo/expo#34470,
facebook/react-native#49717 / #50442, gorhom/bottom-sheet#2167. Only surfaced because
this was the app's first new-arch NATIVE build — Expo Go runs the old architecture, so
it never reproduced there.

**Rule / fix**: The root content `<View>` of every transparent `<Modal>` MUST have
EXPLICIT dimensions (`width`/`height` from `Dimensions.get('window')`), never bare
`flex: 1`. Inner `flex: 1` children are fine once the root has a concrete size. Also
add `statusBarTranslucent` so the explicit height covers the full window incl. status
bar. `statusBarTranslucent` ALONE does NOT fix flex-collapse — explicit sizing is the
load-bearing change.

Applied to: EntryForm.tsx, ActivityEditModal.tsx, SettingRow.tsx (select overlay),
DBViewer.tsx (PhotoViewer), IconPicker.tsx (opaque/slide — hardened for consistency,
less affected since opaque modals get a measured native window).

Note: DBViewer.tsx has dead `modalContainer`/`modalContent` styles (~lines 142-214)
not referenced in JSX — only `viewerStyles.overlay` is used. Left untouched.

**If you add a new `<Modal transparent>`**: size its root view to the window, don't
use `flex: 1`.

## [SUPERSEDED 2026-06-12 — native Modal removed; see top lesson] GestureHandlerRootView added app-root + per-modal (2026-06-08) — touch fix UNVERIFIABLE via ADB

**Context**: A REAL-finger user report said the "add mood" modal is fully dead (no scroll,
no Continue, nothing tappable). The app had NO `GestureHandlerRootView` anywhere even though
`react-native-gesture-handler@2.20.2` is installed (transitive via react-navigation /
react-native-screens). Documented RNGH guidance: a root `GestureHandlerRootView` is required,
and every `<Modal>` (which renders in a SEPARATE native window outside that root) needs its
OWN `GestureHandlerRootView` wrapping its content.

**Change applied**: added `<GestureHandlerRootView style={{ flex: 1 }}>` at the app root
(`app/_layout.tsx`, wrapping `<Stack>`) AND as the outermost child inside every native
`<Modal>`: EntryForm (EntryFormModal), SettingRow (select), ActivityEditModal, IconPicker,
DBViewer (PhotoViewer), ActivitySelector (AddActivityModal + AddGroupModal). The inner
modalContainer keeps its explicit-window-Dimensions sizing (the prior Fabric flex-collapse
fix) INSIDE the GHRV — both layers coexist. tsc/eslint/jest all green; modal still renders
+ closes cleanly (no regression, no redbox).

**The verification wall (this is the load-bearing lesson)**: on-device, `adb input tap`,
`adb input swipe`, AND explicit separate `adb input motionevent DOWN`/`UP` on the Continue
button + mood scroller ALL still do nothing, and still log
`E unknown:ReactNative: Got DOWN touch before receiving UP or CANCEL from last gesture`
— i.e. EXACTLY the synthetic-injection limitation already documented below. So the GHRV
change neither passes nor fails the ADB test: ADB simply **cannot** drive this app's modal
window regardless of whether the fix works. The task's premise ("a clean adb tap sends
DOWN+UP so it WILL register if the gesture root is fixed") does NOT hold for this app — the
UP is lost across the modal's second React root no matter what. **Only a real finger can
confirm whether GHRV fixed the genuine real-finger deadness.** Did NOT ship v1.2.2 on an
unverified guess (per explicit instruction: do not claim fixed if the tap doesn't advance).

**Rule**: For this app, the modal-touch fix CANNOT be verified by any synthetic ADB input.
The only valid verification is a real finger (the original reporter) on a build. When a
real-finger modal-interaction bug is reported, the dev loop is: apply the
best-practice fix (GHRV here) -> gate (tsc/eslint/jest) -> screenshot-confirm the modal
still RENDERS + closes -> hand a build to a human for the actual touch confirmation. Do not
treat "adb tap didn't advance the step" as evidence the fix failed.

**Date**: 2026-06-08

## [SUPERSEDED 2026-06-12 — native Modal removed, overlays ARE synthetically drivable; see top lesson] Synthetic touch CANNOT drive an open `<Modal>` on RN 0.76 new arch (2026-06-07)

While verifying the modal fix on-device, neither `adb input tap`/`swipe`/`motionevent`
NOR Maestro/uiautomator could drive any control INSIDE an open `<Modal>` (Continue,
close X, mood numbers all inert). Every in-modal tap logs:
`E unknown:ReactNative: Got DOWN touch before receiving UP or CANCEL from last gesture`
The modal renders fully (proven by screenshot) and its window is focused
(`mCurrentFocus` = the modal's APPLICATION window per `dumpsys window`), but RN's
JSTouchDispatcher for the modal's second React root only ever sees DOWN, never UP, so
it stays frozen. This is a SYNTHETIC-INJECTION limitation (`InjectInputEvent` delivers
DOWN+UP across the just-created modal window and the UP is lost/transferred), NOT a
real-finger bug and NOT introduced by the flex fix (FAB/input code untouched).
Confirmed orthogonal: reverting reanimated FAB, deferring open (rAF / 150ms setTimeout),
GestureHandlerRootView, opaque modal, and uiautomator dumps (6 empty nodes while modal
open) all reproduce it. Detox has the same class of issue ("tap() freezes while a
system modal is open, disable synchronization"). Refs: facebook/react-native#36452,
#30080; gorhom/bottom-sheet#2167.

**Consequence for QA**: Maestro CANNOT auto-assert in-modal beats on this app
(`assertVisible "How were you?"` fails because uiautomator can't read the modal tree;
in-modal `tapOn` does nothing). Verify modal flows by SCREENSHOT + a REAL finger tap,
not by Maestro/adb taps. The modal RENDERING is the part to assert via screenshot.

## Device QA
- Verify modal/UI flows with Maestro (`.maestro/soulsync-tour.yaml`), NOT blind adb taps:
  RN/Fabric doesn't expose tab text and the FAB only responds via its
  accessibilityLabel ("Add mood entry"). Run maestro from ~/Pictures/screenshots so
  `takeScreenshot` PNGs land there. Tabs are tapped by `point: X%, 89%`
  (Home 10 / Stats 30 / Timeline 50 / Insights 70 / Settings 90).
- Build incremental new-arch dev build:
  `export ANDROID_HOME=/home/astraedus/Android/Sdk && npx expo run:android`
  (android/ is prebuilt). Ensure `adb reverse tcp:8081 tcp:8081`. Device 192.168.1.68:5555, PIN 1337.
