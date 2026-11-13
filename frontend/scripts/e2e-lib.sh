#!/usr/bin/env bash
# e2e-lib.sh: emulator setup shared by e2e-smoke.sh and e2e-goldens.sh. Sourced, never
# run.
#
# WHY IT EXISTS: both harnesses must see the SAME device (clock, font scale, animation
# scales, system dialogs handled the same way). Two copies of this would drift, and a
# drift here shows up as flakes neither harness can explain. Every workaround below is
# one a real CI run paid for; the comments say which.
#
# The sourcing script sets OUT before sourcing, and `$FAIL_TITLE` for its summary
# heading. Tested device-free through scripts/test-e2e-smoke.sh and
# test-e2e-goldens.sh. Never `pkill -f` here (it would match the caller's command line).

RESULT_ENV="$OUT/result.env"
SUMMARY="$OUT/summary.md"
: >"$RESULT_ENV"

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
  { echo "## $FAIL_TITLE: setup failed"; echo; echo "$*"; } >"$SUMMARY"
  exit 1
}

# wait_for_device: bounded: a wedged emulator must fail, not hang to the job timeout.
wait_for_device() {
  local booted=0 i
  adb wait-for-device
  DEVICE_UP=1
  for (( i = 0; i < BOOT_TRIES; i++ )); do
    if [[ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == "1" ]]; then
      booted=1
      break
    fi
    sleep 2
  done
  (( booted )) || fail "emulator did not finish booting after $BOOT_TRIES polls"
}

# prepare_device: root, system error dialogs off, logcat on.
prepare_device() {
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
}

# clear_system_dialogs <when>: close a system ANR/crash dialog that exists
# anyway, and record it. Second CI run: the dialog was already up when the AVD
# snapshot restored (it was SAVED into the snapshot), so the setting above never
# saw it raised. Detection lists ALL windows: that dialog did not hold
# mCurrentFocus, which is why a focus check missed it. It is closed by tapping
# its own "Close app" button (android:id/aerr_close, from a uiautomator dump):
# "Wait" leaves a hung process that re-raises it, and CLOSE_SYSTEM_DIALOGS does
# not reliably dismiss an error dialog (kept as the fallback only).
SYSTEM_DIALOGS=0
clear_system_dialogs() {
  local win bounds
  win="$(adb shell dumpsys window windows 2>/dev/null | tr -d '\r' \
    | grep -oE 'Application (Not Responding|Error): [A-Za-z0-9._]+' | head -1)"
  [[ -n "$win" ]] || return 0
  SYSTEM_DIALOGS=$(( SYSTEM_DIALOGS + 1 ))
  log "system dialog before $1, closing it: $win"
  kv "SYSTEM_DIALOG_$SYSTEM_DIALOGS" "$1: $win"
  adb shell uiautomator dump /sdcard/e2e-ui.xml >/dev/null 2>&1 || true
  # uiautomator writes bounds last on each node: [x1,y1][x2,y2] -> 4 numbers.
  bounds="$(adb shell cat /sdcard/e2e-ui.xml 2>/dev/null | tr -d '\r' \
    | grep -oE 'resource-id="android:id/aerr_close"[^>]*bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"' \
    | grep -oE '[0-9]+' | tail -4 | tr '\n' ' ')"
  if [[ "$bounds" =~ ^([0-9]+)\ ([0-9]+)\ ([0-9]+)\ ([0-9]+)\ $ ]]; then
    adb shell input tap $(( (BASH_REMATCH[1] + BASH_REMATCH[3]) / 2 )) $(( (BASH_REMATCH[2] + BASH_REMATCH[4]) / 2 ))
  else
    adb shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS >/dev/null 2>&1 || true
  fi
  sleep 2
}

# pin_determinism: clock, font scale, animation scales.
pin_determinism() {
  local k
  # Clock: Home's greeting and "today" come from the device clock. Pin it
  # (google_apis images allow `adb root`): 2026-11-03 10:00 -> "Good morning".
  # subflows/launch.yaml freezes the app clock at this same instant.
  adb shell settings put global auto_time 0
  adb shell settings put global auto_time_zone 0
  adb shell date 110310002026.00 >/dev/null 2>&1 || log "warn: could not set the device clock"
  kv CLOCK_AFTER_PIN "$(adb shell date | tr -d '\r')"
  adb shell settings put system font_scale 1.0
  # The runner's disable-animations already zeroes these; re-assert (cheap, explicit).
  for k in window_animation_scale transition_animation_scale animator_duration_scale; do
    adb shell settings put global "$k" 0
  done
}

# wait_for_nav_mode <value>: the overlay switch relaunches SystemUI and the launcher.
# Wait (bounded) for the mode to land, then give the launcher a moment to finish
# relaunching. Sets NAV_MODE to what the device reports; the caller decides whether
# a mismatch is fatal.
wait_for_nav_mode() {
  local i
  NAV_MODE=""
  for (( i = 0; i < 15; i++ )); do
    NAV_MODE="$(adb shell settings get secure navigation_mode 2>/dev/null | tr -d '\r')"
    [[ "$NAV_MODE" == "$1" ]] && break
    sleep 1
  done
  sleep 5
}

# demo_mode: status bar with a fixed clock, full battery, no notification icons.
demo_mode() {
  adb shell settings put global sysui_demo_allowed 1
  demo() { adb shell am broadcast -a com.android.systemui.demo -e command "$@" >/dev/null 2>&1 || true; }
  demo enter
  demo clock -e hhmm 1000
  demo battery -e level 100 -e plugged false
  demo network -e wifi show -e level 4
  demo network -e mobile hide
  demo notifications -e visible false
}
