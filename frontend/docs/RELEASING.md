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

## The build lane — GitHub Actions CI (FREE + permanent, the ONLY lane)

`.github/workflows/release-apk.yml`, fired by a `v*` tag push. Portfolio policy 2026-07-03: EAS cloud
builds are prod/iOS-only and this app is Android-only, so the free CI gradlew lane is the only build
path. (The old EAS lane was removed from `release.sh` the same day; it signed with the SAME keystore —
cert parity was verified on-device for v1.2.3 over the EAS v1.2.2 — so historical EAS-built installs
update cleanly over CI builds. Git history has the old lane if archaeology is ever needed.)

Cut a release = ONE command (from `frontend/`):

```bash
scripts/release.sh patch     # 1.2.1 -> 1.2.2   (bug fixes / polish)
scripts/release.sh minor     # 1.2.x -> 1.3.0   (new features)
scripts/release.sh major     # 1.x.x -> 2.0.0   (breaking / big)
```

Refuses a dirty tree; gates on `tsc + jest`; bumps `app.json` (+ derived versionCode); commits
`release: vX.Y.Z`; tags; pushes. The tag push fires CI, which builds + signs + creates the GitHub
Release; the script then stages the release to Google Play (draft; `NO_PLAY=1` to skip).

Manual equivalent (only if the script itself is broken):

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
