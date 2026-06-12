# SoulSync (mood-tracker) — Project Guide

Privacy-first mood tracker. 100% local (SQLite + on-device files), no account, no cloud, no tracking.
App code lives under `frontend/`. Expo SDK 52, React Native 0.76, `newArchEnabled: true` (Fabric),
expo-router v4, TypeScript strict.

Public repo: `Antimatter543/mood-tracker` (Anti's). Releases: GitHub Releases (APK).

## Releasing & Versioning — DETERMINISTIC

**Single source of truth: `frontend/app.json` `expo.version`** (semver). Everything else is derived.

- `android.versionCode` + iOS `buildNumber` are **DERIVED, never hand-edited**:
  `MAJOR*10000 + MINOR*100 + PATCH` (e.g. `1.2.1` -> `10201`). `scripts/bump-version.js` computes them.
- `eas.json` uses `appVersionSource: "local"` — the version lives in the repo, NOT hidden EAS server state.
- **Invariant:** `git tag == app.json version == APK versionName == GitHub release tag == asset (SoulSync-<version>.apk)`.

### Two build lanes — both produce the SAME signed APK (cert parity verified)

**Lane A — GitHub Actions CI (`.github/workflows/release-apk.yml`). FREE + permanent — the default.**
The EAS free-tier Android build quota is exhausted until **2026-07-01**; CI on this public repo is free and
unlimited. Used to ship v1.2.3 (2026-06-12).
  - **Cut a release** = replicate `release.sh`'s bump steps MINUS the EAS build, then push the tag:
    ```bash
    cd frontend
    npx tsc --noEmit && npx jest --silent          # the real gate (what release.sh runs; NOT `npm run check`*)
    VERSION="$(node scripts/bump-version.js patch)" # patch|minor|major
    git add app.json && git commit -m "release: v$VERSION" && git tag "v$VERSION"
    git push origin main --tags                     # the tag push fires the CI lane
    ```
    CI then: `npm ci` -> `npx expo prebuild --platform android` (CNG; applies `withReleaseAbis` arm-only +
    R8/shrink) -> `gradlew assembleRelease` signed via `-Pandroid.injected.signing.*` from the repo-secret
    keystore -> renames to `SoulSync-<version>.apk` -> creates the GitHub Release (idempotent:
    `gh release view||create` then `upload --clobber`). Watch: `gh run watch <id> -R Antimatter543/mood-tracker`.
  - ***`npm run check` also runs `expo lint`, which has ONE pre-existing non-blocking error**
    (`'__dirname' is not defined` in the Node build script `scripts/bump-version.js` — eslint-config-expo 8
    doesn't treat `scripts/*.js` as node env). `release.sh` gates on `tsc + jest` ONLY, so it does not block a
    release. (The `upgrade/sdk-56` branch carries the `.eslintrc.js` node-env override that fixes it.)
  - **Branch QA builds** (build any ref, NO release): `gh workflow run release-apk.yml
    -R Antimatter543/mood-tracker --ref <branch>` (or `-f ref=<branch>`). Uploads the APK as a **run
    artifact**. This replaces the SDK-56 runbook's EAS preview-build step.

**Lane B — EAS via `scripts/release.sh` (quota-bound until 2026-07-01).** The canonical one-command path once
quota is back: `scripts/release.sh patch|minor|major` does tsc+jest -> bump -> commit -> tag -> EAS preview
build -> download -> `gh release` (auto changelog) -> push. Same signed output.

- **Keystore custody** (the app's PERMANENT signing identity — losing it = can never update the app):
  (1) **EAS** (`eas credentials -p android`, account `@astraedus`, slug `soulsync-mood`), (2) **GitHub repo
  secrets** on `Antimatter543/mood-tracker`: `SOULSYNC_KEYSTORE_BASE64`, `SOULSYNC_KEYSTORE_PASSWORD`,
  `SOULSYNC_KEY_ALIAS`, `SOULSYNC_KEY_PASSWORD`, (3) **Bitwarden** secure note "SoulSync Android release
  keystore". Cert SHA-256 (must match EVERY release):
  `DB:32:8A:E9:F4:88:16:44:BE:0D:40:30:21:2E:2E:65:09:38:78:F3:5E:71:9D:9D:62:E2:9B:06:3C:4E:02:AB`.
  Verify an APK with `apksigner verify --print-certs <apk>` (these APKs are v2/v3-signed only, so
  `keytool -printcert -jarfile` prints NOTHING — `apksigner` is authoritative).
- **DON'T**: hand-edit `versionCode`; `--clobber` a release's asset to "update" it (cut a new patch so the
  version visibly moves); build/release outside the two lanes; EVER write the keystore into the repo tree.
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
  Do NOT local-build to iterate (see Build section). Expo Go also does NOT work here (device Expo Go is SDK 56,
  project is SDK 52). For JS-only changes, `eas update` to an existing dev client avoids a native rebuild.
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
