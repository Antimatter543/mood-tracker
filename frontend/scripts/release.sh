#!/usr/bin/env bash
#
# Deterministic SoulSync release pipeline.
#
# One command does the whole chain so version, git tag, APK versionName, and
# GitHub release can never drift apart again:
#   bump app.json version -> run gates -> commit -> tag -> EAS build ->
#   download APK -> create GitHub release (auto changelog) -> push.
#
# Single source of truth: frontend/app.json expo.version.
# Invariant: git tag  ==  app.json version  ==  APK versionName  ==
#            GitHub release tag  ==  asset name (SoulSync-<version>.apk).
#
# Usage (from frontend/ or anywhere):  scripts/release.sh [patch|minor|major]
#   default bump = patch.
#
# Requires: eas-cli (logged in), gh (authed), a clean git working tree.
set -euo pipefail

cd "$(dirname "$0")/.."   # -> frontend/
BUMP="${1:-patch}"
REPO="Antimatter543/mood-tracker"
export ANDROID_HOME="${ANDROID_HOME:-/home/astraedus/Android/Sdk}"

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

# 3. Commit + tag.
git add app.json
git commit -m "release: $TAG"
git tag "$TAG"

# 4. EAS build (appVersionSource: local -> the APK reports $VERSION).
echo "==> EAS build (preview / optimized arm-only + R8)"
npx eas-cli build --platform android --profile preview --non-interactive --wait

# 5. Download the finished artifact.
URL="$(npx eas-cli build:list --platform android --limit 1 --json --non-interactive \
  | node -e 'const a=JSON.parse(require("fs").readFileSync(0,"utf8")); const b=a.find(x=>x.status==="FINISHED"); process.stdout.write(b.artifacts.applicationArchiveUrl)')"
APK="/tmp/SoulSync-$VERSION.apk"
curl -fsSL "$URL" -o "$APK"
echo "==> downloaded $(du -h "$APK" | cut -f1) APK"

# 6. GitHub release with an auto changelog from commits since the last tag.
gh release create "$TAG" "$APK#SoulSync-$VERSION.apk" \
  --repo "$REPO" --title "SoulSync $VERSION" --target main --generate-notes

# 7. Push commit + tag.
git push origin main --tags

echo "==> released https://github.com/$REPO/releases/tag/$TAG"

# 8. Stage the release to Google Play (local, idempotent; draft by default).
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
