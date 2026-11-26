#!/usr/bin/env bash
# e2e-app-lock.sh: device verification of the PIN app lock + distress PIN, run
# INSIDE reactivecircus/android-emulator-runner (e2e.yml, dispatch input
# `applock`). adb drives the emulator: taps on SoulSync's own number pad, a
# uiautomator dump reads the screen, and the database is pulled (adb root) and
# read with python's sqlite3 to prove what the distress PIN kept and destroyed.
#
# PINs: app 2468, distress 9999.
# NEVER run on the laptop: it drives whatever adb device is attached.
#
# Usage: frontend/scripts/e2e-app-lock.sh <qa-apk>
set -uo pipefail

APK="${1:?usage: e2e-app-lock.sh <qa-apk>}"
OUT="${E2E_OUT:-e2e-out}"
BOOT_TRIES="${BOOT_TRIES:-150}"
PKG=com.raeduslabs.soulsyncapp
APP_PIN=2468
DISTRESS_PIN=9999
mkdir -p "$OUT/screens" "$OUT/ui" "$OUT/db"
FAIL_TITLE="App lock e2e"
# shellcheck source=e2e-lib.sh
source "$(cd "$(dirname "$0")" && pwd)/e2e-lib.sh"

CHECKS=()
NFAIL=0
check() { # check <name> <0|1 ok> [detail]
  if [[ "$2" == 1 ]]; then CHECKS+=("| $1 | PASS | ${3:-} |"); log "PASS $1 ${3:-}";
  else
    CHECKS+=("| $1 | **FAIL** | ${3:-} |"); NFAIL=$((NFAIL + 1)); log "FAIL $1 ${3:-}"
    # Self-explaining failures: what was on screen (the artifact may not be at hand).
    dump
    log "  on screen: $(grep -oE '(text|resource-id)=\"[^\"]+\"' <<<"$UI" | grep -v 'resource-id="android' | head -60 | tr '\n' ' ')"
    shot "fail-$(tr -c 'a-zA-Z0-9' '-' <<<"$1" | cut -c1-40)"
  fi
}
STEP=0
shot() { STEP=$((STEP + 1)); adb exec-out screencap -p >"$OUT/screens/$(printf %02d $STEP)-$1.png" 2>/dev/null || true; }

UI=""
dump() { # refresh $UI with the current window's hierarchy (never a stale file)
  local i out
  for (( i = 0; i < 3; i++ )); do
    adb shell rm -f /sdcard/ui.xml >/dev/null 2>&1
    out="$(adb shell uiautomator dump /sdcard/ui.xml 2>&1 | tr -d '\r')"
    UI="$(adb shell cat /sdcard/ui.xml 2>/dev/null | tr -d '\r')"
    [[ "$UI" == *"<hierarchy"* ]] && return 0
    log "uiautomator dump failed (try $((i + 1))): $out"
    sleep 1
  done
  UI=""
  return 1
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
launch() { adb shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1; }
home() { adb shell input keyevent KEYCODE_HOME; sleep 2; }
# Type a PIN on SoulSync's own pad: one dump for the key positions, then taps.
type_pin() {
  local d c
  dump
  for (( i = 0; i < ${#1}; i++ )); do
    d="${1:$i:1}"
    c="$(center_of "resource-id=\"pin-key-$d\"")" || { log "no key $d on screen"; return 1; }
    # shellcheck disable=SC2086
    adb shell input tap $c
  done
  c="$(center_of 'resource-id="pin-key-ok"')" || return 1
  # shellcheck disable=SC2086
  adb shell input tap $c
}
# The lock screen as text + ids + labels (no bounds), its own subtree only: the
# app underneath stays mounted (hidden), and which screen that is must not count.
lock_screen_signature() {
  dump
  python3 -I -c '
import sys, xml.etree.ElementTree as ET
root = ET.fromstring(sys.stdin.buffer.read())
lock = next((n for n in root.iter("node") if n.get("resource-id") == "app-lock-screen"), None)
if lock is None:
    print("NO LOCK SCREEN"); sys.exit()
for n in lock.iter("node"):
    print("|".join(n.get(a, "") for a in ("resource-id", "text", "content-desc", "enabled", "clickable")))
' <<<"$UI"
}
unlock_with() { # unlock_with <pin>: from the lock screen, wait out "Unlocking…"
  wait_for 'resource-id="app-lock-screen"' 8 || return 1
  type_pin "$1"
  sleep 3
}
scroll_to_text() { # swipe up (bounded) until <regex> is on screen
  local i
  for (( i = 0; i < 10; i++ )); do has "$1" && return 0; adb shell input swipe 540 1500 540 700 400; sleep 1; done
  return 1
}
scroll_to_id() { # swipe up until <id> sits in the upper 2/3 of the screen, clear of the
  local i c y   # floating tab bar and the FAB (a tap there hits the tab bar instead)
  for (( i = 0; i < 14; i++ )); do
    if has "resource-id=\"$1\""; then
      c="$(center_of "resource-id=\"$1\"")"; y="${c#* }"
      (( y < 1400 )) && return 0
      adb shell input swipe 540 1300 540 900 600; sleep 1; continue
    fi
    adb shell input swipe 540 1600 540 700 400; sleep 1
  done
  has "resource-id=\"$1\""
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
tap_id tab-timeline; sleep 3; shot pr-timeline-before; tap_id tab-home; sleep 1
has 'resource-id="app-lock-screen"'; check "lock OFF by default: no lock screen" "$(( $? != 0 ))"
shot default-open

# ── 4. turn the lock on: choose a PIN, twice ─────────────────────────────────
tap_id tab-settings; sleep 2
scroll_to_id app-lock-switch; check "Settings shows App lock switch" "$(( $? == 0 ))"
[[ "$(node_attr app-lock-switch checked)" == "false" ]]; check "App lock switch default off" "$(( $? == 0 ))"
has 'resource-id="distress-wipe-switch"'; check "distress option hidden while lock off" "$(( $? != 0 ))"
shot settings-before
tap_id app-lock-switch
wait_for 'Choose an app PIN' 6; check "PIN setup opens" "$(( $? == 0 ))"
has 'no way to reset a forgotten PIN'; check "PIN setup says a forgotten PIN cannot be reset" "$(( $? == 0 ))"
shot pr-pin-setup
type_pin "$APP_PIN"; sleep 1
wait_for 'Enter the PIN again' 4
type_pin 1357; sleep 1
has "don't match"; check "mismatched confirmation is refused" "$(( $? == 0 ))"
type_pin "$APP_PIN"; sleep 1; type_pin "$APP_PIN"; sleep 2
[[ "$(node_attr app-lock-switch checked)" == "true" ]]; check "App lock on after choosing a PIN" "$(( $? == 0 ))"
shot settings-lock-on

# ── 5. minimise -> reopen, three times; app switch; cold start ───────────────
for n in 1 2 3; do
  home; launch; sleep 2
  wait_for 'resource-id="app-lock-screen"' 8; check "reopen #$n shows the PIN lock" "$(( $? == 0 ))"
  (( n == 1 )) && shot pr-lock-screen
  type_pin "$APP_PIN"; sleep 3
  has 'resource-id="app-lock-screen"'; check "reopen #$n: app PIN unlocks" "$(( $? != 0 ))"
done
adb shell input keyevent KEYCODE_APP_SWITCH; sleep 2
adb shell input keyevent KEYCODE_HOME; sleep 1
launch; sleep 2
wait_for 'resource-id="app-lock-screen"' 8; check "app switch + return shows the lock" "$(( $? == 0 ))"
type_pin "$APP_PIN"; sleep 3
adb shell am force-stop "$PKG"; sleep 1
launch; sleep 5
has 'resource-id="app-lock-screen"'; check "cold start shows the lock" "$(( $? == 0 ))"
type_pin "$APP_PIN"; sleep 3
has 'resource-id="app-lock-screen"'; check "cold start: app PIN unlocks" "$(( $? != 0 ))"

# wrong PINs: message, then a wait after 5
home; launch; sleep 2
wait_for 'resource-id="app-lock-screen"' 8
type_pin 1111; sleep 2
has 'Wrong PIN'; check "a wrong PIN says so and stays locked" "$(( $? == 0 ))"
for k in 2 3 4 5; do type_pin 1111; sleep 2; done
has 'Too many wrong PINs'; check "after 5 wrong PINs it makes you wait" "$(( $? == 0 ))"
shot pr-wrong-pin-wait
type_pin "$APP_PIN"; sleep 3
has 'resource-id="app-lock-screen"'; check "no PIN accepted during the wait" "$(( $? == 0 ))"
sleep 32
# The lock screen without a distress PIN, at rest (wait over, nothing typed).
SIG_NO_DISTRESS="$(lock_screen_signature | sort)"
type_pin "$APP_PIN"; sleep 3
has 'resource-id="app-lock-screen"'; check "after the wait the app PIN unlocks" "$(( $? != 0 ))"

# ── 6. set the distress PIN ──────────────────────────────────────────────────
tap_id tab-settings; sleep 2
scroll_to_id distress-wipe-switch; check "distress option shown once lock is on" "$(( $? == 0 ))"
tap_id distress-wipe-switch
wait_for 'Turn on the distress PIN' 8; check "distress confirmation shown" "$(( $? == 0 ))"
has 'Make a backup first'; check "confirmation mentions backup" "$(( $? == 0 ))"
has 'Technical details|options'; check "confirmation does not point at options" "$(( $? != 0 ))"
shot pr-confirmation
tap_text 'CHOOSE PIN|Choose PIN'
wait_for 'Choose a distress PIN' 6; check "distress PIN setup opens" "$(( $? == 0 ))"
type_pin "$APP_PIN"; sleep 2
has 'must be different'; check "the app PIN is refused as distress PIN" "$(( $? == 0 ))"
type_pin "$DISTRESS_PIN"; sleep 1; type_pin "$DISTRESS_PIN"; sleep 2
[[ "$(node_attr distress-wipe-switch checked)" == "true" ]]; check "distress PIN set" "$(( $? == 0 ))"
has 'resource-id="distress-scope"'; check "no category switches on the card (advanced only)" "$(( $? != 0 ))"
scroll_to_id distress-details-toggle && tap_id distress-details-toggle
wait_for 'resource-id="distress-details"' 6; check "technical details dialog opens" "$(( $? == 0 ))"
shot pr-technical-details
scroll_to_text 'look suspicious'; check "dialog explains why the default keeps the journal" "$(( $? == 0 ))"
shot pr-why-default
scroll_to_id distress-scope-health
[[ "$(node_attr distress-scope-health checked)" == "true" ]]; check "selection defaults to erase" "$(( $? == 0 ))"
shot pr-advanced
scroll_to_id distress-scope-entries
[[ "$(node_attr distress-scope-entries checked)" == "false" ]]; check "erasing all entries is off by default" "$(( $? == 0 ))"
[[ "$(node_attr distress-scope-defaultActivityLinks checked)" == "false" ]]; check "erasing default activities is off by default" "$(( $? == 0 ))"
scroll_to_text 'fresh install'; shot pr-advanced-end
tap_id distress-details-close; sleep 1
has 'resource-id="distress-details"'; check "dialog closes" "$(( $? != 0 ))"
scroll_to_id distress-wipe-hint; check "backup reminder shown" "$(( $? == 0 ))"
shot pr-distress-on

# ── 7. the lock screen gives nothing away; the app PIN still wipes nothing ──
home; launch; sleep 2
wait_for 'resource-id="app-lock-screen"' 8
SIG_DISTRESS="$(lock_screen_signature | sort)"
[[ "$SIG_DISTRESS" == "$SIG_NO_DISTRESS" ]]; check "lock screen identical with and without a distress PIN" "$(( $? == 0 ))"
[[ "$SIG_DISTRESS" == "$SIG_NO_DISTRESS" ]] || { diff <(echo "$SIG_NO_DISTRESS") <(echo "$SIG_DISTRESS") | head -20; }
type_pin "$APP_PIN"; sleep 3
has 'resource-id="app-lock-screen"'; check "app PIN unlocks with a distress PIN set" "$(( $? != 0 ))"
adb shell am force-stop "$PKG"; sleep 1
pull_db
[[ "$(sql 'SELECT COUNT(*) FROM entries WHERE notes IS NOT NULL AND notes <> ""')" == "$BEFORE_NOTES" ]]
check "the app PIN wiped nothing" "$(( $? == 0 ))"

# ── coercion: the distress PIN ───────────────────────────────────────────────
launch; sleep 3
wait_for 'resource-id="app-lock-screen"' 8
type_pin "$DISTRESS_PIN"
sleep 0.5; shot pr-unlocking
sleep 4
has 'resource-id="app-lock-screen"'; check "the distress PIN opens the app like the app PIN" "$(( $? != 0 ))"
has 'wip|eras|delet|distress'; check "nothing on screen mentions a wipe" "$(( $? != 0 ))"
tap_id tab-timeline; sleep 3
shot pr-timeline-after-wipe
has 'E2E SECRET NOTE'; check "secret note not on the Timeline" "$(( $? != 0 ))"
tap_id tab-settings; sleep 2
scroll_to_id distress-wipe-switch
[[ "$(node_attr distress-wipe-switch checked)" == "false" ]]; check "distress option switched itself off" "$(( $? == 0 ))"
shot settings-after-wipe
home; launch; sleep 2
wait_for 'resource-id="app-lock-screen"' 8
type_pin "$DISTRESS_PIN"; sleep 4
has 'resource-id="app-lock-screen"'; check "the used distress PIN no longer opens anything" "$(( $? == 0 ))"
type_pin "$APP_PIN"; sleep 3
has 'resource-id="app-lock-screen"'; check "the app PIN still works after the wipe" "$(( $? != 0 ))"

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

# ── 9. no way past the PIN; turning the lock off releases it ─────────────────
home; launch; sleep 2
wait_for 'resource-id="app-lock-screen"' 8
has 'forgot'; check "lock screen offers no forgot-PIN bypass" "$(( $? != 0 ))"
type_pin "$APP_PIN"; sleep 3
tap_id tab-settings; sleep 2
scroll_to_id app-lock-switch
tap_id app-lock-switch; sleep 2
[[ "$(node_attr app-lock-switch checked)" == "false" ]]; check "app lock turned off in Settings" "$(( $? == 0 ))"
home; launch; sleep 3
has 'resource-id="app-lock-screen"'; check "lock off: reopen goes straight in" "$(( $? != 0 ))"
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
