# SoulSync (mood-tracker) — Project Guide

Privacy-first mood tracker. 100% local (SQLite + on-device files), no account, no cloud, no tracking.
App code lives under `frontend/`. Expo SDK 56, React Native 0.85, new architecture (Fabric — now
unconditional; the legacy arch + `newArchEnabled` field were removed from RN at SDK 55),
expo-router (SDK-56 forked react-navigation internally — no `@react-navigation/*` deps), TypeScript
6 strict. (Upgraded 52→56 on branch `upgrade/sdk-56`, 2026-06-12 — see
`frontend/docs/sdk56-hop4-notes.md`. Release of v2.0.0 is gated on the 2026-07-01 EAS quota reset.)

Public repo: `Antimatter543/mood-tracker` (Anti's). Releases: GitHub Releases (APK).

## Releasing & Versioning — DETERMINISTIC, one command

**Single source of truth: `frontend/app.json` `expo.version`** (semver). Everything else is derived.

- `android.versionCode` + iOS `buildNumber` are **DERIVED, never hand-edited**:
  `MAJOR*10000 + MINOR*100 + PATCH` (e.g. `1.2.1` -> `10201`). `scripts/bump-version.js` computes them.
- `eas.json` uses `appVersionSource: "local"` — the version lives in the repo, NOT hidden EAS server state.
- **To release, run ONE command** (from `frontend/`):
  ```bash
  scripts/release.sh patch     # bug fixes / polish   (1.2.1 -> 1.2.2)
  scripts/release.sh minor     # new features         (1.2.x -> 1.3.0)
  scripts/release.sh major     # breaking / big       (1.x.x -> 2.0.0)
  ```
  It does: tsc+jest gates -> bump -> commit `release: vX.Y.Z` -> `git tag` -> EAS preview build
  -> download APK -> `gh release` (auto changelog from commits since last tag) -> push.
- **Invariant:** `git tag == app.json version == APK versionName == GitHub release tag == asset (SoulSync-<version>.apk)`.
- **DON'T**: hand-edit `versionCode`; `--clobber` an existing release's asset to "update" it (cut a new patch
  instead so the version visibly moves); build/release outside `scripts/release.sh`.
- Full doc: `frontend/docs/RELEASING.md`.

## Build / test / gates
```bash
cd frontend
npm run check        # tsc --noEmit + lint + jest  (the pre-ship gate, light on CPU)
npx jest             # tests (pure transforms, hooks, db layer all unit-tested)
```
**NEVER run a LOCAL native build** (`npx expo run:android`, `gradlew`, prebuild compiles). They peg the
CPU to 100%+ and lag Anti's interactive machine (he is ON this box). **Builds go to EAS cloud only** ->
`scripts/release.sh` (or `eas build`). This app also can't be relied on to build locally anyway.
For fast JS-only iteration without a native rebuild, use **`eas update`** (OTA) to a dev client, not a local build.

APK is optimized: `eas.json` preview profile = **arm-only ABIs** (via `plugins/withReleaseAbis.js`,
drops x86/x86_64 emulator libs) **+ R8 minify + resource shrink** (`expo-build-properties`). ~45MB, not ~98MB.

## On-device QA (the only reliable way to verify UI on this app)
- Pixel 3 at `192.168.1.68:5555`, app `com.raeduslabs.soulsync`, **device PIN `1337`**
  (unlock: `adb shell input keyevent KEYCODE_WAKEUP && adb shell input swipe 540 1600 540 300 && adb shell input text 1337 && adb shell input keyevent 66`).
- **How to get a build on the device:** EAS only (`scripts/release.sh` or `eas build`), then `adb install`.
  Do NOT local-build to iterate (see Build section). The project now MATCHES the device's Expo Go (both
  SDK 56), but the dev-client (`expo-dev-client`) remains the canonical iteration path here — overlays /
  native modules / the R8 release shape are only faithfully exercised on a dev-client or EAS build.
  For JS-only changes, `eas update` to an existing dev client avoids a native rebuild.
- **NO native `<Modal>` in this app (since v1.2.3) — use in-tree overlays.** Native `<Modal>` on RN 0.76
  Fabric routes into a second native window whose touch dispatch is broken (every in-modal control dead to a
  REAL finger, not just to automation). All modal-like UI now renders through `context/OverlayHost.tsx`
  (`OverlayProvider` / `useOverlay`) via `components/OverlayModal.tsx` (dialog + `fullScreen` variants).
  `OverlayProvider` lives in `app/(tabs)/_layout.tsx` INSIDE the SQLite/Data/Settings providers (overlay
  content reads those contexts) — never move it to the root layout. **NEVER reintroduce `react-native` `Modal`.**
- **Synthetic taps (adb/Maestro) DO drive the overlays** — no second window, so `mCurrentFocus` stays
  `MainActivity`, uiautomator reads the overlay tree, and `adb input tap`/`swipe` work inside the form,
  dropdowns, and nested pickers. The old "modal interactions are real-finger-only" rule is DEAD; full-flow
  adb/Maestro QA of the entry form + dropdowns is valid. (See frontend/tasks/lessons.md top entry.)
- **Use Maestro, not blind adb taps** (`~/.maestro/bin/maestro`; flows in `frontend/.maestro/`). RN/Fabric does
  NOT expose tab-bar labels or react-navigation text to uiautomator, so:
  - Tap tabs by **point**: `point: X%, 89%` (Home 10 / Stats 30 / Timeline 50 / Insights 70 / Settings 90).
  - The FAB has no text — tap it by its accessibility label: `tapOn: text: "Add mood entry"`.
  - Dismiss the expo dev menu with an optional `tapOn: text: "Continue"` after `launchApp`.
  - Screen-content Text (headers, buttons like "Continue") IS matchable; tab labels are NOT.
- Sideload installs may hit Play Protect: `adb shell settings put global verifier_verify_adb_installs 0`,
  then `adb install -r -g <apk>`. EAS-signed release vs debug-signed dev build differ → uninstall before swapping.
- Seed test data: Settings has a `__DEV__`-only "Generate 50 Sample Entries" button (dev build only).

## Hard-won gotchas (see frontend/tasks/lessons.md for detail)
- **NEVER use `react-native` `<Modal>` here (removed v1.2.3).** It opens a second native window with broken
  touch dispatch on RN 0.76 Fabric — in-modal controls are dead to a real finger. Use the in-tree overlay
  (`OverlayModal` / `useOverlay`, see On-device QA section). This replaced BOTH the old "Fabric flex-collapse
  blank modal" and "synthetic taps can't drive the modal" gotchas — the overlay has neither problem (it
  renders full-window via `StyleSheet.absoluteFill` and IS synthetically drivable).
- **Empty-database is a real code path** — a fresh install has zero entries. Date/aggregate logic must not throw
  on empty data (a heatmap `MIN(date)=NULL` once white-screened Stats). Test empty AND the empty->first-entry
  transition (a hooks-ordering bug crashed exactly there).
- **Chart x-axis**: for `year`/`alltime`, label only ~5 sparse points with the year (`"Mon 'YY"`), else they
  overlap. Heatmap month labels append the year at year boundaries.
- Theme everything via `useThemeColors()`; never hardcode colors except semantic warn/error. No emoji-as-icons
  (use `@expo/vector-icons`). 5 themes (dark/light/cherry/midnight/forest) — check at least one light theme.
- Schema/settings changes go through `databases/migrations.ts` (+ `SETTINGS_REGISTRY` for settings). The
  `entry_media` table backs photo attachments.

## Layout
- `frontend/app/(tabs)/` — screens (index=Home, stats, timeline, insights, settings).
- `frontend/components/visualisations/` — charts + `transforms/` (pure, unit-tested) + `queries.ts` (SQL).
- `frontend/lib/notifications.ts` — local daily-reminder scheduling (pure + testable).
- `frontend/databases/` — SQLite facade, migrations, CRUD, mediaHelpers, entry-media.
- `frontend/.maestro/` — device QA flows. `frontend/tasks/lessons.md` — project lessons. `frontend/docs/` — RELEASING.md + exec plans.
