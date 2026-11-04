#!/usr/bin/env bash
# e2e-spike.sh: the in-emulator half of .github/workflows/e2e-spike.yml (Lane F spike, go/no-go).
#
# Runs INSIDE reactivecircus/android-emulator-runner, after it reports the emulator booted:
#   1. pins what a screenshot can see (clock, status bar, font scale, animations),
#   2. installs the QA APK,
#   3. runs ONE Maestro flow (empty DB -> the "Good ..." greeting): this is the pass/fail,
#   4. measures two things the plan marks unverified, WITHOUT affecting pass/fail:
#        - assertScreenshot against a same-screen reference (positive control),
#        - assertScreenshot against a different screen, and whether Maestro writes a diff image.
#
# NEVER run this on the laptop: it drives whatever adb device is attached. CI only.
# Never `pkill -f` anything here (it matches this script's own command line).
#
# Usage: .github/scripts/e2e-spike.sh <apk>
# Env:   SPIKE_OUT  artifact dir (default e2e-spike-out)
#        EMU_T0     epoch seconds taken just before the emulator step started
#        FLOW_DIR   Maestro flows (default frontend/.maestro/spike)

set -uo pipefail

APK="${1:?usage: e2e-spike.sh <apk>}"
OUT="${SPIKE_OUT:-e2e-spike-out}"
FLOW_DIR="${FLOW_DIR:-frontend/.maestro/spike}"
mkdir -p "$OUT/screens" "$OUT/maestro"
RESULT_ENV="$OUT/result.env"
: >"$RESULT_ENV"
# Fixed mtime marker for "written by this run" finds (RESULT_ENV itself is appended to all the
# time, so its mtime keeps moving and would hide files written before the latest append).
touch "$OUT/.t0"
T_START="$(date +%s)"

log() { printf '[spike %s] %s\n' "$(date +%H:%M:%S)" "$*"; }
kv() { echo "$1=$2" >>"$RESULT_ENV"; }

fail() {
  log "FAIL: $*"
  adb exec-out screencap -p >"$OUT/screens/fail.png" 2>/dev/null || true
  kv RESULT fail
  kv REASON "$*"
  exit 1
}

# ── device ready ──────────────────────────────────────────────────────────────
adb wait-for-device
until [[ "$(adb shell getprop sys.boot_completed | tr -d '\r')" == "1" ]]; do sleep 2; done
BOOT_S=$(( T_START - ${EMU_T0:-$T_START} ))
kv BOOT_S "$BOOT_S"
log "device ready ${BOOT_S}s after the emulator step started (includes image download + AVD create)"

adb logcat -c || true
adb logcat -v time >"$OUT/logcat.txt" 2>&1 &
LOGCAT_PID=$!
trap 'kill "$LOGCAT_PID" 2>/dev/null || true' EXIT

# ── determinism: what a golden screenshot can see ─────────────────────────────
# Clock: Home's greeting and "today" come from the device clock, so two runs at different times
# of day render different pixels. Until lane C/G give the app a frozen QA clock, pin the device
# clock itself (google_apis images allow `adb root`). 2026-11-03 10:00 -> "Good morning".
adb root >/dev/null 2>&1 || true
adb wait-for-device
adb shell settings put global auto_time 0
adb shell settings put global auto_time_zone 0
adb shell date 110310002026.00 >/dev/null 2>&1 || log "warn: could not set the device clock"
kv CLOCK_AFTER_PIN "$(adb shell date | tr -d '\r')"
kv DEVICE_TZ "$(adb shell getprop persist.sys.timezone | tr -d '\r')"
adb shell settings put system font_scale 1.0
# Animations: the runner's disable-animations already zeroes the three scales; re-assert.
for k in window_animation_scale transition_animation_scale animator_duration_scale; do
  adb shell settings put global "$k" 0
done
# System UI demo mode: fixed status-bar clock, full battery, no notification icons.
adb shell settings put global sysui_demo_allowed 1
demo() { adb shell am broadcast -a com.android.systemui.demo -e command "$@" >/dev/null 2>&1 || true; }
demo enter
demo clock -e hhmm 1000
demo battery -e level 100 -e plugged false
demo network -e wifi show -e level 4
demo network -e mobile hide
demo notifications -e visible false
kv SCREEN "$(adb shell wm size | tr -d '\r' | tail -1 | sed 's/.*: *//') @ $(adb shell wm density | tr -d '\r' | tail -1 | sed 's/.*: *//')dpi"

# ── install ───────────────────────────────────────────────────────────────────
T=$(date +%s)
adb install -r -t -g "$APK" >"$OUT/install.txt" 2>&1 || { cat "$OUT/install.txt"; fail "adb install failed"; }
kv INSTALL_S $(( $(date +%s) - T ))
log "installed"

# maestro_run <name> <flow>: run one flow, keep its screenshots and debug output, echo the exit code.
maestro_run() {
  local name="$1" flow="$2" rc
  maestro --device emulator-5554 test --no-ansi \
    --test-output-dir "$OUT/maestro/$name" \
    --debug-output "$OUT/maestro/$name-debug" --flatten-debug-output \
    "$flow" >"$OUT/maestro/$name.log" 2>&1
  rc=$?
  cat "$OUT/maestro/$name.log"
  return "$rc"
}

# ── THE gate: one flow, empty DB, greeting visible ───────────────────────────
T=$(date +%s)
maestro_run launch-greeting "$FLOW_DIR/launch-greeting.yaml"
FLOW_RC=$?
kv FLOW_S $(( $(date +%s) - T ))
kv FLOW_RESULT "$([[ $FLOW_RC -eq 0 ]] && echo pass || echo fail)"
adb exec-out screencap -p >"$OUT/screens/after-flow.png" 2>/dev/null || true
(( FLOW_RC == 0 )) || fail "launch-greeting flow failed (rc=$FLOW_RC)"

HOME_A="$(find "$OUT/maestro/launch-greeting" . -name 'home-a.png' -newer "$OUT/.t0" 2>/dev/null | head -1)"
HOME_B="$(find "$OUT/maestro/launch-greeting" . -name 'home-b.png' -newer "$OUT/.t0" 2>/dev/null | head -1)"
kv HOME_A_PATH "${HOME_A:-missing}"
[[ -n "$HOME_A" ]] && cp "$HOME_A" "$OUT/screens/home-a.png"
[[ -n "$HOME_B" ]] && cp "$HOME_B" "$OUT/screens/home-b.png"
if [[ -n "$HOME_A" && -n "$HOME_B" ]]; then
  kv HOME_A_MD5 "$(md5sum "$HOME_A" | cut -d' ' -f1)"
  kv HOME_AB_BYTE_IDENTICAL "$(cmp -s "$HOME_A" "$HOME_B" && echo yes || echo no)"
fi

# ── measurement only: assertScreenshot (never changes RESULT) ─────────────────
if [[ -n "$HOME_A" ]]; then
  mkdir -p "$FLOW_DIR/ref"
  cp "$HOME_A" "$FLOW_DIR/ref/home-ref.png"
  touch "$OUT/.before-assert"
  maestro_run assert-same "$FLOW_DIR/assert-screenshot-same.yaml"
  kv ASSERT_SAME_RC $?
  maestro_run assert-diff "$FLOW_DIR/assert-screenshot-diff.yaml"
  kv ASSERT_DIFF_RC $?
  # Every image written after the asserts began, anywhere Maestro might put one.
  find . "$HOME/.maestro" "${TMPDIR:-/tmp}" -type f \( -name '*.png' -o -name '*.jpg' \) \
    -newer "$OUT/.before-assert" 2>/dev/null | grep -v '/screens/' | sort >"$OUT/images-after-assert.txt"
  # Match the FILE name: the flow is called assert-screenshot-diff, so a path-wide grep would also
  # count its plain screenshots. Maestro 2.12 names the diff step-NNN-assertScreenshot-diff.png.
  grep -E -- '-diff\.png$' "$OUT/images-after-assert.txt" | grep -v '/takeScreenshot/' >"$OUT/diff-images.txt" || true
  kv DIFF_IMAGES "$(wc -l <"$OUT/diff-images.txt" | tr -d ' ')"
  mkdir -p "$OUT/diff-images"
  while IFS= read -r f; do cp "$f" "$OUT/diff-images/" 2>/dev/null || true; done <"$OUT/diff-images.txt"
  ENTRY="$(find "$OUT/maestro/assert-diff" . -name 'entry-form.png' 2>/dev/null | head -1)"
  [[ -n "$ENTRY" ]] && cp "$ENTRY" "$OUT/screens/entry-form.png"
fi

kv CLOCK_AT_END "$(adb shell date | tr -d '\r')"
kv RESULT pass
log "PASS"
