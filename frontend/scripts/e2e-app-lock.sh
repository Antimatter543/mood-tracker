#!/usr/bin/env bash
# e2e-app-lock.sh: device verification of the app lock + distress wipe, run
# INSIDE reactivecircus/android-emulator-runner (e2e.yml, dispatch input
# `applock`). Maestro cannot touch a fingerprint sensor, so this drives the
# emulator with adb: `adb emu finger touch <id>` plays a finger, a uiautomator
# dump reads the screen, and the database is pulled (adb root) and read with
# python's sqlite3 to prove what the wipe kept and what it destroyed.
#
# Fingers: 1 is enrolled (the owner), 2 is not (the "wrong finger").
# PIN: 1111. NEVER run on the laptop: it drives whatever adb device is attached.
#
# Usage: frontend/scripts/e2e-app-lock.sh <qa-apk>
set -uo pipefail

APK="${1:?usage: e2e-app-lock.sh <qa-apk>}"
OUT="${E2E_OUT:-e2e-out}"
BOOT_TRIES="${BOOT_TRIES:-150}"
PKG=com.raeduslabs.soulsyncapp
PIN=1111
mkdir -p "$OUT/screens" "$OUT/ui" "$OUT/db"
FAIL_TITLE="App lock e2e"
# shellcheck source=e2e-lib.sh
source "$(cd "$(dirname "$0")" && pwd)/e2e-lib.sh"

CHECKS=()
NFAIL=0
check() { # check <name> <0|1 ok> [detail]
  if [[ "$2" == 1 ]]; then CHECKS+=("| $1 | PASS | ${3:-} |"); log "PASS $1 ${3:-}";
  else CHECKS+=("| $1 | **FAIL** | ${3:-} |"); NFAIL=$((NFAIL + 1)); log "FAIL $1 ${3:-}"; fi
}
STEP=0
shot() { STEP=$((STEP + 1)); adb exec-out screencap -p >"$OUT/screens/$(printf %02d $STEP)-$1.png" 2>/dev/null || true; }

UI=""
dump() { # refresh $UI with the current window's hierarchy
  adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
  UI="$(adb shell cat /sdcard/ui.xml 2>/dev/null | tr -d '\r')"
}
has() { dump; grep -qiE "$1" <<<"$UI"; }
wait_for() { # wait_for <regex> [tries] (1.5 s apart)
  local i
  for (( i = 0; i < ${2:-20}; i++ )); do has "$1" && return 0; sleep 1.5; done
  return 1
}
# Center of the first node whose attributes match <regex> (uses the cached $UI).
center_of() {
  local node b
  node="$(grep -oE '<node [^>]*>' <<<"$UI" | grep -iE "$1" | head -1)"
  [[ -n "$node" ]] || return 1
  b="$(grep -oE 'bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"' <<<"$node" | grep -oE '[0-9]+' | tr '\n' ' ')"
  read -r x1 y1 x2 y2 <<<"$b"
  echo "$(( (x1 + x2) / 2 )) $(( (y1 + y2) / 2 ))"
}
tap_match() { # tap the first node matching <regex>; 1 if none
  local c
  dump
  c="$(center_of "$1")" || return 1
  # shellcheck disable=SC2086
  adb shell input tap $c
}
tap_text() { tap_match "text=\"($1)\""; }
tap_id() { tap_match "resource-id=\"$1\""; }
node_attr() { # node_attr <id> <attr>
  dump
  grep -oE "<node [^>]*resource-id=\"$1\"[^>]*>" <<<"$UI" | head -1 | grep -oE "$2=\"[^\"]*\"" | cut -d'"' -f2
}
finger() { adb -e emu finger touch "$1" >/dev/null 2>&1; sleep 0.4; adb -e emu finger remove "$1" >/dev/null 2>&1 || true; }
launch() { adb shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1; }
home() { adb shell input keyevent KEYCODE_HOME; sleep 2; }
enter_pin() { adb shell input text "$PIN"; adb shell input keyevent 66; }
scroll_to_id() { # swipe up until <id> is on screen (bounded)
  local i
  for (( i = 0; i < 12; i++ )); do has "resource-id=\"$1\"" && return 0; adb shell input swipe 540 1600 540 700 400; sleep 1; done
  return 1
}

# Pull the app database (WAL folded in) and run SQL on it on the runner.
DBDIR=/data/data/$PKG/files/SQLite
sql() { python3 - "$OUT/db/moodTracker.db" "$1" <<'PY'
import sqlite3, sys
c = sqlite3.connect(sys.argv[1])
for row in c.execute(sys.argv[2]).fetchall():
    print("|".join("" if v is None else str(v) for v in row))
PY
}
pull_db() {
  rm -f "$OUT/db/moodTracker.db"*
  for f in moodTracker.db moodTracker.db-wal moodTracker.db-shm; do
    adb pull "$DBDIR/$f" "$OUT/db/$f" >/dev/null 2>&1 || true
  done
  [[ -f "$OUT/db/moodTracker.db" ]]
}
push_db() { # replace the device DB with the (checkpointed) local copy; app must be stopped
  python3 -c "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute('PRAGMA wal_checkpoint(TRUNCATE)'); c.execute('PRAGMA journal_mode=DELETE'); c.close()" "$OUT/db/moodTracker.db"
  local owner; owner="$(adb shell stat -c %u:%g "$DBDIR/moodTracker.db" | tr -d '\r')"
  adb shell rm -f "$DBDIR/moodTracker.db-wal" "$DBDIR/moodTracker.db-shm"
  adb push "$OUT/db/moodTracker.db" "$DBDIR/moodTracker.db" >/dev/null
  adb shell chown "$owner" "$DBDIR/moodTracker.db"
  adb shell restorecon "$DBDIR/moodTracker.db" >/dev/null 2>&1 || true
}

# ── device ───────────────────────────────────────────────────────────────────
wait_for_device
prepare_device
clear_system_dialogs setup
adb install -r -t -g "$APK" >"$OUT/install.txt" 2>&1 || { cat "$OUT/install.txt"; fail "adb install failed"; }
log "installed"

# ── 1. screen lock PIN + enrolled fingerprint #1 ────────────────────────────
adb shell locksettings set-pin "$PIN" >/dev/null 2>&1 || log "warn: set-pin failed"
adb shell am start -a android.settings.FINGERPRINT_ENROLL >/dev/null 2>&1 \
  || adb shell am start -a android.settings.BIOMETRIC_ENROLL >/dev/null 2>&1
sleep 3
enrolled=0
for (( i = 0; i < 60; i++ )); do
  dump
  cp /dev/null /dev/null
  if grep -qiE 'text="(Fingerprint added|All set!?)"' <<<"$UI"; then
    shot enroll-done
    tap_text 'Done|DONE' || true
    enrolled=1; break
  elif grep -qiE 'password_entry|pin_entry|Confirm your PIN|Re-enter your PIN|Enter your (device )?PIN' <<<"$UI" \
       && ! grep -qiE 'Touch the sensor|Lift, then touch' <<<"$UI"; then
    enter_pin; sleep 2
  elif c="$(center_of 'text="(MORE|More|I AGREE|I agree|AGREE|Agree|NEXT|Next|START|Start|Continue|CONTINUE|Got it|OK)"')"; then
    # shellcheck disable=SC2086
    adb shell input tap $c; sleep 1.5
  else
    finger 1; sleep 1
  fi
done
(( i == 59 )) && shot enroll-timeout
adb shell dumpsys fingerprint >"$OUT/dumpsys-fingerprint.txt" 2>&1 || true
check "fingerprint enrolled on emulator" "$enrolled"
(( enrolled )) || { shot enroll-fail; echo "$UI" >"$OUT/ui/enroll-fail.xml"; }
home

# ── 2. seed a journal, then add private things the seed has none of ─────────
adb shell am start -a android.intent.action.VIEW -d "myapp://qa/seed?scenario=week" "$PKG" >/dev/null 2>&1
wait_for 'QA seed: ok week' 40; seeded=$?
check "QA seed week" "$(( seeded == 0 ))"
adb shell am force-stop "$PKG"; sleep 1
pull_db || fail "could not pull the database"
PHOTO=/data/data/$PKG/files/entry_media/e2e_private.jpg
adb shell mkdir -p "/data/data/$PKG/files/entry_media"
adb exec-out screencap -p >"$OUT/db/photo.png" && adb push "$OUT/db/photo.png" "$PHOTO" >/dev/null
adb shell chown "$(adb shell stat -c %u:%g "$DBDIR/moodTracker.db" | tr -d '\r')" "$PHOTO" "/data/data/$PKG/files/entry_media"
python3 - "$OUT/db/moodTracker.db" "file://$PHOTO" <<'PY'
import sqlite3, sys
c = sqlite3.connect(sys.argv[1])
c.execute("INSERT INTO activity_groups (name, sort_order) VALUES ('Therapy', 99)")
g = c.execute("SELECT id FROM activity_groups WHERE name='Therapy'").fetchone()[0]
c.execute("INSERT INTO activities (name, group_id) VALUES ('Panic attack', ?)", (g,))
a = c.execute("SELECT id FROM activities WHERE name='Panic attack'").fetchone()[0]
e = c.execute("SELECT MAX(id) FROM entries").fetchone()[0]
c.execute("UPDATE entries SET notes='E2E SECRET NOTE', starred_at='2026-11-01T10:00:00.000Z' WHERE id=?", (e,))
c.execute("INSERT OR REPLACE INTO health_metrics (date, sleep_total_minutes, avg_heart_rate, synced_at) VALUES ('2026-11-01', 420, 61, 'e2e')")
c.execute("INSERT INTO entry_activities (entry_id, activity_id) VALUES (?, ?)", (e, a))
c.execute("INSERT INTO entry_media (entry_id, file_path) VALUES (?, ?)", (e, sys.argv[2]))
c.commit()
PY
push_db
BEFORE_ENTRIES="$(sql 'SELECT COUNT(*) FROM entries WHERE deleted_at IS NULL')"
BEFORE_NOTES="$(sql 'SELECT COUNT(*) FROM entries WHERE notes IS NOT NULL AND notes <> ""')"
BEFORE_MOODS="$(sql 'SELECT group_concat(id || ":" || mood, ",") FROM (SELECT id, mood FROM entries WHERE deleted_at IS NULL ORDER BY id)')"
BEFORE_DEFAULT_LINKS="$(sql "SELECT COUNT(*) FROM entry_activities ea JOIN activities a ON a.id=ea.activity_id JOIN activity_groups g ON g.id=a.group_id WHERE g.name <> 'Therapy'")"
log "before: entries=$BEFORE_ENTRIES notes=$BEFORE_NOTES default_links=$BEFORE_DEFAULT_LINKS"
check "journal has private notes before" "$(( BEFORE_NOTES > 0 ))" "notes=$BEFORE_NOTES"

# ── 3. defaults: lock off, app opens straight in ─────────────────────────────
launch; sleep 4
has 'resource-id="app-lock-screen"'; check "lock OFF by default: no lock screen" "$(( $? != 0 ))"
shot default-open

# ── 4. turn the lock on (needs the enrolled finger) ─────────────────────────
tap_id tab-settings; sleep 2
scroll_to_id app-lock-switch; check "Settings shows App lock switch" "$(( $? == 0 ))"
[[ "$(node_attr app-lock-switch checked)" == "false" ]]; check "App lock switch default off" "$(( $? == 0 ))"
has 'resource-id="distress-wipe-switch"'; check "distress option hidden while lock off" "$(( $? != 0 ))"
shot settings-before
tap_id app-lock-switch; sleep 2
shot enable-prompt
finger 1; sleep 3
[[ "$(node_attr app-lock-switch checked)" == "true" ]]; check "App lock turned on after fingerprint" "$(( $? == 0 ))"
shot settings-lock-on

# ── 5. minimise -> reopen, three times ───────────────────────────────────────
for n in 1 2 3; do
  home
  launch; sleep 2
  wait_for 'resource-id="app-lock-screen"|Unlock SoulSync' 8; locked=$?
  shot "reopen-$n-locked"
  check "reopen #$n shows lock" "$(( locked == 0 ))"
  finger 1; sleep 3
  has 'resource-id="app-lock-screen"'; check "reopen #$n unlocks with owner finger" "$(( $? != 0 ))"
done
shot after-reopens

# recents switch away and back
adb shell input keyevent KEYCODE_APP_SWITCH; sleep 2
adb shell input keyevent KEYCODE_HOME; sleep 1
launch; sleep 2
wait_for 'resource-id="app-lock-screen"' 8; check "app switch + return shows lock" "$(( $? == 0 ))"
finger 1; sleep 3

# cancel the prompt, stay locked, Unlock button works
home; launch; sleep 2
wait_for 'Unlock SoulSync' 8
adb shell input keyevent KEYCODE_BACK; sleep 2
has 'resource-id="app-lock-screen"'; check "cancelled prompt stays locked" "$(( $? == 0 ))"
shot cancelled
tap_id app-lock-unlock; sleep 2
finger 1; sleep 3
has 'resource-id="app-lock-screen"'; check "Unlock button prompts again and unlocks" "$(( $? != 0 ))"

# cold start
adb shell am force-stop "$PKG"; sleep 1
launch; sleep 5
has 'resource-id="app-lock-screen"|Unlock SoulSync'; check "cold start shows lock" "$(( $? == 0 ))"
shot cold-start
finger 1; sleep 3
has 'resource-id="app-lock-screen"'; check "cold start unlocks" "$(( $? != 0 ))"

# PIN fallback without distress
home; launch; sleep 2
wait_for 'Unlock SoulSync' 8
shot pin-option
if tap_text 'Use PIN|USE PIN'; then sleep 2; fi
enter_pin; sleep 3
has 'resource-id="app-lock-screen"'; check "device PIN unlocks when distress is off" "$(( $? != 0 ))"

# ── 6. turn the distress wipe on (warning dialog) ────────────────────────────
tap_id tab-settings; sleep 2
scroll_to_id distress-wipe-switch; check "distress option shown once lock is on" "$(( $? == 0 ))"
tap_id distress-wipe-switch; sleep 2
has 'Turn on distress wipe'; check "distress warning dialog shown" "$(( $? == 0 ))"
has 'backup'; check "warning mentions backup" "$(( $? == 0 ))"
shot distress-warning
tap_text 'TURN ON|Turn on'; sleep 2
[[ "$(node_attr distress-wipe-switch checked)" == "true" ]]; check "distress wipe turned on" "$(( $? == 0 ))"
has 'resource-id="distress-wipe-hint"'; check "backup reminder shown" "$(( $? == 0 ))"
shot distress-on

# a correct finger in distress mode just unlocks, nothing wiped
home; launch; sleep 2
wait_for 'Unlock SoulSync' 8
has 'Use PIN|USE PIN'; check "distress prompt offers no PIN" "$(( $? != 0 ))"
shot distress-prompt
finger 1; sleep 3
has 'resource-id="app-lock-screen"'; check "distress mode: owner finger unlocks" "$(( $? != 0 ))"
adb shell am force-stop "$PKG"; sleep 1
pull_db
[[ "$(sql 'SELECT COUNT(*) FROM entries WHERE notes IS NOT NULL AND notes <> ""')" == "$BEFORE_NOTES" ]]
check "owner unlock wiped nothing" "$(( $? == 0 ))"

# ── 7. coercion: wrong finger until lockout ──────────────────────────────────
launch; sleep 4
wait_for 'Unlock SoulSync' 8
for k in 1 2 3 4 5 6; do finger 2; sleep 1.5; done
sleep 6
shot after-wrong-fingers
wait_for 'Too many attempts' 10; check "lock screen shows plain 'too many attempts'" "$(( $? == 0 ))"
has 'wip|eras|delet|distress'; check "lock screen says nothing about a wipe" "$(( $? != 0 ))"
sleep 8
# the coercer is let in with the PIN
tap_id app-lock-unlock; sleep 3
shot after-wipe-prompt
if tap_text 'Use PIN|USE PIN'; then sleep 2; fi
enter_pin; sleep 4
has 'resource-id="app-lock-screen"'; check "after the wipe the PIN unlocks" "$(( $? != 0 ))"
tap_id tab-timeline; sleep 3
shot timeline-after-wipe
has 'E2E SECRET NOTE'; check "secret note not on the Timeline" "$(( $? != 0 ))"
tap_id tab-settings; sleep 2
scroll_to_id distress-wipe-switch
[[ "$(node_attr distress-wipe-switch checked)" == "false" ]]; check "distress option switched itself off" "$(( $? == 0 ))"
shot settings-after-wipe

# ── 8. the database after the wipe ───────────────────────────────────────────
adb shell am force-stop "$PKG"; sleep 1
pull_db
AFTER_ENTRIES="$(sql 'SELECT COUNT(*) FROM entries WHERE deleted_at IS NULL')"
AFTER_MOODS="$(sql 'SELECT group_concat(id || ":" || mood, ",") FROM (SELECT id, mood FROM entries WHERE deleted_at IS NULL ORDER BY id)')"
AFTER_NOTES="$(sql 'SELECT COUNT(*) FROM entries WHERE notes IS NOT NULL')"
AFTER_LINKS="$(sql 'SELECT COUNT(*) FROM entry_activities')"
check "every entry kept" "$(( AFTER_ENTRIES == BEFORE_ENTRIES ))" "$BEFORE_ENTRIES -> $AFTER_ENTRIES"
[[ "$AFTER_MOODS" == "$BEFORE_MOODS" ]]; check "every mood score unchanged" "$(( $? == 0 ))"
check "all notes cleared" "$(( AFTER_NOTES == 0 ))" "notes=$AFTER_NOTES"
check "default activity links kept" "$(( AFTER_LINKS == BEFORE_DEFAULT_LINKS && AFTER_LINKS > 0 ))" "$BEFORE_DEFAULT_LINKS -> $AFTER_LINKS"
[[ "$(sql "SELECT COUNT(*) FROM activities WHERE name='Panic attack'")" == 0 ]]; check "custom activity removed" "$(( $? == 0 ))"
[[ "$(sql "SELECT COUNT(*) FROM activity_groups WHERE name='Therapy'")" == 0 ]]; check "custom group removed" "$(( $? == 0 ))"
[[ "$(sql 'SELECT COUNT(*) FROM entry_media')" == 0 ]]; check "photo rows removed" "$(( $? == 0 ))"
adb shell ls "$PHOTO" >/dev/null 2>&1; check "photo file deleted" "$(( $? != 0 ))"
[[ "$(sql 'SELECT COUNT(*) FROM entries WHERE starred_at IS NOT NULL')" == 0 ]]; check "stars removed" "$(( $? == 0 ))"
[[ "$(sql 'SELECT COUNT(*) FROM health_metrics')" == 0 ]]; check "health data removed" "$(( $? == 0 ))"
[[ "$(sql "SELECT value FROM user_settings WHERE key='health_connect_opt_in'")" == false ]]; check "health sync off" "$(( $? == 0 ))"
[[ "$(sql "SELECT value FROM user_settings WHERE key='app_lock_enabled'")" == true ]]; check "app lock still on" "$(( $? == 0 ))"
adb shell cat "$DBDIR/moodTracker.db" "$DBDIR/moodTracker.db-wal" 2>/dev/null | grep -c 'E2E SECRET NOTE' >"$OUT/db/raw-grep.txt"
check "secret note not recoverable from the raw DB file" "$(( $(cat "$OUT/db/raw-grep.txt") == 0 ))"

# ── 9. turning the lock off releases it ───────────────────────────────────────
launch; sleep 3
wait_for 'Unlock SoulSync' 8
finger 1; sleep 3
tap_id tab-settings; sleep 2
scroll_to_id app-lock-switch
tap_id app-lock-switch; sleep 2
home; launch; sleep 3
has 'resource-id="app-lock-screen"'; check "lock off again: reopen goes straight in" "$(( $? != 0 ))"
shot final

grep -E '\[distress\]|FATAL EXCEPTION|ReactNativeJS.*Error' "$OUT/logcat.txt" >"$OUT/logcat-errors.txt" 2>/dev/null || true
{
  echo "| check | result | detail |"
  echo "|---|---|---|"
  printf '%s\n' "${CHECKS[@]}"
} >"$SUMMARY"
cat "$SUMMARY"
if (( NFAIL == 0 )); then kv RESULT pass; exit 0; fi
kv RESULT fail; kv REASON "$NFAIL checks failed"; exit 1
