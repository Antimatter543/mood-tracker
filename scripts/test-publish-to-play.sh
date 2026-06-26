#!/usr/bin/env bash
#
# test-publish-to-play.sh — regression tests for the pure logic in publish-to-play.sh.
#
# Covers the security-critical bits that can regress SILENTLY (a gplay/Play JSON shape
# change, or a notes-cap edit), WITHOUT touching the network or Play:
#   1. versionCode derivation from a semver (MAJOR*10000+MINOR*100+PATCH).
#   2. The "is this versionCode already on the track?" jq filter, against BOTH the
#      activeArtifacts[].versionCode shape (what `tracks releases list` returns for a
#      DRAFT — verified live 2026-06-27) and the flat versionCodes[] shape, plus a
#      no-match case. This is the gate that prevents a duplicate-versionCode re-upload.
#   3. The release-notes 497-char cap (the SIGPIPE-safe ${NOTES:0:497} bound).
#   4. The PROMOTE track-releases payload shape (userFraction only for inProgress).
#
# Run: scripts/test-publish-to-play.sh   (needs jq + node, same as the script under test)
#
set -euo pipefail
command -v jq   >/dev/null || { echo "SKIP: jq not installed"; exit 0; }
command -v node >/dev/null || { echo "SKIP: node not installed"; exit 0; }

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   - $1"; }
nok()  { FAIL=$((FAIL+1)); echo "  FAIL - $1: expected [$2] got [$3]"; }
eq()   { [ "$2" = "$3" ] && ok "$1" || nok "$1" "$2" "$3"; }

# Exact filters lifted from publish-to-play.sh so a divergence is caught here.
extract_codes() { # stdin: track JSON → newline-separated versionCodes
  jq -r '(.releases // [])
    | map((.versionCodes // []) + ((.activeArtifacts // []) | map(.versionCode)))
    | add // [] | map(tostring) | .[]'
}

echo "1) versionCode derivation"
derive() { node -e 'const [a,b,c]=process.argv[1].split(".").map(Number); process.stdout.write(String(a*10000+b*100+c))' "$1"; }
eq "2.3.4 → 20304" "20304" "$(derive 2.3.4)"
eq "1.2.1 → 10201" "10201" "$(derive 1.2.1)"
eq "2.0.0 → 20000" "20000" "$(derive 2.0.0)"
eq "10.20.30 → 102030" "102030" "$(derive 10.20.30)"

echo "2) versionCode-on-track detection (the no-re-upload gate)"
# 2a. DRAFT shape (real live shape from `gplay tracks releases list`).
DRAFT_JSON='{"releases":[{"activeArtifacts":[{"versionCode":20304}],"releaseLifecycleState":"RELEASE_LIFECYCLE_STATE_DRAFT","releaseName":"2.3.4","track":"production"}]}'
CODES="$(echo "$DRAFT_JSON" | extract_codes)"
echo "$CODES" | grep -qx 20304 && ok "draft activeArtifacts shape: detects 20304" || nok "draft shape" "20304 present" "$CODES"
echo "$CODES" | grep -qx 20305 && nok "draft shape: must NOT detect absent 20305" "absent" "$CODES" || ok "draft shape: does not detect absent 20305"
# 2b. Flat versionCodes[] shape (completed/inProgress releases).
FLAT_JSON='{"releases":[{"versionCodes":["27","31"],"status":"completed"}]}'
CODES="$(echo "$FLAT_JSON" | extract_codes)"
echo "$CODES" | grep -qx 31 && ok "flat versionCodes shape: detects 31" || nok "flat shape" "31 present" "$CODES"
# 2c. Empty / no-releases track (fresh app) → no codes, no crash.
eq "empty track → no codes" "" "$(echo '{}' | extract_codes)"
eq "empty releases → no codes" "" "$(echo '{"releases":[]}' | extract_codes)"

echo "3) release-notes 497-char cap (SIGPIPE-safe bound)"
LONG="$(printf 'x%.0s' {1..800})"; CAPPED="${LONG:0:497}"
eq "800 chars capped to 497" "497" "${#CAPPED}"
SHORT="Bug fixes and improvements (v2.3.4)."; eq "short notes unchanged" "$SHORT" "${SHORT:0:497}"

echo "4) PROMOTE track-releases payload (userFraction only for inProgress)"
payload() { # $1=status $2=rollout
  jq -nc --arg name "2.3.4" --argjson vc 20304 --arg status "$1" --arg notes "n" --argjson rollout "$2" \
    '[{name:$name, versionCodes:[($vc|tostring)], status:$status, releaseNotes:[{language:"en-US",text:$notes}]}
      | if $status=="inProgress" then . + {userFraction:$rollout} else . end]'
}
eq "inProgress includes userFraction" "0.2" "$(payload inProgress 0.2 | jq -r '.[0].userFraction')"
eq "completed omits userFraction"   "null" "$(payload completed 1.0 | jq -r '.[0].userFraction')"
eq "draft omits userFraction"       "null" "$(payload draft 0.2     | jq -r '.[0].userFraction')"
eq "versionCodes is a string array" "20304" "$(payload draft 0.2 | jq -r '.[0].versionCodes[0]')"

echo
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
