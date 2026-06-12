# Releasing SoulSync

Versioning is deterministic. There is exactly one source of truth and one command.

## Source of truth
- **`app.json` `expo.version`** (semver `MAJOR.MINOR.PATCH`) is THE version.
- **`android.versionCode`** (and iOS `buildNumber`) are **derived, never hand-edited**:
  `versionCode = MAJOR*10000 + MINOR*100 + PATCH` (e.g. `1.2.1` -> `10201`).
  `scripts/bump-version.js` computes them; MINOR/PATCH must stay <= 99 (else do a major bump).
- **`eas.json` uses `appVersionSource: "local"`** so the version lives in the repo, not hidden EAS server state.

## The invariant
For every release these are all the SAME string:

    git tag  ==  app.json version  ==  APK versionName  ==  GitHub release tag  ==  asset name (SoulSync-<version>.apk)

If they ever differ, something bypassed the pipeline.

## Two build lanes (both emit the SAME signed APK — cert parity verified)

The release APK can be built two ways. Both sign with the **same keystore** (the app's permanent
identity), so an APK from either lane updates cleanly over an APK from the other — verified on-device
for v1.2.3 (installed the CI APK over the EAS v1.2.2 with `adb install -r`, no
`INSTALL_FAILED_UPDATE_INCOMPATIBLE`, data preserved).

### Lane A — GitHub Actions CI (FREE + permanent, the current default)
`.github/workflows/release-apk.yml`. Exists because the EAS free-tier Android build quota is exhausted
until **2026-07-01**; CI on this public repo is free + unlimited. Shipped v1.2.3 (2026-06-12).

Cut a release = replicate the bump steps below MINUS the EAS build, then push the tag (the tag push is
what fires CI):

```bash
cd frontend
npx tsc --noEmit && npx jest --silent            # the REAL gate (what release.sh runs)
VERSION="$(node scripts/bump-version.js patch)"  # patch | minor | major
git add app.json && git commit -m "release: v$VERSION" && git tag "v$VERSION"
git push origin main --tags
gh run watch "$(gh run list -R Antimatter543/mood-tracker --workflow=release-apk.yml --event=push --limit 1 --json databaseId --jq '.[0].databaseId')" -R Antimatter543/mood-tracker
```

CI then: `npm ci` -> `npx expo prebuild --platform android` (CNG — regenerates the gitignored `android/`
with the `withReleaseAbis` arm-only ABI split + R8/shrink from `expo-build-properties`) ->
`gradlew assembleRelease` signed via `-Pandroid.injected.signing.*` from the repo-secret keystore ->
rename to `SoulSync-<version>.apk` -> create the GitHub Release (idempotent: `gh release view || create`,
then `upload --clobber`).

**Gate note:** use `tsc + jest` (NOT `npm run check`). `npm run check` also runs `expo lint`, which has a
pre-existing non-blocking error — `'__dirname' is not defined` in `scripts/bump-version.js` (eslint-config-expo
8 doesn't treat `scripts/*.js` as node env). `release.sh` gates on tsc+jest only, so this never blocks a
release. (The `upgrade/sdk-56` branch has the `.eslintrc.js` node-env override that fixes it.)

**Branch QA builds** (build any ref WITHOUT cutting a release — e.g. the SDK-56 branch):
`gh workflow run release-apk.yml -R Antimatter543/mood-tracker --ref <branch>` (or `-f ref=<branch>`).
Uploads the APK as a **run artifact** instead of a release. (This replaces the SDK-56 runbook's EAS
preview-build step.)

### Lane B — EAS via `scripts/release.sh` (quota-bound until 2026-07-01)
The canonical one-command path once EAS quota returns (from `frontend/`):

```bash
scripts/release.sh patch     # 1.2.1 -> 1.2.2   (bug fixes / polish)
scripts/release.sh minor     # 1.2.x -> 1.3.0   (new features)
scripts/release.sh major     # 1.x.x -> 2.0.0   (breaking / big)
```

Refuses to proceed on a dirty tree or failing gates: `tsc + jest` -> bump version -> commit
`release: vX.Y.Z` -> `git tag` -> EAS preview build (optimized arm-only + R8) -> download APK ->
`gh release` with an auto changelog from commits since the last tag -> push commit + tag.

## Keystore custody (don't lose this — it's the app's permanent identity)
Stored in three places: **EAS** (`eas credentials -p android`, account `@astraedus`, slug `soulsync-mood`),
**GitHub repo secrets** on `Antimatter543/mood-tracker` (`SOULSYNC_KEYSTORE_BASE64`,
`SOULSYNC_KEYSTORE_PASSWORD`, `SOULSYNC_KEY_ALIAS`, `SOULSYNC_KEY_PASSWORD`), and a **Bitwarden** secure note
"SoulSync Android release keystore". The signing cert SHA-256 (must match EVERY release):
`DB:32:8A:E9:F4:88:16:44:BE:0D:40:30:21:2E:2E:65:09:38:78:F3:5E:71:9D:9D:62:E2:9B:06:3C:4E:02:AB`.
Verify any APK with `apksigner verify --print-certs <apk>` — these APKs are APK-Signature-Scheme v2/v3 only,
so `keytool -printcert -jarfile` prints nothing; `apksigner` is authoritative. **NEVER** write the keystore
file into the repo working tree.

## Don't
- Don't hand-edit `versionCode`.
- Don't `--clobber` an existing release's asset to "update" it. Cut a new patch instead, so the
  version visibly moves and history is preserved.
- Don't build/release outside `scripts/release.sh` (that's how versions drift).
