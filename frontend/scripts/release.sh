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
# tsc runs here. The full jest suite runs on CI, not on this machine (it pegs the
# laptop, portfolio rule 2026-10-01): the release needs a green `PR checks` run
# (tsc + full jest, TZ pinned) on a commit whose TREE is identical to HEAD's.
# Tree, not commit: a squash-merge creates a new commit, but squash-merging an
# up-to-date PR yields exactly the PR head's tree, so merge -> release needs no
# extra run. If nothing matches, dispatch the workflow on main and rerun.
# LOCAL_JEST=1 runs jest here instead. Keep --runInBand for that: parallel
# workers make a few DBViewer suites time out flakily (seen on the v2.6.0 cut,
# 2026-07-17).
echo "==> typecheck"
npx tsc --noEmit
if [ "${LOCAL_JEST:-}" = "1" ]; then
  echo "==> tests (local)"
  npx jest --silent --runInBand
else
  echo "==> tests: looking for a green PR-checks run on this exact tree"
  HEAD_TREE="$(git rev-parse 'HEAD^{tree}')"
  GREEN=""
  # 40 recent green runs is weeks of PR traffic; an older match is stale anyway.
  for sha in $(gh run list -R "$REPO" --workflow pr-checks.yml --status success --limit 40 \
                 --json headSha --jq '.[].headSha' | awk '!seen[$0]++'); do
    # Fork PR commits are readable through the parent repo's API, so no fetch needed.
    tree="$(gh api "repos/$REPO/git/commits/$sha" --jq .tree.sha 2>/dev/null || true)"
    if [ "$tree" = "$HEAD_TREE" ]; then GREEN="$sha"; break; fi
  done
  if [ -z "$GREEN" ]; then
    echo "ERROR: no green PR-checks run has HEAD's tree ($HEAD_TREE)." >&2
    echo "  Run it on CI: gh workflow run pr-checks.yml -R $REPO --ref main" >&2
    echo "  then rerun this once it's green (or LOCAL_JEST=1 to run jest here)." >&2
    exit 1
  fi
  echo "    green CI run on ${GREEN:0:7} has the identical tree"
fi

# 2. Bump version (writes app.json version + derived versionCode/buildNumber).
VERSION="$(node scripts/bump-version.js "$BUMP")"
TAG="v$VERSION"
echo "==> releasing $TAG"

# 2b. CHANGELOG gate — refuse to tag a version with no changelog entry.
# publish-to-play.sh sources Play's "What's new" from the `## [x.y.z]` section;
# with no entry it silently ships the generic "Bug fixes and improvements"
# fallback (exactly what happened on the v2.9.0 cut, 2026-08-29 — the live
# release's notes had to be patched after the fact via the edits API). Gate
# AFTER the bump so we can grep for the real version, revert the bump on abort
# so the tree stays clean for the rerun.
if ! grep -q "^## \[$VERSION\]" CHANGELOG.md; then
  echo "ERROR: frontend/CHANGELOG.md has no '## [$VERSION]' entry — Play release" >&2
  echo "notes would ship as the generic fallback. Write the entry, then rerun." >&2
  git checkout -- app.json   # undo the bump; tree back to pre-release state
  exit 1
fi

# 3. Commit + tag + push. The tag push fires the CI build lane, which builds,
#    signs, and creates/updates the GitHub Release with SoulSync-$VERSION.apk.
git add app.json
git commit -m "release: $TAG"
git tag "$TAG"
# Push ONLY this release's tag, never --tags: the local rolling `main-latest`
# tag (CI moves it remotely on every main build) makes a blanket --tags push
# exit 1 AFTER the real pushes land — a phantom failure that aborted the
# v2.6.0 cut's tail steps (2026-07-17).
git push origin main "$TAG"

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
