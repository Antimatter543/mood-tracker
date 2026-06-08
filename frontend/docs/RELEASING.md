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

## How to cut a release
One command (from `frontend/`), choose the bump size:

```bash
scripts/release.sh patch     # 1.2.1 -> 1.2.2   (bug fixes / polish)
scripts/release.sh minor     # 1.2.x -> 1.3.0   (new features)
scripts/release.sh major     # 1.x.x -> 2.0.0   (breaking / big)
```

It runs the full chain, refusing to proceed on a dirty tree or failing gates:
`tsc + jest` -> bump version -> commit `release: vX.Y.Z` -> `git tag` -> EAS preview build
(optimized arm-only + R8) -> download APK -> `gh release` with an auto changelog from commits
since the last tag -> push commit + tag.

## Don't
- Don't hand-edit `versionCode`.
- Don't `--clobber` an existing release's asset to "update" it. Cut a new patch instead, so the
  version visibly moves and history is preserved.
- Don't build/release outside `scripts/release.sh` (that's how versions drift).
