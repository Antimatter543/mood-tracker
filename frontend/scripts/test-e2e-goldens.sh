#!/usr/bin/env bash
# test-e2e-goldens.sh: device-free tests for scripts/e2e-goldens.sh.
#
# WHY IT EXISTS: e2e-goldens.sh collects what golden-diff.mjs judges. A harness bug
# fails open or fails confusingly: swallow a flow's exit code, record on the wrong
# device config, or crop with a stale status bar height, and the verdict is wrong in a
# way no pixel shows. Its emulator run only happens on main / dispatch / a labelled PR,
# so its logic is checked here, in the PR gate, against a fake `adb` and `maestro`.
#
# Counterfactual hook: GOLDENS_SCRIPT=<path> runs these checks against another copy of
# the script (one with a planted bug) to prove a check can fail.
#
# Usage: bash scripts/test-e2e-goldens.sh      (from frontend/, or anywhere)

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="${GOLDENS_SCRIPT:-$HERE/e2e-goldens.sh}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass=0
fails=0
ok() { pass=$(( pass + 1 )); printf '  ok   %s\n' "$1"; }
bad() { fails=$(( fails + 1 )); printf '  FAIL %s\n' "$1"; }
check() { local desc="$1"; shift; if "$@"; then ok "$desc"; else bad "$desc"; fi; }

# A script copy under test reads flows and budgets relative to itself, so give it a
# tree: scripts/ + the real .maestro/goldens + a budgets file a case can replace.
TREE="$TMP/tree"
mkdir -p "$TREE/scripts" "$TREE/.maestro" "$TREE/e2e/goldens"
cp "$SCRIPT" "$TREE/scripts/e2e-goldens.sh"
cp "$HERE/e2e-lib.sh" "$TREE/scripts/e2e-lib.sh"
cp -r "$HERE/../.maestro/goldens" "$TREE/.maestro/goldens"
BUDGETS="$TREE/e2e/goldens/budgets.json"
write_budgets() {
  printf '{"defaultBudgetPct":0.1,"frameHeight":2160,"crop":{"gesture":{"top":%s},"threebutton-cutout":{"top":%s}}}\n' "$1" "$2" >"$BUDGETS"
}

# ── shims ─────────────────────────────────────────────────────────────────────
SHIM="$TMP/shim"
mkdir -p "$SHIM"
# adb keeps the device's config in files under $SHIM_STATE, so `settings get` and
# `dumpsys window` answer according to the overlay commands the script really sent.
cat >"$SHIM/adb" <<'EOF'
#!/usr/bin/env bash
echo "adb $*" >>"$SHIM_LOG"
mkdir -p "$SHIM_STATE"
case "$*" in
  "shell getprop sys.boot_completed") echo "${SHIM_BOOT:-1}" ;;
  install*) exit "${SHIM_INSTALL_RC:-0}" ;;
  "exec-out screencap -p") printf 'PNG' ;;
  "shell date") echo "Tue Nov  3 10:00:00 UTC 2026" ;;
  *navbar.gestural*) [[ -n "${SHIM_NAV_STUCK:-}" ]] || echo 2 >"$SHIM_STATE/nav" ;;
  *navbar.threebutton*) [[ -n "${SHIM_NAV_STUCK:-}" ]] || echo 0 >"$SHIM_STATE/nav" ;;
  "shell cmd overlay enable com.android.internal.display.cutout.emulation.tall")
    [[ -n "${SHIM_CUTOUT_STUCK:-}" ]] || echo 1 >"$SHIM_STATE/cutout" ;;
  "shell cmd overlay disable com.android.internal.display.cutout.emulation.tall") rm -f "$SHIM_STATE/cutout" ;;
  "shell settings get secure navigation_mode") cat "$SHIM_STATE/nav" 2>/dev/null || echo 1 ;;
  "shell cmd overlay list")
    if [[ -f "$SHIM_STATE/cutout" ]]; then echo "[x] com.android.internal.display.cutout.emulation.tall"
    else echo "[ ] com.android.internal.display.cutout.emulation.tall"; fi ;;
  "shell dumpsys window")
    if [[ -n "${SHIM_NO_STATUS_BAR:-}" ]]; then echo "nothing useful"
    elif [[ -f "$SHIM_STATE/cutout" ]]; then echo "  InsetsSource id=1 type=statusBars frame=[0,0][1080,121] visible=true"
    else echo "  InsetsSource id=1 type=statusBars frame=[0,0][1080,66] visible=true"; fi ;;
esac
exit 0
EOF
# maestro: logs the flow + the config it ran under; writes one PNG per takeScreenshot
# in the flow file, where the real one puts it.
cat >"$SHIM/maestro" <<'EOF'
#!/usr/bin/env bash
echo "maestro nav=$(cat "$SHIM_STATE/nav" 2>/dev/null) $*" >>"$SHIM_LOG"
flow="${*: -1}"
name="$(basename "$flow" .yaml)"
debug=""
while [[ $# -gt 0 ]]; do [[ "$1" == "--debug-output" ]] && debug="$2"; shift; done
dir="$debug/$name/takeScreenshot"
mkdir -p "$dir"
case ",${SHIM_NO_SHOTS_FLOWS:-}," in *",$name,"*) exit 0 ;; esac
sed -nE 's/^- takeScreenshot: (.+)$/\1/p; s/^    path: (.+)$/\1/p' "$flow" | while read -r shot; do
  echo png >"$dir/$shot.png"
done
case ",${SHIM_SEED_RETRY_FLOWS:-}," in *",$name,"*) echo png >"$dir/seed-retry.png" ;; esac
case ",${SHIM_DUP_FLOWS:-}," in *",$name,"*) echo png >"$dir/tab-home.png" ;; esac
case ",${SHIM_FAIL_FLOWS:-}," in *",$name,"*) echo "flow $name failed"; exit 1 ;; esac
echo "flow $name passed"
exit 0
EOF
printf '#!/usr/bin/env bash\nexit 0\n' >"$SHIM/sleep"
chmod +x "$SHIM/adb" "$SHIM/maestro" "$SHIM/sleep"

APK="$TMP/app.apk"
echo apk >"$APK"

# run_case <name> [VAR=value ...] -- [script args]: runs the script in a clean env and
# leaves its exit code in $RC, its output in $OUTDIR, the shim call log in $LOG.
run_case() {
  local name="$1"; shift
  OUTDIR="$TMP/$name/out"
  LOG="$TMP/$name/calls.log"
  mkdir -p "$TMP/$name/home"
  : >"$LOG"
  local vars=()
  while [[ $# -gt 0 && "$1" != "--" ]]; do vars+=("$1"); shift; done
  [[ "${1:-}" == "--" ]] && shift
  env -i PATH="$SHIM:/usr/bin:/bin" HOME="$TMP/$name/home" SHIM_LOG="$LOG" SHIM_STATE="$TMP/$name/state" \
    E2E_OUT="$OUTDIR" "${vars[@]}" bash "$TREE/scripts/e2e-goldens.sh" "$@" >"$TMP/$name/stdout" 2>&1
  RC=$?
}
maestro_calls() { grep -c '^maestro ' "$LOG" || true; }
result() { sed -n "s/^$1=//p" "$OUTDIR/result.env" | tail -1; }
line_of() { local n; n="$(grep -n -m1 -E "$1" "$LOG" | cut -d: -f1)"; echo "${n:-99999}"; }

# Read the lists the way the script does, so these checks follow them.
list_of() { sed -n "/^$1=(/,/^)/p" "$HERE/e2e-goldens.sh" | sed '1d;$d' | sed 's/#.*//' | tr -d ' ' | grep -v '^$'; }
GESTURE=($(list_of GOLDEN_FLOWS_gesture))
THREE=($(list_of GOLDEN_FLOWS_threebutton_cutout))
TOTAL=$(( ${#GESTURE[@]} + ${#THREE[@]} ))

echo "e2e-goldens.sh self-test ($SCRIPT)"
write_budgets 66 121

echo "case: every flow passes"
run_case allpass -- "$APK"
check "exits 0" test "$RC" -eq 0
check "runs every flow of every config" test "$(maestro_calls)" -eq "$TOTAL"
check "gesture flows run on nav mode 2" test "$(grep -c '^maestro nav=2 ' "$LOG")" -eq "${#GESTURE[@]}"
check "3-button flows run on nav mode 0" test "$(grep -c '^maestro nav=0 ' "$LOG")" -eq "${#THREE[@]}"
check "the gesture config runs first" test "$(line_of '^maestro nav=2')" -lt "$(line_of '^maestro nav=0')"
check "enables the cutout before the first 3-button flow" \
  test "$(line_of 'overlay enable com.android.internal.display.cutout')" -lt "$(line_of '^maestro nav=0')"
check "collects tab-home under each config" \
  bash -c '[[ -s "$1/actual/gesture/tab-home.png" && -s "$1/actual/threebutton-cutout/tab-home.png" ]]' _ "$OUTDIR"
check "keeps gesture-only shots off the other config" \
  bash -c '[[ -s "$1/actual/gesture/home-empty-dark.png" && ! -e "$1/actual/threebutton-cutout/home-empty-dark.png" ]]' _ "$OUTDIR"
check "element shots (cropOn path:) are collected too" test -s "$OUTDIR/actual/gesture/time-of-day-one-bucket.png"
check "result.env says pass" test "$(result RESULT)/$(result FLOWS_FAILED)" == "pass/0"
check "summary has one PASS row per flow" test "$(grep -c '| PASS |' "$OUTDIR/summary.md")" -eq "$TOTAL"
check "records the measured status bar per config" \
  test "$(result STATUS_BAR_gesture)/$(result STATUS_BAR_threebutton-cutout)" == "66/121"
check "pins the clock" grep -q '^adb shell date 110310002026.00' "$LOG"
check "installs with runtime permissions granted (-g)" grep -q '^adb install -r -t -g ' "$LOG"

echo "case: a flow fails in the middle"
run_case onefail SHIM_FAIL_FLOWS=stats-custom-range -- "$APK"
check "exits non-zero" test "$RC" -ne 0
check "still runs the flows after it, on both configs" test "$(maestro_calls)" -eq "$TOTAL"
check "the failing flow is FAIL in the table" grep -q '| stats-custom-range | \*\*FAIL\*\*' "$OUTDIR/summary.md"
check "captures a screenshot of it" test -s "$OUTDIR/screens/gesture-stats-custom-range-fail.png"
check "result.env says fail" test "$(result RESULT)" == fail

echo "case: the LAST flow fails (rc must not be overwritten by earlier passes)"
run_case lastfail SHIM_FAIL_FLOWS=bin-overlay -- "$APK"
check "exits non-zero" test "$RC" -ne 0

echo "case: a flow passes but its screenshots are not where we look"
run_case noshots SHIM_NO_SHOTS_FLOWS=entry-form -- "$APK"
check "exits non-zero (nothing collected is nothing tested)" test "$RC" -ne 0
check "says why" grep -q 'no screenshots found' "$OUTDIR/summary.md"

echo "case: two flows write the same image name"
run_case dup SHIM_DUP_FLOWS=home-empty -- "$APK"
check "exits non-zero" test "$RC" -ne 0
check "names the image" grep -q 'duplicate image tab-home' "$OUTDIR/summary.md"

echo "case: launch.yaml's retry marker"
run_case seedretry SHIM_SEED_RETRY_FLOWS=home-empty -- "$APK"
check "still a pass" test "$RC" -eq 0
check "counts the retry" test "$(result SEED_RETRIES)" == 1
check "names it on the row" grep -q '| home-empty | PASS | .*seed retried' "$OUTDIR/summary.md"
check "seed-retry is never collected as a golden" test ! -e "$OUTDIR/actual/gesture/seed-retry.png"

echo "case: the nav overlay switch does not land"
run_case navstuck SHIM_NAV_STUCK=1 -- "$APK"
check "exits non-zero" test "$RC" -ne 0
check "never runs a flow on the wrong config" test "$(maestro_calls)" -eq 0
check "says why" bash -c 'grep -q "navigation_mode" "$1"' _ "$OUTDIR/result.env"

echo "case: the cutout overlay does not land"
run_case cutoutstuck SHIM_CUTOUT_STUCK=1 -- "$APK"
check "exits non-zero" test "$RC" -ne 0
check "stops before the first 3-button flow" test "$(grep -c '^maestro nav=0 ' "$LOG")" -eq 0
check "says why" bash -c 'grep -q "cutout overlay is not enabled" "$1"' _ "$OUTDIR/result.env"

echo "case: the status bar no longer matches the declared crop"
write_budgets 66 99
run_case cropdrift -- "$APK"
check "gate mode: exits non-zero" test "$RC" -ne 0
check "gate mode: names the config and both numbers" bash -c 'grep -q "status bar is 121 px, budgets.json crops 99" "$1"' _ "$OUTDIR/result.env"
run_case cropdrift-record E2E_RECORD=1 -- "$APK"
check "record mode: still records (it is how a new height is found)" test "$RC" -eq 0
check "record mode: reports the mismatch" test -n "$(result CROP_MISMATCH_threebutton-cutout)"
write_budgets 66 121

echo "case: the status bar cannot be measured"
run_case nomeasure SHIM_NO_STATUS_BAR=1 -- "$APK"
check "exits non-zero (an unverifiable crop is not a pass)" test "$RC" -ne 0

echo "case: APK missing"
run_case noapk -- "$TMP/nope.apk"
check "exits non-zero" test "$RC" -ne 0
check "never touches the device" test ! -s "$LOG"

echo "case: no APK argument"
run_case noarg --
check "exits non-zero" test "$RC" -ne 0

echo "case: budgets.json missing"
mv "$BUDGETS" "$BUDGETS.bak"
run_case nobudgets -- "$APK"
check "exits non-zero before touching the device" bash -c '[[ "$1" -ne 0 && ! -s "$2" ]]' _ "$RC" "$LOG"
mv "$BUDGETS.bak" "$BUDGETS"

echo "case: install fails"
run_case badinstall SHIM_INSTALL_RC=1 -- "$APK"
check "exits non-zero" test "$RC" -ne 0
check "never runs Maestro" test "$(maestro_calls)" -eq 0

echo "case: the emulator never finishes booting"
run_case noboot SHIM_BOOT=0 BOOT_TRIES=3 -- "$APK"
check "exits non-zero" test "$RC" -ne 0
check "gives up after BOOT_TRIES polls" test "$(grep -c 'getprop sys.boot_completed' "$LOG")" -eq 3

echo "static: the script never uses pkill -f (it would match its own command line)"
check "no pkill in e2e-goldens.sh" bash -c '! grep -vE "^\s*#" "$1" | grep -q pkill' _ "$SCRIPT"

echo
echo "$pass passed, $fails failed"
(( fails == 0 ))
