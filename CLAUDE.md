# SoulSync (mood-tracker) — Project Guide

Privacy-first mood tracker. 100% local (SQLite + on-device files), no account, no cloud, no tracking.
App code lives under `frontend/`. Expo SDK 52, React Native 0.76, `newArchEnabled: true` (Fabric),
expo-router v4, TypeScript strict.

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
npm run check        # tsc --noEmit + lint + jest  (the pre-ship gate)
npx jest             # tests (pure transforms, hooks, db layer all unit-tested)
npx expo run:android # incremental dev build to the Pixel 3 (~30s after first build)
```
APK is optimized: `eas.json` preview profile = **arm-only ABIs** (via `plugins/withReleaseAbis.js`,
drops x86/x86_64 emulator libs) **+ R8 minify + resource shrink** (`expo-build-properties`). ~45MB, not ~98MB.

## On-device QA (the only reliable way to verify UI on this app)
- Pixel 3 at `192.168.1.68:5555`, app `com.raeduslabs.soulsync`, **device PIN `1337`**
  (unlock: `adb shell input keyevent KEYCODE_WAKEUP && adb shell input swipe 540 1600 540 300 && adb shell input text 1337 && adb shell input keyevent 66`).
- **Expo Go does NOT work here** — the device's Expo Go is SDK 56, the project is SDK 52, so it refuses to load.
  Use the incremental dev build (~30s), not Expo Go.
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
- **New-arch transparent `<Modal>` renders BLANK on Android** (Fabric flex-collapse): the modal host gets
  zero height so `flex:1` content collapses. Fix = give modal content explicit `Dimensions.get('window')`
  height (already applied to all modals). Don't reintroduce `flex:1` as the modal root.
- **Synthetic taps can't drive controls INSIDE an open RN-new-arch modal** (DOWN without UP). The modal renders
  fine; you just can't automate taps within it. Verify modal *rendering* via screenshot; a real finger is needed
  to drive the picker/Continue. Not a bug.
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
