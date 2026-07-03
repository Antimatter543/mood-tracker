#!/usr/bin/env bash
#
# Deterministic SoulSync release pipeline.
#
# One command does the whole chain so version, git tag, APK versionName, and
# GitHub release can never drift apart again:
#   run gates -> bump app.json version -> commit -> tag -> push
#   -> GitHub Actions CI builds + signs + attaches the APK to the Release
#   -> stage to Google Play (local, draft by default).
#
# The BUILD happens on CI, not here (portfolio policy 2026-07-03): the free
# GitHub Actions lane (release-apk.yml, fired by the v* tag push) is the only
# build path — it creates the GitHub Release idempotently and uploads the AAB
# as a run artifact. EAS cloud builds are prod/iOS-only and this app is
# Android-only, so no EAS anywhere. (The pre-2026-07-03 EAS lane lives in git
# history if archaeology is ever needed.)
#
# Single source of truth: frontend/app.json expo.version.
# Invariant: git tag  ==  app.json version  ==  APK versionName  ==
#            GitHub release tag  ==  asset name (SoulSync-<version>.apk).
#
# Usage (from frontend/ or anywhere):  scripts/release.sh [patch|minor|major]
#   default bump = patch.
#
# Requires: gh (authed), a clean git working tree.
set -euo pipefail

cd "$(dirname "$0")/.."   # -> frontend/
BUMP="${1:-patch}"
REPO="Antimatter543/mood-tracker"

# 0. Refuse to release a dirty tree (version bump must be the only change).
if [ -n "$(git status --porcelain)" ]; then
  echo "ERROR: working tree is dirty. Commit or stash first." >&2
  exit 1
fi

# 1. Quality gates BEFORE we cut a version.
echo "==> typecheck + tests"
npx tsc --noEmit
npx jest --silent

# 2. Bump version (writes app.json version + derived versionCode/buildNumber).
VERSION="$(node scripts/bump-version.js "$BUMP")"
TAG="v$VERSION"
echo "==> releasing $TAG"

# 3. Commit + tag + push. The tag push fires the CI build lane, which builds,
#    signs, and creates/updates the GitHub Release with SoulSync-$VERSION.apk.
git add app.json
git commit -m "release: $TAG"
git tag "$TAG"
git push origin main --tags

echo "==> pushed $TAG — CI is building + will publish the GitHub Release."
echo "    watch: gh run watch \$(gh run list -R $REPO --workflow=release-apk.yml --event=push --limit 1 --json databaseId --jq '.[0].databaseId') -R $REPO"

# 4. Stage the release to Google Play (local, idempotent; draft by default).
# publish-on-tag.sh waits for CI to build the AAB (it just retries if not ready), then
# delegates to publish-to-play.sh. Safe to run here even though CI usually hasn't built
# the AAB yet at push time — it'll log "AAB not built yet" and the 30-min cron picks it
# up. Skip with NO_PLAY=1. The Play push is local-only because this repo is public and
# the Google Play credential must never touch CI.
if [ "${NO_PLAY:-}" = "1" ]; then
  echo "==> NO_PLAY=1 set — skipping Google Play staging"
else
  echo "==> staging $TAG to Google Play (draft; cron retries until CI AAB is ready)"
  scripts/publish-on-tag.sh "$VERSION"
fi
