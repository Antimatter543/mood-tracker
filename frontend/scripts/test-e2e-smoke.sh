#!/usr/bin/env bash
# test-e2e-smoke.sh: device-free tests for scripts/e2e-smoke.sh.
#
# WHY IT EXISTS: e2e-smoke.sh is the emulator gate, and a harness bug fails
# OPEN: swallow one flow's exit code, or select zero flows, and the job is green
# while nothing was tested. Its emulator run costs ~20 CI minutes and only
# happens on main / dispatch / a labelled PR, so its logic is checked here, in
# the PR gate, in about a second, against a fake `adb` and a fake `maestro`
# placed first on PATH. Modelled on Nudge's scripts/test-device-qa.sh.
#
# Counterfactual hook: SMOKE_SCRIPT=<path> runs these checks against another
# copy of the script (e.g. one with a planted bug) to prove a check can fail.
#
# Usage: bash scripts/test-e2e-smoke.sh      (from frontend/, or anywhere)

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="${SMOKE_SCRIPT:-$HERE/e2e-smoke.sh}"
FLOW_DIR="$(cd "$HERE/.." && pwd)/.maestro/smoke"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass=0
fails=0
ok() { pass=$(( pass + 1 )); printf '  ok   %s\n' "$1"; }
bad() { fails=$(( fails + 1 )); printf '  FAIL %s\n' "$1"; }
check() { local desc="$1"; shift; if "$@"; then ok "$desc"; else bad "$desc"; fi; }

# ── shims ─────────────────────────────────────────────────────────────────────
SHIM="$TMP/shim"
mkdir -p "$SHIM"
# adb: logs every call; behaviour steered by SHIM_BOOT / SHIM_INSTALL_RC.
cat >"$SHIM/adb" <<'EOF'
#!/usr/bin/env bash
echo "adb $*" >>"$SHIM_LOG"
case "$*" in
  "shell getprop sys.boot_completed") echo "${SHIM_BOOT:-1}" ;;
  install*) exit "${SHIM_INSTALL_RC:-0}" ;;
  "exec-out screencap -p") printf 'PNG' ;;
  "shell date") echo "Tue Nov  3 10:00:00 AEST 2026" ;;
  "shell settings get secure navigation_mode") echo 2 ;;
  # SHIM_ANR=1: a launcher ANR dialog is on screen (but not focused, as on CI).
  "shell dumpsys window windows")
    echo "  Window #3 Window{1 u0 com.raeduslabs.soulsyncapp/.MainActivity}:"
    [[ -n "${SHIM_ANR:-}" ]] && echo "  Window #4 Window{9 u0 Application Not Responding: com.google.android.apps.nexuslauncher}:" ;;
  "shell cat /sdcard/e2e-ui.xml")
    [[ -n "${SHIM_ANR:-}" ]] && echo '<node index="1" text="Close app" resource-id="android:id/aerr_close" class="android.widget.Button" bounds="[66,940][934,1060]" />' ;;
esac
exit 0
EOF
# maestro: logs every call; exits 1 for any flow named in SHIM_FAIL_FLOWS.
cat >"$SHIM/maestro" <<'EOF'
#!/usr/bin/env bash
echo "maestro $*" >>"$SHIM_LOG"
flow="${*: -1}"
name="$(basename "$flow" .yaml)"
case ",${SHIM_FAIL_FLOWS:-}," in *",$name,"*) echo "flow $name failed"; exit 1 ;; esac
echo "flow $name passed"
exit 0
EOF
# sleep: instant, so the bounded boot wait finishes in no time.
printf '#!/usr/bin/env bash\nexit 0\n' >"$SHIM/sleep"
chmod +x "$SHIM/adb" "$SHIM/maestro" "$SHIM/sleep"

APK="$TMP/app.apk"
echo apk >"$APK"

# run_case <name> [VAR=value ...] -- [script args]: runs the script in a clean
# env (env -i, so nothing from the CI job leaks in) and leaves its exit code in
# $RC, its output in $OUTDIR, and the shim call log in $LOG.
run_case() {
  local name="$1"; shift
  OUTDIR="$TMP/$name/out"
  LOG="$TMP/$name/calls.log"
  mkdir -p "$TMP/$name/home"
  : >"$LOG"
  local vars=()
  while [[ $# -gt 0 && "$1" != "--" ]]; do vars+=("$1"); shift; done
  [[ "${1:-}" == "--" ]] && shift
  env -i PATH="$SHIM:/usr/bin:/bin" HOME="$TMP/$name/home" SHIM_LOG="$LOG" \
    E2E_OUT="$OUTDIR" "${vars[@]}" bash "$SCRIPT" "$@" >"$TMP/$name/stdout" 2>&1
  RC=$?
}
maestro_calls() { grep -c '^maestro ' "$LOG" || true; }
result() { sed -n "s/^$1=//p" "$OUTDIR/result.env" | tail -1; }

ALL=(01-tabs-render 02-add-entry-home 03-timeline-delete-undo 04-bin-overlay-blocks-taps 05-undo-top-insert)

echo "e2e-smoke.sh self-test ($SCRIPT)"

echo "case: every flow passes"
run_case allpass -- "$APK"
check "exits 0" test "$RC" -eq 0
check "runs all ${#ALL[@]} flows" test "$(maestro_calls)" -eq "${#ALL[@]}"
check "runs them in the listed order" \
  test "$(grep '^maestro ' "$LOG" | sed 's|.*/||; s|\.yaml$||' | tr '\n' ' ')" == "${ALL[*]} "
check "every flow file it runs exists in .maestro/smoke" \
  bash -c 'for f in "$@"; do [[ -f "'"$FLOW_DIR"'/$f.yaml" ]] || exit 1; done' _ "${ALL[@]}"
check "Maestro targets the emulator serial" grep -q '^maestro --device emulator-5554 test' "$LOG"
check "installs with runtime permissions granted (-g)" grep -q '^adb install -r -t -g ' "$LOG"
check "pins the device clock" grep -q '^adb shell date 110310002026.00' "$LOG"
check "pins gesture navigation" grep -q 'navbar.gestural' "$LOG"
# line_of <regex>: first call-log line number matching it (99999 if absent).
line_of() { local n; n="$(grep -n -m1 -E "$1" "$LOG" | cut -d: -f1)"; echo "${n:-99999}"; }
check "hides system error dialogs before the nav switch restarts the launcher" \
  test "$(line_of 'hide_error_dialogs 1')" -lt "$(line_of 'navbar.gestural')"
check "starts logcat only after adb root (root restarts adbd, killing the stream)" \
  test "$(line_of '^adb root')" -lt "$(line_of '^adb logcat -v')"
check "no system dialog seen: none recorded, nothing closed" \
  bash -c '[[ "$(sed -n "s/^SYSTEM_DIALOGS=//p" "$1")" == 0 ]] && ! grep -qE "CLOSE_SYSTEM_DIALOGS|input tap" "$2"' _ "$OUTDIR/result.env" "$LOG"
check "result.env says pass with 5 passed" \
  test "$(result RESULT)/$(result FLOWS_PASSED)/$(result FLOWS_FAILED)" == "pass/5/0"
check "summary table has one PASS row per flow" test "$(grep -c '| PASS |' "$OUTDIR/summary.md")" -eq 5

echo "case: a system ANR dialog is on screen, unfocused (the first two CI runs' failure)"
run_case anrdialog SHIM_ANR=1 -- "$APK"
# The shim's dialog never goes away, so it is seen at setup and before each flow.
check "closes it at setup and before every flow" \
  test "$(grep -c '^adb shell input tap 500 1000$' "$LOG")" -eq $(( ${#ALL[@]} + 1 ))
check "closes it BEFORE the install and before the first flow" \
  test "$(line_of '^adb shell input tap')" -lt "$(line_of '^adb install')"
check "taps the dialog's own Close app button, not a broadcast" bash -c '! grep -q CLOSE_SYSTEM_DIALOGS "$1"' _ "$LOG"
check "records each one in result.env" test "$(result SYSTEM_DIALOGS)" == $(( ${#ALL[@]} + 1 ))
check "names the stuck package" \
  grep -q '^SYSTEM_DIALOG_1=setup: Application Not Responding: com.google.android.apps.nexuslauncher$' "$OUTDIR/result.env"

echo "case: --snapshot (the AVD-snapshot step)"
run_case snapshot SHIM_ANR=1 -- --snapshot
check "exits 0 with no APK" test "$RC" -eq 0
check "never installs or runs Maestro" bash -c '! grep -qE "^(adb install|maestro)" "$1"' _ "$LOG"
check "hides system error dialogs" grep -q 'hide_error_dialogs 1' "$LOG"
check "closes the dialog so it is not saved into the snapshot" grep -q '^adb shell input tap 500 1000$' "$LOG"
check "says snapshot-ready" test "$(result RESULT)" == snapshot-ready
run_case snapshot-clean -- --snapshot
check "no dialog: closes nothing" bash -c '! grep -q "input tap" "$1"' _ "$LOG"

echo "case: one flow fails in the middle"
run_case onefail SHIM_FAIL_FLOWS=03-timeline-delete-undo -- "$APK"
check "exits non-zero" test "$RC" -ne 0
check "still runs the flows after the failure" test "$(maestro_calls)" -eq "${#ALL[@]}"
check "the failing flow is FAIL in the table" grep -q '| 03-timeline-delete-undo | \*\*FAIL\*\*' "$OUTDIR/summary.md"
check "the others stay PASS" test "$(grep -c '| PASS |' "$OUTDIR/summary.md")" -eq 4
check "result.env says fail, 1 failed" test "$(result RESULT)/$(result FLOWS_FAILED)" == "fail/1"
check "captures a screenshot of the failing flow" test -s "$OUTDIR/screens/03-timeline-delete-undo-fail.png"

echo "case: the LAST flow fails (rc must not be overwritten by earlier passes)"
run_case lastfail SHIM_FAIL_FLOWS=05-undo-top-insert -- "$APK"
check "exits non-zero" test "$RC" -ne 0

echo "case: APK missing"
run_case noapk -- "$TMP/nope.apk"
check "exits non-zero" test "$RC" -ne 0
check "never runs Maestro" test "$(maestro_calls)" -eq 0
check "never touches the device" test ! -s "$LOG"

echo "case: no APK argument"
run_case noarg --
check "exits non-zero" test "$RC" -ne 0

echo "case: install fails"
run_case badinstall SHIM_INSTALL_RC=1 -- "$APK"
check "exits non-zero" test "$RC" -ne 0
check "never runs Maestro" test "$(maestro_calls)" -eq 0
check "says why in result.env" test "$(result REASON)" == "adb install failed"

echo "case: the emulator never finishes booting"
run_case noboot SHIM_BOOT=0 BOOT_TRIES=3 -- "$APK"
check "exits non-zero" test "$RC" -ne 0
check "gives up after BOOT_TRIES polls" test "$(grep -c 'getprop sys.boot_completed' "$LOG")" -eq 3
check "never installs or runs Maestro" bash -c '! grep -qE "^(adb install|maestro)" "$1"' _ "$LOG"

echo "case: E2E_FLOWS selects a subset"
run_case subset E2E_FLOWS=02-add-entry-home,04-bin-overlay-blocks-taps -- "$APK"
check "exits 0" test "$RC" -eq 0
check "runs exactly the 2 named flows" test "$(maestro_calls)" -eq 2
check "and not the others" bash -c '! grep -q "01-tabs-render" "$1"' _ "$LOG"

echo "case: E2E_FLOWS names an unknown flow"
run_case unknown E2E_FLOWS=02-add-entry-home,typo-flow -- "$APK"
check "exits non-zero (a typo is never a green run that tested nothing)" test "$RC" -ne 0
check "never runs Maestro" test "$(maestro_calls)" -eq 0

echo "case: E2E_FLOWS is only separators"
run_case empty E2E_FLOWS=, -- "$APK"
check "exits non-zero (zero flows is not a pass)" test "$RC" -ne 0

echo "static: the script never uses pkill -f (it would match its own command line)"
check "no pkill in e2e-smoke.sh" bash -c '! grep -vE "^\s*#" "$1" | grep -q pkill' _ "$SCRIPT"

echo
echo "$pass passed, $fails failed"
(( fails == 0 ))
