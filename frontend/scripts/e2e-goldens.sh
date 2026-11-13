#!/usr/bin/env bash
# e2e-goldens.sh: the in-emulator half of the golden-screenshot gate (e2e.yml).
#
# WHY IT EXISTS: jest cannot see a layout or contrast regression. This runs the
# flows in .maestro/goldens/ on the same emulator image as the smoke set, once per
# device config, and collects their screenshots into <out>/actual/<config>/<name>.png.
# It takes no verdict on the pixels: scripts/golden-diff.mjs does, in a later step of
# the job, with the emulator already shut down and node_modules available.
#
# THE TWO DEVICE CONFIGS exist because 91b9554 (#20) was invisible on anything but
# the shape it broke on: "layout problems with top notch and when soft navigation
# buttons are used". gesture = the bench default; threebutton-cutout = 3-button nav
# plus an emulated tall cutout. A config is APPLIED and then ASSERTED: a failed
# overlay switch would otherwise produce a run of images on the wrong config, which
# looks like a pass until the goldens are recorded from it.
#
# NEVER run this on the laptop: it drives whatever adb device is attached. CI only.
# Its logic is tested device-free by scripts/test-e2e-goldens.sh (shimmed adb +
# maestro), which runs in the PR gate. Change one, run the other.
#
# Usage: frontend/scripts/e2e-goldens.sh <apk>
# Env:   E2E_OUT     artifact dir (default e2e-out/goldens)
#        E2E_RECORD  1 = recording new goldens, so a status bar that no longer matches
#                    budgets.json is reported, not fatal (it is how a new value is found)
#        E2E_DEVICE  adb serial Maestro drives (default emulator-5554)
#        BOOT_TRIES  boot polls, 2 s apart (default 150 = 5 min)
# Exit 0 only if every flow on every config passed and produced its images.

set -uo pipefail

# Device configs, in run order. __tests__/maestroFlowLint.test.ts fails if these lists
# and .maestro/goldens/*.yaml disagree (an orphan flow, a listed flow with no file) or
# if two flows in one config take a screenshot with the same name.
GOLDEN_CONFIGS=(
  gesture
  threebutton-cutout
)
# The full set runs on the default config. A screen whose layout cannot depend on the
# nav config stays off the second one: every flow costs about a minute of CI.
GOLDEN_FLOWS_gesture=(
  tabs-week
  home-empty
  themes-week
  stats-custom-range
  time-of-day-one-bucket
  timeline300
  entry-form
  bin-overlay
)
GOLDEN_FLOWS_threebutton_cutout=(
  tabs-week
  entry-form
  bin-overlay
)

APK="${1:-}"
OUT="${E2E_OUT:-e2e-out/goldens}"
DEVICE="${E2E_DEVICE:-emulator-5554}"
BOOT_TRIES="${BOOT_TRIES:-150}"
HERE="$(cd "$(dirname "$0")" && pwd)"
FLOW_DIR="$HERE/../.maestro/goldens"
BUDGETS="$HERE/../e2e/goldens/budgets.json"
mkdir -p "$OUT/screens" "$OUT/maestro" "$OUT/actual"
T_START="$(date +%s)"

FAIL_TITLE="Golden screenshots"
# shellcheck source=e2e-lib.sh
source "${E2E_LIB:-$HERE/e2e-lib.sh}"

# ── inputs (checked before touching the device) ───────────────────────────────
[[ -n "$APK" ]] || fail "usage: e2e-goldens.sh <apk>"
[[ -f "$APK" ]] || fail "APK not found: $APK"
[[ -f "$BUDGETS" ]] || fail "budgets file missing: $BUDGETS"
for config in "${GOLDEN_CONFIGS[@]}"; do
  declare -n flows="GOLDEN_FLOWS_${config//-/_}"
  (( ${#flows[@]} > 0 )) || fail "no flows for config $config"
  for f in "${flows[@]}"; do
    [[ -f "$FLOW_DIR/$f.yaml" ]] || fail "flow file missing: $FLOW_DIR/$f.yaml"
  done
  unset -n flows
done

# ── device ────────────────────────────────────────────────────────────────────
wait_for_device
prepare_device
pin_determinism

# declared_crop <config>: crop.<config>.top from budgets.json ('' if not declared).
# python3, not node: this step has no node_modules, and the file is plain JSON.
declared_crop() {
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("crop",{}).get(sys.argv[2],{}).get("top",""))' \
    "$BUDGETS" "$1"
}

# apply_config <config>: switch the device to it, then PROVE the switch landed.
apply_config() {
  local config="$1" want_nav cutout_on measured declared
  case "$config" in
    gesture)
      want_nav=2
      cutout_on=0
      adb shell cmd overlay enable-exclusive --category com.android.internal.systemui.navbar.gestural \
        >/dev/null 2>&1 || log "warn: could not switch to gesture navigation"
      adb shell cmd overlay disable com.android.internal.display.cutout.emulation.tall >/dev/null 2>&1 || true
      ;;
    threebutton-cutout)
      want_nav=0
      cutout_on=1
      adb shell cmd overlay enable-exclusive --category com.android.internal.systemui.navbar.threebutton \
        >/dev/null 2>&1 || log "warn: could not switch to 3-button navigation"
      adb shell cmd overlay enable com.android.internal.display.cutout.emulation.tall >/dev/null 2>&1 \
        || log "warn: could not enable the tall cutout"
      ;;
    *) fail "unknown device config: $config" ;;
  esac
  wait_for_nav_mode "$want_nav"
  kv "NAV_MODE_${config}" "$NAV_MODE"
  [[ "$NAV_MODE" == "$want_nav" ]] \
    || fail "config $config: navigation_mode is '$NAV_MODE', wanted $want_nav"

  adb shell cmd overlay list >"$OUT/overlays-$config.txt" 2>&1 || true
  # `cmd overlay list` marks an enabled overlay "[x]" and a disabled one "[ ]".
  if (( cutout_on )) && ! grep -qE '\[x\].*cutout\.emulation\.tall' "$OUT/overlays-$config.txt"; then
    fail "config $config: the tall cutout overlay is not enabled (see overlays-$config.txt)"
  fi
  if (( !cutout_on )) && grep -qE '\[x\].*cutout\.emulation' "$OUT/overlays-$config.txt"; then
    fail "config $config: a cutout overlay is still enabled (see overlays-$config.txt)"
  fi

  clear_system_dialogs "config-$config"
  # The switch restarts SystemUI, which drops demo mode: set it again per config.
  demo_mode

  # The status bar height is what golden-diff crops. Measured, not assumed: it changes
  # with the cutout, and a stale crop silently hides app pixels or compares system ones.
  adb shell dumpsys window >"$OUT/window-$config.txt" 2>&1 || true
  measured="$(tr -d '\r' <"$OUT/window-$config.txt" \
    | grep -oE 'statusBars[^[]*\[0,0\]\[[0-9]+,[0-9]+\]' | head -1 \
    | grep -oE '[0-9]+\]$' | tr -d ']')"
  declared="$(declared_crop "$config")"
  kv "STATUS_BAR_${config}" "${measured:-unknown}"
  log "config $config: nav=$NAV_MODE status bar measured=${measured:-unknown} declared=${declared:-none}"
  if [[ -z "$measured" || "$measured" != "$declared" ]]; then
    if [[ "${E2E_RECORD:-0}" == "1" ]]; then
      kv "CROP_MISMATCH_${config}" "measured ${measured:-unknown}, budgets.json has ${declared:-none}"
    else
      fail "config $config: status bar is ${measured:-unknown} px, budgets.json crops ${declared:-nothing}. Set crop.$config.top and re-record."
    fi
  fi
}

# ── install ───────────────────────────────────────────────────────────────────
T=$(date +%s)
# -g grants runtime permissions (notifications) so no system dialog covers a flow.
adb install -r -t -g "$APK" >"$OUT/install.txt" 2>&1 || { cat "$OUT/install.txt"; fail "adb install failed"; }
kv INSTALL_S $(( $(date +%s) - T ))

# ── the flows ─────────────────────────────────────────────────────────────────
passed=0
failed=0
images=0
ROWS=()
SEED_RETRIES=0
for config in "${GOLDEN_CONFIGS[@]}"; do
  log "config $config"
  apply_config "$config"
  mkdir -p "$OUT/actual/$config"
  declare -n flows="GOLDEN_FLOWS_${config//-/_}"
  for name in "${flows[@]}"; do
    log "$config: flow $name"
    clear_system_dialogs "$config/$name"
    run="$OUT/maestro/$config/$name"
    mkdir -p "$run"
    T=$(date +%s)
    maestro --device "$DEVICE" test --no-ansi \
      --test-output-dir "$run/out" \
      --debug-output "$run/debug" --flatten-debug-output \
      "$FLOW_DIR/$name.yaml" >"$run/log.txt" 2>&1
    rc=$?
    secs=$(( $(date +%s) - T ))
    cat "$run/log.txt"
    kv "FLOW_${config}_${name}_S" "$secs"

    # Collect. Maestro writes takeScreenshot output under <debug>/<flow>/takeScreenshot/.
    # seed-retry is launch.yaml's marker that the seed needed its one retry: never a
    # golden, but a pass that needed a retry stays visible.
    count=0
    note=""
    while IFS= read -r png; do
      shot="$(basename "$png" .png)"
      if [[ "$shot" == "seed-retry" ]]; then
        SEED_RETRIES=$(( SEED_RETRIES + 1 ))
        note=" (seed retried)"
        continue
      fi
      # Two flows writing one name would silently overwrite: the golden would show
      # only the later screen. The lint catches it in jest; this is the backstop.
      if [[ -e "$OUT/actual/$config/$shot.png" ]]; then
        rc=98
        note="$note (duplicate image $shot)"
        continue
      fi
      cp "$png" "$OUT/actual/$config/$shot.png"
      count=$(( count + 1 ))
    done < <(find "$run/debug" -path '*/takeScreenshot/*.png' 2>/dev/null | sort)
    images=$(( images + count ))
    # Every golden flow takes screenshots, so zero means the collection above is
    # looking in the wrong place (a Maestro layout change), and nothing was tested.
    if (( rc == 0 && count == 0 )); then
      rc=99
      note="$note (no screenshots found)"
    fi

    if (( rc == 0 )); then
      passed=$(( passed + 1 ))
      kv "FLOW_${config}_${name}" pass
      ROWS+=("| $config | $name | PASS | $count | ${secs}s${note} |")
    else
      failed=$(( failed + 1 ))
      kv "FLOW_${config}_${name}" fail
      ROWS+=("| $config | $name | **FAIL** (rc=$rc) | $count | ${secs}s${note} |")
      adb exec-out screencap -p >"$OUT/screens/$config-$name-fail.png" 2>/dev/null || true
      log "$config: flow $name FAILED (rc=$rc)$note"
    fi
  done
  unset -n flows
done

kv SYSTEM_DIALOGS "$SYSTEM_DIALOGS"
kv SEED_RETRIES "$SEED_RETRIES"
kv FLOWS_PASSED "$passed"
kv FLOWS_FAILED "$failed"
kv IMAGES "$images"
kv GOLDENS_S $(( $(date +%s) - T_START ))
{
  echo "| config | flow | result | images | time |"
  echo "|---|---|---|---|---|"
  printf '%s\n' "${ROWS[@]}"
} >"$SUMMARY"
cat "$SUMMARY"

if (( failed == 0 && passed > 0 && images > 0 )); then
  kv RESULT pass
  log "PASS ($passed flows, $images images)"
  exit 0
fi
kv RESULT fail
kv REASON "$failed of $(( passed + failed )) flows failed"
log "FAIL: $failed of $(( passed + failed )) flows failed"
exit 1
