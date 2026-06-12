# SoulSync — Project Lessons

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
