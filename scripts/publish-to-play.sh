#!/usr/bin/env bash
#
# publish-to-play.sh — push a SoulSync release to Google Play via gplay.
#
# Ported from Nudge's scripts/publish-to-play.sh (same shape, same safety model),
# adapted for SoulSync's realities (version lives in app.json; the signed AAB is a
# CI *run artifact*, not a GitHub Release asset; CHANGELOG lives under frontend/).
#
# WHY THIS RUNS LOCALLY (not in CI):
#   mood-tracker is a PUBLIC, open-source repo. The Google Play API credential is a
#   powerful secret. We deliberately keep it OFF GitHub Actions so a malicious PR or
#   a compromised third-party action can never exfiltrate it. The signed AAB is built
#   in CI (which only ever holds the *upload* key, not the Play API key — and SoulSync
#   is enrolled in Play App Signing, so even a leaked upload key can be rotated in Play
#   Console without bricking installed users). This script takes that CI-built AAB and
#   uploads it from the laptop, where the gplay admin service-account key lives
#   (chmod 600, never committed, OUTSIDE this repo at ~/ops/credentials/gcp/).
#
# WHAT IT DOES:
#   1. Resolve the version from frontend/app.json (single source of truth) + the
#      derived versionCode.
#   2. Detect whether that versionCode is ALREADY on the production track (Play rejects
#      re-uploading an existing versionCode). If so: PROMOTE the existing draft
#      (PROMOTE=1) or print a clear message and exit 0 — never crash, never re-upload.
#   3. Otherwise: locate + download the signed AAB (latest successful release-apk.yml
#      run artifact "SoulSync-<version>.aab"), gplay preflight, then gplay release.
#   4. Print the resulting Play track state.
#
# USAGE:
#   scripts/publish-to-play.sh [version]      # version defaults to frontend/app.json
#
#   Env overrides (all optional):
#     TRACK=production|beta|alpha|internal   (default: production)
#     ROLLOUT=0.0-1.0                        (default: 0.2  → 20% staged rollout)
#     STATUS=draft|inProgress|halted|completed
#                                            (default: draft → uploaded but NOT
#                                             released to users until promoted. Also
#                                             the ONLY status a brand-new "draft app"
#                                             accepts until the Console store-setup
#                                             checklist — incl. content rating — is done.)
#     SOURCE=run|release                     (default: run; SoulSync's CI uploads the
#                                             AAB as a run artifact, NOT a Release asset,
#                                             so "run" is correct here. "release" pulls
#                                             from a GitHub Release asset instead.)
#     PROMOTE=1                              (when the versionCode is already a draft on
#                                             the track, promote that existing draft to
#                                             STATUS/ROLLOUT instead of message-and-exit.)
#
# EXAMPLES:
#   # Default: stage v<app.json> as a production DRAFT (no users affected) to verify.
#   scripts/publish-to-play.sh
#
#   # Go live to a 20% staged rollout, halt-able from Play Console.
#   STATUS=inProgress ROLLOUT=0.2 scripts/publish-to-play.sh
#
#   # Full rollout once you're confident.
#   STATUS=completed ROLLOUT=1.0 scripts/publish-to-play.sh
#
#   # The current versionCode is already a production DRAFT → promote it live to 20%.
#   PROMOTE=1 STATUS=inProgress ROLLOUT=0.2 scripts/publish-to-play.sh
#
set -euo pipefail

REPO="Antimatter543/mood-tracker"
PKG="com.raeduslabs.soulsyncapp"
TRACK="${TRACK:-production}"
ROLLOUT="${ROLLOUT:-0.2}"
STATUS="${STATUS:-draft}"
SOURCE="${SOURCE:-run}"
PROMOTE="${PROMOTE:-}"

die() { echo "ERROR: $*" >&2; exit 1; }

command -v gplay >/dev/null || die "gplay not on PATH (see ~/ops/references/play-console-cli.md)"
command -v gh    >/dev/null || die "gh CLI not on PATH"
command -v jq    >/dev/null || die "jq not on PATH"
command -v node  >/dev/null || die "node not on PATH"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_JSON="$ROOT/frontend/app.json"
CHANGELOG="$ROOT/frontend/CHANGELOG.md"
[ -f "$APP_JSON" ] || die "frontend/app.json not found at $APP_JSON"

# --- 1. resolve version + versionCode (single source of truth: frontend/app.json) ---
# Optional positional override; otherwise read expo.version from app.json.
VERSION="${1:-$(node -p "require('$APP_JSON').expo.version")}"
[ -n "$VERSION" ] || die "could not resolve version"

# The Android versionCode is the artifact's real identity for the "already uploaded?"
# check. It is DERIVED MAJOR*10000+MINOR*100+PATCH in this repo; assert app.json agrees.
# String(...) wrap: `node -p` runs bare NUMBERS through util.inspect, which emits ANSI
# color codes when FORCE_COLOR is set (as it is under some agent shells) — the colored
# "20600" then fails the equality check against the clean derived value (bit us on the
# v2.6.0 publish, 2026-07-17). Strings print raw, so force a string.
VC_APP="$(node -p "String(require('$APP_JSON').expo.android.versionCode)")"
VC_DERIVED="$(node -e 'const [a,b,c]=process.argv[1].split(".").map(Number); process.stdout.write(String(a*10000+b*100+c))' "$VERSION")"
[ "$VC_APP" = "$VC_DERIVED" ] \
  || die "app.json versionCode ($VC_APP) != derived from version $VERSION ($VC_DERIVED). Fix app.json (run scripts/bump-version.js)."
VERSION_CODE="$VC_APP"
echo "Resolved: version=$VERSION  versionCode=$VERSION_CODE  package=$PKG"

# --- 2. is this versionCode ALREADY on the track? (don't re-upload — Play rejects it) ---
# tracks releases list does NOT need an edit (read-only). Pull every versionCode already
# present on the track, robust to both the activeArtifacts[].versionCode shape (drafts,
# what `tracks releases list` returns) and the flat versionCodes[] shape.
echo "Checking whether versionCode $VERSION_CODE is already on the '$TRACK' track…"
TRACK_JSON="$(gplay tracks releases list --package "$PKG" --track "$TRACK" 2>/dev/null || echo '{}')"
EXISTING_CODES="$(echo "$TRACK_JSON" | jq -r '
  (.releases // [])
  | map((.versionCodes // []) + ((.activeArtifacts // []) | map(.versionCode)))
  | add // []
  | map(tostring) | .[]' 2>/dev/null || true)"

if echo "$EXISTING_CODES" | grep -qx "$VERSION_CODE"; then
  STATE="$(echo "$TRACK_JSON" | jq -r --argjson vc "$VERSION_CODE" '
    (.releases // [])[]
    | select(((.versionCodes // []) + ((.activeArtifacts // []) | map(.versionCode))) | index($vc))
    | .releaseLifecycleState // "unknown"' | head -1)"
  echo "versionCode $VERSION_CODE is ALREADY on '$TRACK' (lifecycle: $STATE)."

  if [ -z "$PROMOTE" ]; then
    cat >&2 <<EOF
NOTHING TO UPLOAD — $VERSION (versionCode $VERSION_CODE) already exists on the '$TRACK' track.
You cannot re-upload an AAB whose versionCode already exists.

Choose one:
  • Promote the existing draft live:   PROMOTE=1 STATUS=inProgress ROLLOUT=0.2 $0
                                       PROMOTE=1 STATUS=completed  ROLLOUT=1.0 $0
    (Promotion is blocked on a *draft app* until the Console store-setup checklist —
     content rating / data safety / pricing — is complete. SoulSync's only remaining
     manual Play gate is the one-time content-rating IARC questionnaire.)
  • Ship a NEW version instead:        cd frontend && node scripts/bump-version.js patch
                                       then cut a release (tag → CI builds the AAB) and re-run.
EOF
    exit 0
  fi

  # --- PROMOTE path: take the existing draft live via edits→tracks update→commit. ---
  # (Do NOT re-run `gplay release`/`bundles upload` — they would try to re-upload.)
  echo "PROMOTE=1 → promoting existing versionCode $VERSION_CODE on '$TRACK' to status=$STATUS rollout=$ROLLOUT …"
  NOTES_FILE="$(mktemp)"; trap 'rm -f "$NOTES_FILE"' EXIT
  # (release notes assembled below in the shared block, written to $NOTES_FILE)
fi

# --- 3. release notes from frontend/CHANGELOG.md (Play caps at 500 chars/locale) -----
# Extract the matching "## [x.y.z]" section. Bound length with a CHAR CAP (${...:0:497}),
# NOT `head`/`awk|head` — under `set -euo pipefail` a closed pipe (SIGPIPE) blanks the
# output (the documented script gotcha).
NOTES_BODY=""
if [ -f "$CHANGELOG" ]; then
  NOTES_BODY="$(awk -v ver="$VERSION" '
    $0 ~ "^## \\[" ver "\\]" {grab=1; next}
    grab && /^## \[/ {exit}
    grab {print}
  ' "$CHANGELOG" | sed 's/\*\*//g; s/^- /• /' | sed '/^### /d' | grep -v '^[[:space:]]*$' || true)"
fi
if [ -n "$NOTES_BODY" ]; then
  NOTES="What's new in v${VERSION}:
${NOTES_BODY}"
else
  NOTES="Bug fixes and improvements (v${VERSION})."
fi
NOTES="${NOTES:0:497}"
echo "----- release notes -----"; echo "$NOTES"; echo "-------------------------"

# --- PROMOTE branch finishes here (no upload) ---------------------------------------
if [ -n "${NOTES_FILE:-}" ]; then
  # Build the track-releases payload that points the track at the EXISTING versionCode.
  # Pass rollout in explicitly (do NOT rely on env.ROLLOUT — jq only sees EXPORTED vars,
  # and ROLLOUT is a plain shell var here). userFraction only applies to a staged
  # (inProgress) rollout; for draft/completed it is omitted.
  jq -n \
    --arg name "$VERSION" \
    --argjson vc "$VERSION_CODE" \
    --arg status "$STATUS" \
    --arg notes "$NOTES" \
    --argjson rollout "$ROLLOUT" \
    '[{name:$name, versionCodes:[($vc|tostring)], status:$status,
       releaseNotes:[{language:"en-US", text:$notes}]}
      | if $status=="inProgress" then . + {userFraction: $rollout} else . end]' \
    > "$NOTES_FILE"
  echo "Track releases payload:"; cat "$NOTES_FILE"

  EDIT="$(gplay edits create --package "$PKG" | jq -r '.id // .editId // empty')"
  [ -n "$EDIT" ] || die "could not create edit"
  echo "edit=$EDIT"
  gplay tracks update   --package "$PKG" --edit "$EDIT" --track "$TRACK" --releases "@$NOTES_FILE" \
    || { gplay edits delete --package "$PKG" --edit "$EDIT" >/dev/null 2>&1 || true; die "tracks update failed"; }
  gplay edits validate  --package "$PKG" --edit "$EDIT" \
    || { gplay edits delete --package "$PKG" --edit "$EDIT" >/dev/null 2>&1 || true; die "edit validate failed — NOT committed"; }
  gplay edits commit    --package "$PKG" --edit "$EDIT"
  echo "Promoted. Current '$TRACK' track state:"
  gplay tracks releases list --package "$PKG" --track "$TRACK" --pretty
  exit 0
fi

# --- 4. locate + download the signed AAB --------------------------------------------
WORKDIR="$(mktemp -d)"; trap 'rm -rf "$WORKDIR"' EXIT
ARTIFACT="SoulSync-${VERSION}.aab"

if [ "$SOURCE" = "release" ]; then
  echo "Downloading AAB '$ARTIFACT' from GitHub Release v${VERSION}…"
  gh release download "v${VERSION}" -R "$REPO" --pattern '*.aab' --dir "$WORKDIR" \
    || die "no .aab on release v${VERSION}. SoulSync's CI uploads the AAB as a RUN ARTIFACT, not a release asset — use the default SOURCE=run."
else
  echo "Locating latest SUCCESSFUL release-apk.yml run with artifact '$ARTIFACT'…"
  # Find a successful run that actually has the version-matched AAB artifact, so an old
  # run (different version) can never deliver a stale bundle. Scan recent successes.
  RUN_ID=""
  for id in $(gh run list -R "$REPO" --workflow release-apk.yml --status success \
                --limit 20 --json databaseId -q '.[].databaseId'); do
    if gh api "repos/$REPO/actions/runs/$id/artifacts" -q '.artifacts[].name' 2>/dev/null \
         | grep -qx "$ARTIFACT"; then
      RUN_ID="$id"; break
    fi
  done
  [ -n "$RUN_ID" ] || die "no successful release-apk.yml run has artifact '$ARTIFACT'. Cut a release (tag → CI builds the AAB) or run the workflow for this version first."
  echo "Run: $RUN_ID — downloading artifact '$ARTIFACT'…"
  gh run download "$RUN_ID" -R "$REPO" -n "$ARTIFACT" --dir "$WORKDIR" \
    || die "artifact download failed (artifact expired? re-run the workflow)"
fi

AAB="$(find "$WORKDIR" -name '*.aab' | head -1)"
[ -n "$AAB" ] || die "no .aab found after download"
echo "AAB: $AAB ($(du -h "$AAB" | cut -f1))"

# --- 5. preflight (offline secret/compliance/hygiene scan) --------------------------
echo "Running gplay preflight…"
gplay preflight --file "$AAB" || die "preflight failed — fix before publishing"

# --- 6. release ---------------------------------------------------------------------
echo "Releasing to track=$TRACK rollout=$ROLLOUT status=$STATUS …"
gplay release \
  --package "$PKG" \
  --track "$TRACK" \
  --bundle "$AAB" \
  --version-name "$VERSION" \
  --release-notes "$NOTES" \
  --rollout "$ROLLOUT" \
  --status "$STATUS" \
  --wait

echo "Done. Current '$TRACK' track state:"
gplay tracks releases list --package "$PKG" --track "$TRACK" --pretty
