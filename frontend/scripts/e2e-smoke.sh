#!/usr/bin/env bash
# e2e-smoke.sh: the in-emulator half of .github/workflows/e2e.yml.
#
# WHY IT EXISTS: jest renders components in Node, so it cannot see a bug that only
# the real native stack shows: a button that renders but cannot be pressed (the
# reanimated `entering` dead-Undo, 800789a/06df84b), an overlay strip that lets
# taps through (7fade96), a screen that never re-reads after a write (a0fd503).
# This script runs the Maestro smoke set against a release-built QA APK on an
# emulator and turns it into one PASS/FAIL table.
#
# Runs INSIDE reactivecircus/android-emulator-runner, after the emulator boots:
#   1. waits for boot (bounded), turns system error dialogs off, starts logcat,
#   2. pins what the flows can see: clock, font scale, animations, status bar,
#      and GESTURE navigation (smoke 04 taps the bottom inset strip, which only
#      belongs to the app when no 3-button nav bar sits there),
#   3. installs the APK,
#   4. runs EVERY flow in SMOKE_FLOWS, in order. A failing flow does not stop the
#      run: the table must show the whole picture, not the first red.
# Exit 0 only if at least one flow ran and every flow that ran passed.
#
# NEVER run this on the laptop: it drives whatever adb device is attached. CI only.
# Its logic is tested device-free by scripts/test-e2e-smoke.sh (shimmed adb +
# maestro), which runs in the PR gate. Change one, run the other.
# Never `pkill -f` here (it would match this script's own command line).
#
# Usage: frontend/scripts/e2e-smoke.sh <apk>
# Env:   E2E_OUT        artifact dir (default e2e-out)
#        E2E_FLOWS      comma-separated subset of SMOKE_FLOWS (default: all)
#        E2E_DEVICE     adb serial Maestro drives (default emulator-5554)
#        EMU_T0         epoch seconds taken just before the emulator step started
#        BOOT_TRIES     boot polls, 2 s apart (default 150 = 5 min)

set -uo pipefail

# The smoke set, in run order. `__tests__/maestroFlowLint.test.ts` fails if this
# list and .maestro/smoke/*.yaml ever disagree (an orphan flow that never runs,
# or a listed flow with no file).
SMOKE_FLOWS=(
  01-tabs-render
  02-add-entry-home
  03-timeline-delete-undo
  04-bin-overlay-blocks-taps
  05-undo-top-insert
)

APK="${1:-}"
OUT="${E2E_OUT:-e2e-out}"
DEVICE="${E2E_DEVICE:-emulator-5554}"
BOOT_TRIES="${BOOT_TRIES:-150}"
FLOW_DIR="$(cd "$(dirname "$0")/.." && pwd)/.maestro/smoke"
mkdir -p "$OUT/screens" "$OUT/maestro"
RESULT_ENV="$OUT/result.env"
SUMMARY="$OUT/summary.md"
: >"$RESULT_ENV"
T_START="$(date +%s)"

log() { printf '[e2e %s] %s\n' "$(date +%H:%M:%S)" "$*"; }
kv() { echo "$1=$2" >>"$RESULT_ENV"; }

# fail: a SETUP failure (no flow verdicts possible). Flow failures don't come here.
DEVICE_UP=0
fail() {
  log "FAIL: $*"
  # Only screenshot once a device is known to be there: input errors must not touch adb.
  (( DEVICE_UP )) && { adb exec-out screencap -p >"$OUT/screens/setup-fail.png" 2>/dev/null || true; }
  kv RESULT fail
  kv REASON "$*"
  { echo "## E2E smoke: setup failed"; echo; echo "$*"; } >"$SUMMARY"
  exit 1
}

# ── inputs (checked before touching the device) ───────────────────────────────
[[ -n "$APK" ]] || fail "usage: e2e-smoke.sh <apk>"
[[ -f "$APK" ]] || fail "APK not found: $APK"

# Resolve the flow subset. An unknown name is an error, never a silent skip: a typo
# in a dispatch input must not turn into a green run that tested nothing.
FLOWS=()
if [[ -n "${E2E_FLOWS:-}" ]]; then
  IFS=',' read -r -a WANT <<<"$E2E_FLOWS"
  for w in "${WANT[@]}"; do
    w="${w// /}"
    [[ -z "$w" ]] && continue
    known=0
    for f in "${SMOKE_FLOWS[@]}"; do [[ "$f" == "$w" ]] && known=1; done
    (( known )) || fail "unknown flow in E2E_FLOWS: $w (known: ${SMOKE_FLOWS[*]})"
    FLOWS+=("$w")
  done
else
  FLOWS=("${SMOKE_FLOWS[@]}")
fi
(( ${#FLOWS[@]} > 0 )) || fail "no flows selected"
for f in "${FLOWS[@]}"; do
  [[ -f "$FLOW_DIR/$f.yaml" ]] || fail "flow file missing: $FLOW_DIR/$f.yaml"
done

# ── device ready (bounded: a wedged emulator must fail, not hang to the job timeout) ──
adb wait-for-device
DEVICE_UP=1
booted=0
for (( i = 0; i < BOOT_TRIES; i++ )); do
  if [[ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == "1" ]]; then
    booted=1
    break
  fi
  sleep 2
done
(( booted )) || fail "emulator did not finish booting after $BOOT_TRIES polls"
kv BOOT_S $(( T_START - ${EMU_T0:-$T_START} ))

# `adb root` restarts adbd, which kills every open adb stream: it must come
# BEFORE the logcat capture, or logcat.txt ends up empty (first CI run did).
adb root >/dev/null 2>&1 || true
adb wait-for-device

# System error dialogs off, BEFORE anything restarts the launcher. On a busy CI
# emulator the Pixel Launcher can ANR while it relaunches for the nav-mode
# switch below; its "isn't responding" dialog then sits over the app and every
# flow fails its first assertion (first CI run: 5/5 flows, all on that dialog).
# The ANR is still logged, and an app crash still fails the flow's assertions.
adb shell settings put global hide_error_dialogs 1

adb logcat -c || true
adb logcat -v time >"$OUT/logcat.txt" 2>&1 &
LOGCAT_PID=$!
trap 'kill "$LOGCAT_PID" 2>/dev/null || true' EXIT

# clear_system_dialogs <when>: if a system ANR/crash dialog holds focus anyway
# (raised before the setting above took effect), record it and close it.
SYSTEM_DIALOGS=0
clear_system_dialogs() {
  local focus
  focus="$(adb shell dumpsys window 2>/dev/null | grep -m1 'mCurrentFocus' | tr -d '\r')"
  if [[ "$focus" =~ Application\ (Not\ Responding|Error) ]]; then
    SYSTEM_DIALOGS=$(( SYSTEM_DIALOGS + 1 ))
    log "system dialog before $1, closing it: $focus"
    kv "SYSTEM_DIALOG_$SYSTEM_DIALOGS" "$1: ${focus##* }"
    adb shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS >/dev/null 2>&1 || true
  fi
}

# ── determinism ───────────────────────────────────────────────────────────────
# Clock: Home's greeting and "today" come from the device clock. Pin it
# (google_apis images allow `adb root`): 2026-11-03 10:00 -> "Good morning".
# Lane G's frozen-clock seed link will make this redundant for seeded flows.
adb shell settings put global auto_time 0
adb shell settings put global auto_time_zone 0
adb shell date 110310002026.00 >/dev/null 2>&1 || log "warn: could not set the device clock"
kv CLOCK_AFTER_PIN "$(adb shell date | tr -d '\r')"
adb shell settings put system font_scale 1.0
# The runner's disable-animations already zeroes these; re-assert (cheap, explicit).
for k in window_animation_scale transition_animation_scale animator_duration_scale; do
  adb shell settings put global "$k" 0
done
# Gesture navigation, so the bottom safe-area inset is app-owned (see header).
adb shell cmd overlay enable-exclusive --category com.android.internal.systemui.navbar.gestural \
  >/dev/null 2>&1 || log "warn: could not switch to gesture navigation"
# The switch relaunches SystemUI and the launcher. Wait (bounded) for the mode to
# land, then give the launcher a moment to finish relaunching before the install.
nav=""
for (( i = 0; i < 15; i++ )); do
  nav="$(adb shell settings get secure navigation_mode 2>/dev/null | tr -d '\r')"
  [[ "$nav" == "2" ]] && break
  sleep 1
done
kv NAV_MODE "$nav"
sleep 5
# Status bar demo mode: fixed clock, full battery, no notification icons.
adb shell settings put global sysui_demo_allowed 1
demo() { adb shell am broadcast -a com.android.systemui.demo -e command "$@" >/dev/null 2>&1 || true; }
demo enter
demo clock -e hhmm 1000
demo battery -e level 100 -e plugged false
demo network -e wifi show -e level 4
demo network -e mobile hide
demo notifications -e visible false

# ── install ───────────────────────────────────────────────────────────────────
T=$(date +%s)
# -g grants runtime permissions (notifications) so no system dialog covers a flow.
adb install -r -t -g "$APK" >"$OUT/install.txt" 2>&1 || { cat "$OUT/install.txt"; fail "adb install failed"; }
kv INSTALL_S $(( $(date +%s) - T ))
log "installed $APK"

# ── the smoke set ─────────────────────────────────────────────────────────────
passed=0
failed=0
ROWS=()
for name in "${FLOWS[@]}"; do
  log "flow $name"
  clear_system_dialogs "$name"
  T=$(date +%s)
  maestro --device "$DEVICE" test --no-ansi \
    --test-output-dir "$OUT/maestro/$name" \
    --debug-output "$OUT/maestro/$name-debug" --flatten-debug-output \
    "$FLOW_DIR/$name.yaml" >"$OUT/maestro/$name.log" 2>&1
  rc=$?
  secs=$(( $(date +%s) - T ))
  cat "$OUT/maestro/$name.log"
  kv "FLOW_${name}_S" "$secs"
  if (( rc == 0 )); then
    passed=$(( passed + 1 ))
    kv "FLOW_${name}" pass
    ROWS+=("| $name | PASS | ${secs}s |")
  else
    failed=$(( failed + 1 ))
    kv "FLOW_${name}" fail
    ROWS+=("| $name | **FAIL** (rc=$rc) | ${secs}s |")
    adb exec-out screencap -p >"$OUT/screens/$name-fail.png" 2>/dev/null || true
    log "flow $name FAILED (rc=$rc)"
  fi
done

kv SYSTEM_DIALOGS "$SYSTEM_DIALOGS"
kv FLOWS_PASSED "$passed"
kv FLOWS_FAILED "$failed"
kv FLOWS_S $(( $(date +%s) - T_START ))
{
  echo "| flow | result | time |"
  echo "|---|---|---|"
  printf '%s\n' "${ROWS[@]}"
} >"$SUMMARY"
cat "$SUMMARY"

if (( failed == 0 && passed > 0 )); then
  kv RESULT pass
  log "PASS ($passed flows)"
  exit 0
fi
kv RESULT fail
kv REASON "$failed of $(( passed + failed )) flows failed"
log "FAIL: $failed of $(( passed + failed )) flows failed"
exit 1
