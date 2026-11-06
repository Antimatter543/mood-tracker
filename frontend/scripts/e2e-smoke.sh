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
#        frontend/scripts/e2e-smoke.sh --snapshot   (prepare the cached AVD snapshot)
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
T_START="$(date +%s)"

# Setup shared with e2e-goldens.sh. E2E_LIB: the self-test's SMOKE_SCRIPT counterfactual
# runs a copy of this script from elsewhere, so the sibling path alone would not resolve.
FAIL_TITLE="E2E smoke"
# shellcheck source=e2e-lib.sh
source "${E2E_LIB:-$(cd "$(dirname "$0")" && pwd)/e2e-lib.sh}"

# ── inputs (checked before touching the device) ───────────────────────────────
resolve_inputs() {
  [[ -n "$APK" ]] || fail "usage: e2e-smoke.sh <apk> | --snapshot"
  [[ -f "$APK" ]] || fail "APK not found: $APK"
  # Resolve the flow subset. An unknown name is an error, never a silent skip: a
  # typo in a dispatch input must not turn into a green run that tested nothing.
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
}

# --snapshot: the AVD-snapshot step (e2e.yml, cache miss only). Boot, hide error
# dialogs, let first-boot work settle, close any dialog, stop. The emulator then
# saves its state, and every later run restores THAT: an ANR dialog left up here
# is frozen into the cache and covers the app in every run (second CI run).
SNAPSHOT=0
if [[ "$APK" == "--snapshot" ]]; then SNAPSHOT=1; else resolve_inputs; fi

# ── device ready ──────────────────────────────────────────────────────────────
wait_for_device
kv BOOT_S $(( T_START - ${EMU_T0:-$T_START} ))
prepare_device

if (( SNAPSHOT )); then
  # A fresh AVD's first boot keeps working (package scans, launcher setup, Play
  # services) for a while after boot_completed; that is when the launcher ANRs.
  # 60 s is the settle budget; the closing check below catches what outlasts it.
  sleep "${SNAPSHOT_SETTLE_S:-60}"
  clear_system_dialogs snapshot
  clear_system_dialogs snapshot-recheck
  kv SYSTEM_DIALOGS "$SYSTEM_DIALOGS"
  kv RESULT snapshot-ready
  log "snapshot ready ($SYSTEM_DIALOGS system dialog(s) closed)"
  exit 0
fi

# ── determinism ───────────────────────────────────────────────────────────────
pin_determinism
# Gesture navigation, so the bottom safe-area inset is app-owned (see header).
adb shell cmd overlay enable-exclusive --category com.android.internal.systemui.navbar.gestural \
  >/dev/null 2>&1 || log "warn: could not switch to gesture navigation"
wait_for_nav_mode 2
kv NAV_MODE "$NAV_MODE"
clear_system_dialogs setup
demo_mode

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
# subflows/launch.yaml retries the QA seed once when it reports an error, and
# takes this screenshot when it does. A retry still passes the flow, so count it
# here: a pass that needed a retry must stay visible, never silently green.
SEED_RETRY_STEP='Take screenshot seed-retry'
SEED_RETRIES=0
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
  retried="$(grep -c "$SEED_RETRY_STEP" "$OUT/maestro/$name.log" || true)"
  note=""
  if (( retried > 0 )); then
    SEED_RETRIES=$(( SEED_RETRIES + retried ))
    note=" (seed retried)"
  fi
  if (( rc == 0 )); then
    passed=$(( passed + 1 ))
    kv "FLOW_${name}" pass
    ROWS+=("| $name | PASS | ${secs}s${note} |")
  else
    failed=$(( failed + 1 ))
    kv "FLOW_${name}" fail
    ROWS+=("| $name | **FAIL** (rc=$rc) | ${secs}s${note} |")
    adb exec-out screencap -p >"$OUT/screens/$name-fail.png" 2>/dev/null || true
    log "flow $name FAILED (rc=$rc)"
  fi
done

kv SYSTEM_DIALOGS "$SYSTEM_DIALOGS"
kv SEED_RETRIES "$SEED_RETRIES"
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
