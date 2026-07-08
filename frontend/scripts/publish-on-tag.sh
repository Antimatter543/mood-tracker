#!/usr/bin/env bash
#
# publish-on-tag.sh — idempotent "tag → Google Play" auto-stage orchestrator.
#
# WHAT GAP THIS CLOSES:
#   Cutting a SoulSync release (bump → tag → CI builds the signed AAB) and pushing
#   that AAB to Google Play were two separate manual acts, so Play silently drifted
#   behind GitHub. This script makes the Play push automatic and SAFE TO RE-RUN: a
#   laptop cron (every 30 min) and release.sh both call it; in steady state it does
#   ONE read-only API call and exits. It NEVER builds, NEVER re-uploads an existing
#   versionCode, and NEVER hard-fails (a poller must not crash the cron tick).
#
# WHY LOCAL, NOT CI:
#   Antimatter543/mood-tracker is a PUBLIC repo. The Google Play API credential is a
#   powerful admin secret we deliberately keep OFF GitHub Actions (a malicious PR or
#   compromised action could exfiltrate it). CI only ever holds the *upload* key
#   (rotatable via Play App Signing). The gplay admin service-account key lives on the
#   laptop only — so the Play push runs here, on a local cron, not in the cloud.
#
# WHY IT DEFAULTS TO DRAFT (and how to flip to live):
#   SoulSync is a brand-new Play app. Its first version (2.3.4) is still IN_REVIEW at
#   Google, and the one-time IARC content-rating questionnaire (a Console-only step,
#   Anti's) is not yet done. Until BOTH clear, Play ONLY accepts DRAFT uploads —
#   a --status completed/inProgress release is rejected. So the safe, correct default
#   today is PLAY_STATUS=draft (staged, zero users affected). Once the app is approved
#   AND the IARC questionnaire is complete, flip to a live staged rollout by exporting:
#       PLAY_STATUS=inProgress PLAY_ROLLOUT=0.2   (20% staged, halt-able)
#   then later PLAY_STATUS=completed PLAY_ROLLOUT=1.0 for full rollout. That flip is a
#   FUTURE action — do not attempt a live publish while the app is pre-approval.
#
# ENV KNOBS (all optional):
#   PLAY_STATUS    draft|inProgress|halted|completed   (default: draft)
#   PLAY_ROLLOUT   0.0–1.0                              (default: 0.2)
#   PLAY_TRACK     production|beta|alpha|internal       (default: production)
#   SOULSYNC_PLAY_LOG   log file path                   (default: ~/ops/runtime/soulsync-play.log)
#   (the heavy lifting — AAB download, preflight, gplay release — is delegated to
#    scripts/publish-to-play.sh, whose security model this script does NOT touch.)
#
# USAGE:
#   scripts/publish-on-tag.sh [version]   # version defaults to frontend/app.json expo.version
#
# Idempotent guard ladder (cheapest first, each exits 0):
#   1. version/versionCode sanity mismatch → log + exit (don't crash a poller).
#   2. versionCode ALREADY on the track    → "already on track — nothing to do".
#   3. AAB not yet built by CI             → "AAB not built yet — will retry".
#   4. otherwise                           → delegate to publish-to-play.sh.
#
# NOTE: this script lives at frontend/scripts/ but publish-to-play.sh lives at the
# REPO-ROOT scripts/ (one level above frontend), so $REPO_ROOT/scripts/publish-to-play.sh
# is the correct path — not $FRONTEND_DIR/scripts/.

# set -uo pipefail, NOT -e: a poller running on a cron tick must never hard-fail on a
# transient API hiccup. Every failure path below is handled explicitly and exits 0.
set -uo pipefail

# Cron-safe environment (mirrors astra-daily-needle.sh exactly — cron has no profile).
export PATH="/home/astraedus/.local/bin:/home/astraedus/bin:/home/astraedus/.nvm/versions/node/v24.14.0/bin:$PATH"
export HOME="/home/astraedus"

# gplay creds: interactive shells get GPLAY_SERVICE_ACCOUNT_JSON from the profile, but
# cron has no profile — so every Play push silently failed "no credentials found" (the
# preflight ran, then `gplay release` died on auth). The admin SA key lives OUTSIDE this
# PUBLIC repo (chmod 600). Set only if unset so a caller can override; not asserted here
# because a missing key just re-produces the graceful auth error downstream.
: "${GPLAY_SERVICE_ACCOUNT_JSON:=$HOME/ops/credentials/gcp/gplay-admin-sa.json}"
export GPLAY_SERVICE_ACCOUNT_JSON

REPO="Antimatter543/mood-tracker"
PKG="com.raeduslabs.soulsyncapp"
TRACK="${PLAY_TRACK:-production}"
STATUS="${PLAY_STATUS:-draft}"
ROLLOUT="${PLAY_ROLLOUT:-0.2}"

# Resolve repo layout from this script's own location (robust to cron's cwd).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"      # frontend/
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"       # soulsync/ (git root)
APP_JSON="$FRONTEND_DIR/app.json"
PUBLISH="$REPO_ROOT/scripts/publish-to-play.sh"

LOG="${SOULSYNC_PLAY_LOG:-$HOME/ops/runtime/soulsync-play.log}"
mkdir -p "$(dirname "$LOG")"

# log(): timestamped (UTC ISO) line → log file, and → stderr for interactive runs.
# Under cron the entry is invoked with `>> $LOG 2>&1`, which redirects stderr back
# into $LOG; guarding the stderr copy on a tty (-t 2) keeps the cron log from getting
# a duplicate of every line (48 ticks/day otherwise doubles the steady-state noise).
log() {
  local line="[$(date -u +%Y-%m-%dT%H:%M:%SZ)] publish-on-tag: $*"
  printf '%s\n' "$line" >> "$LOG"
  [ -t 2 ] && printf '%s\n' "$line" >&2
  return 0
}

# --- preconditions (missing tool → log + exit 0, never crash a poller) ---------------
for tool in node jq gh gplay; do
  command -v "$tool" >/dev/null 2>&1 || { log "missing dependency '$tool' on PATH — skipping tick"; exit 0; }
done
[ -f "$APP_JSON" ]  || { log "app.json not found at $APP_JSON — skipping tick"; exit 0; }
[ -x "$PUBLISH" ]   || { log "publish-to-play.sh not executable at $PUBLISH — skipping tick"; exit 0; }

# --- HOLD gate: a local marker file pauses ALL Play staging, deterministically. -------
# WHY: some CI-built versions must NOT reach Play yet — v2.3.8+ carries Health Connect
# manifest permissions (READ_SLEEP/READ_HEART_RATE) that require Google's "Health Apps"
# declaration to be APPROVED first; staging an undeclared health build risks store
# removal. Before this gate, the ONLY thing stopping a stage was the cron's broken auth
# (fixed just above) — an accident, not a decision. This replaces that accident with
# intent: `touch`/write the marker to hold, `rm` it to resume. LOCAL-only (gitignored),
# because the cron runs on this laptop; path is overridable for testing.
HOLD_FILE="${SOULSYNC_PLAY_HOLD_FILE:-$REPO_ROOT/.play-hold}"
if [ -f "$HOLD_FILE" ]; then
  log "HELD by $HOLD_FILE: $(head -1 "$HOLD_FILE" 2>/dev/null) — not staging to Play (rm the file to resume)"
  exit 0
fi

# --- 1. resolve VERSION + versionCode, assert they agree (same rule as publish-to-play) ---
VERSION="${1:-$(node -p "require('$APP_JSON').expo.version" 2>/dev/null)}"
[ -n "$VERSION" ] || { log "could not resolve version from $APP_JSON — skipping tick"; exit 0; }

VC_APP="$(node -p "require('$APP_JSON').expo.android.versionCode" 2>/dev/null)"
# versionCode is DERIVED MAJOR*10000+MINOR*100+PATCH in this repo; assert app.json agrees
# so the "already uploaded?" check below keys off the right identity.
VC_DERIVED="$(node -e 'const [a,b,c]=process.argv[1].split(".").map(Number); process.stdout.write(String(a*10000+b*100+c))' "$VERSION" 2>/dev/null)"
if [ -z "$VC_APP" ] || [ "$VC_APP" != "$VC_DERIVED" ]; then
  log "versionCode mismatch (app.json=$VC_APP, derived from $VERSION=$VC_DERIVED) — run scripts/bump-version.js. Skipping tick."
  exit 0
fi
VERSION_CODE="$VC_APP"

# --- 2. CHEAP idempotent guard FIRST: is this versionCode already on the track? -------
# Read-only (no edit). Robust to both shapes publish-to-play handles: the flat
# .versionCodes[] and the draft .activeArtifacts[].versionCode. In steady state this is
# the ONLY API call a tick makes.
TRACK_JSON="$(gplay tracks releases list --package "$PKG" --track "$TRACK" 2>/dev/null || echo '{}')"
EXISTING_CODES="$(echo "$TRACK_JSON" | jq -r '
  (.releases // [])
  | map((.versionCodes // []) + ((.activeArtifacts // []) | map(.versionCode)))
  | add // []
  | map(tostring) | .[]' 2>/dev/null || true)"
if echo "$EXISTING_CODES" | grep -qx "$VERSION_CODE"; then
  log "versionCode $VERSION_CODE ($VERSION) already on '$TRACK' track — nothing to do"
  exit 0
fi

# --- 3. AAB-readiness: has CI built SoulSync-<VERSION>.aab as a run artifact yet? ------
# Scan recent successful release-apk.yml runs for the version-matched artifact so an old
# run (different version) can never satisfy the check. If none → the tag may have just
# been pushed and CI is still building; log and let the next tick retry.
ARTIFACT="SoulSync-${VERSION}.aab"
RUN_ID=""
for id in $(gh run list -R "$REPO" --workflow release-apk.yml --status success \
              --limit 20 --json databaseId -q '.[].databaseId' 2>/dev/null); do
  if gh api "repos/$REPO/actions/runs/$id/artifacts" -q '.artifacts[].name' 2>/dev/null \
       | grep -qx "$ARTIFACT"; then
    RUN_ID="$id"; break
  fi
done
if [ -z "$RUN_ID" ]; then
  log "AAB '$ARTIFACT' not built yet (CI pending/none) — will retry next tick"
  exit 0
fi

# --- 4. delegate the upload to publish-to-play.sh (whose security model we don't touch) ---
# SOURCE=run because SoulSync's CI uploads the AAB as a RUN ARTIFACT, not a Release asset.
# A publish failure (network, Play rejection) must NOT crash the poller — log it and let
# the next tick retry (the idempotent guard means a later success is harmless).
log "AAB ready (run $RUN_ID) — delegating to publish-to-play.sh: STATUS=$STATUS ROLLOUT=$ROLLOUT TRACK=$TRACK version=$VERSION"
if STATUS="$STATUS" ROLLOUT="$ROLLOUT" TRACK="$TRACK" SOURCE=run "$PUBLISH" "$VERSION" >> "$LOG" 2>&1; then
  log "publish-to-play.sh succeeded for $VERSION (STATUS=$STATUS)"
else
  rc=$?
  log "publish-to-play.sh FAILED (exit $rc) for $VERSION — will retry next tick"
fi
exit 0
