# Pixel release pass: the fixed checklist

This is the L6 layer from `frontend/docs/TESTING.md`. It runs once per release on the Pixel 3, from this file, and it is the same list every time. Give the `device-tester` agent this file as its brief instead of writing a new prose walk.

It holds only what an emulator or jest cannot do. If a case here could be a cheaper test, write that test and delete the case (see "A bug found on a device also gets a cheaper test" in TESTING.md). Everything else is covered earlier: tab navigation, entry add, delete and undo, the bin overlay and seed data run in the CI emulator smoke (`.github/workflows/e2e.yml`).

The 2026-11-05 pass (`~/Pictures/screenshots/soulsync-release-2026-11-04/RESULTS.md`) showed why the list is fixed: it was a long free-form walk and several cases (K2, K3, K5-light) were NOT RUN for lack of time. Run the cases below in order of risk, and record NOT RUN as a verdict, not silence.

## Setup (every pass)

- Device: Pixel 3 over adb-tls. `adb devices` shows the current address; the port rotates. App id `com.raeduslabs.soulsyncapp`. Unlock with `~/bin/astra-pixel-unlock.sh`.
- Build under test: the signed release APK from CI (`gh workflow run release-apk.yml -R Antimatter543/mood-tracker --ref <branch>`, or the `main-latest` prerelease, or the tagged release). Never the QA APK: it is x86_64 only (`e2e.yml`) and will not run on the Pixel.
- Sideload: `adb shell settings put global verifier_verify_adb_installs 0`, then `adb install -r -g <apk>`.
- Before anything else, check the signer: `apksigner verify --print-certs <apk>` must show SHA-256 `DB:32:8A:E9:F4:88:16:44:BE:0D:40:30:21:2E:2E:65:09:38:78:F3:5E:71:9D:9D:62:E2:9B:06:3C:4E:02:AB`. A different cert cannot update over an installed release.
- Evidence directory: `~/Pictures/screenshots/soulsync-release-<YYYY-MM-DD>/`. Write each verdict to `RESULTS.md` there the moment you decide it, as `case | PASS/FAIL/BLOCKED/NOT RUN | screenshot | note`. Build the final report from that file. Why: a long run compacts context and the summary drops verdicts.
- Crash sweep over the whole pass (case S1): at the end run `adb logcat -d` and `adb shell dumpsys dropbox --print` and grep for `FATAL`, `Fatal signal`, `JavascriptException`, `shared object`, `NativeStatement`, `SQLiteProvider`, `ANR`, and for dropbox entries mentioning soulsync. Pass: zero matches. Save the output as `s1-crash-sweep.txt`.

## Cases

### HC. Health Connect
Needs the Health Connect app and real sleep and heart-rate data, which no emulator in CI has.

1. Settings, find the "Health Connect" card. If the Health Connect app is missing the card offers "Install Health Connect". Otherwise tap "Connect Health Connect" and grant the permissions in the system sheet.
2. Tap "Sync now". Open Insights and Statistics.
3. Back in Settings, tap "Turn off & delete data" and confirm.

Pass: the card shows "Connected" after step 1; step 2 draws sleep and heart-rate charts from the data that exists in Health Connect; step 3 clears the health charts on Statistics and Insights and the card returns to the unconnected state. Record whether the build was the GitHub APK or the Play build. Evidence: `hc-connected.png`, `hc-insights.png`, `hc-disconnected.png`. Why: both builds ship HC (the `EXPO_PUBLIC_HEALTH_CONNECT` knob is '1' in `release-apk.yml`); `playVariantBundleGuard.test.ts` proves the bundle, not the permission flow.

### NT. Notification delivery timing
1. Settings, Reminders, "Add reminder", set a time 3 minutes ahead, save. Grant the notification permission if asked.
2. Lock the screen and swipe the app out of recents.
3. Wait for the time.

Pass: the notification arrives within 60 seconds of the set time, with the app closed. Evidence: `nt-set.png` and `nt-delivered.png` (the shade, showing the clock). If the note "Notifications are blocked for SoulSync" shows in Reminders, the permission was denied: record BLOCKED, not FAIL. Why: delivery depends on the OS scheduler and battery policy on real hardware; jest tests the trigger calculation (`lib/notifications.ts`) only.

### FL. Timeline fling and scroll on the Pixel 3 (#15)
1. On the release APK, Settings, "Restore" a long history made with `cd frontend && node scripts/make-demo-data.js --days 300 > /tmp/soulsync-demo.json` and `adb push` to `/sdcard/Download/`. (The "Generate 300 Timeline QA Entries" button is `__DEV__` only and does not exist in a release build.)
2. `adb shell dumpsys gfxinfo com.raeduslabs.soulsyncapp reset`.
3. From `~/Pictures/screenshots`, run `~/.maestro/bin/maestro test <repo>/frontend/.maestro/timeline-fling.yaml`.
4. Run `adb shell dumpsys gfxinfo com.raeduslabs.soulsyncapp` and read "Janky frames".

Pass: in the flow's screenshots the pinned day header gets OLDER in each successive shot (never snaps back to Today or a more recent day), and no blank gap lingers. Record the Janky frames percentage in the note; there is no threshold yet, so the first pass sets the baseline. Evidence: the `timeline-fling-*` screenshots and `fl-gfxinfo.txt`. Why: FlashList cost and the teleport bug (cc83830, #15) depend on real frame timing; the emulator cannot give a Pixel 3 number.

### UP. Play-variant install and update path, data survival
1. Install the previous release over a clean device (`adb uninstall com.raeduslabs.soulsyncapp` first, then install). Add 3 entries, one with a distinctive note. Turn on backup encryption and take a backup (Settings, Data Management, "Back up"). Note the version from Settings.
2. Install the candidate over it with `adb install -r -g <candidate.apk>`. Do not clear data.
3. Open the app. Check the entries, the note, the encryption setting and Settings, Data Management, "Technical details".
4. Play build: after `publish-on-tag.sh` has put the release on Play, update the Pixel's Play-installed copy from the Play Store (not adb) and repeat step 3.

Pass: the install succeeds without an uninstall; all 3 entries and the note are present; encryption is still on with the same strength; no crash on first open. Step 4 is NOT RUN, with the reason, if Play has not published yet. Evidence: `up-before.png`, `up-after.png`, `up-tech.png`. Why: only a real signed install over real data proves the migration path and the cert; this is where a data-loss bug does the most harm. (A same-versionCode candidate over its twin, as on 2026-11-05, proves the install only; say so in the note.)

### BK. Backup restore across versions on real hardware
1. Take an encrypted backup with the PREVIOUS release (step UP.1) and keep the file.
2. On the candidate, clear the app data (`adb shell pm clear com.raeduslabs.soulsyncapp`), Settings, "Restore", pick the file. Enter a wrong password first, then the right one.
3. Choose a heavy setting once: Settings, Data Management, "Technical details", Manual, 1024 MiB, back up, `pm clear`, restore that file.

Pass: the wrong password shows "Wrong password, or the backup file is damaged." and re-asks, with data unchanged; the right password restores all entries including the distinctive note; the heavy restore finishes without ANR or crash, the process stays alive, and the data is intact. Record how long the heavy restore took (about 50 seconds on 2026-11-05). Evidence: `bk-wrong.png`, `bk-restored.png`, `bk-heavy-end.png`. Why: Argon2 runs natively and is mocked in jest (`__mocks__/expo-argon2.ts`), and the heavy derivation used about 1 GiB of native heap on the Pixel 3 on 2026-11-05 while the system killed other apps. Getting the backup file off the device is the slow part: the share sheet has no "save to Downloads", so on 2026-11-05 it went through a Drive upload and download. Getting a file onto the device is easy: `adb push <file> /sdcard/Download/`.

### OV. Real-finger touch on new overlays
List the overlays added or changed since the last release (`git log --oneline <last-tag>..HEAD -- frontend/components`, and anything using `OverlayModal` or `useOverlay`). For each one:

1. Open it with a real finger. No `adb input`, no Maestro.
2. Tap every control, scroll inside it if it scrolls, and dismiss it.
3. For anything with an enter animation or a snackbar action (UNDO), tap it as soon as it appears.

Pass: every control responds on the first tap, and the overlay dismisses. No new overlays this release: record NOT APPLICABLE with the commit range. Evidence: one screenshot per overlay and a line per control in RESULTS.md. Why: reanimated entering animations have broken Fabric hit-testing twice (800789a dead Undo on the bin, 06df84b the snackbar's UNDO), and the CI emulator taps synthetically.

The calendar's day summary card is always on this list, because no golden opens it and jest cannot see its layout (#43). On Statistics, tap a day with 1 entry: the row shows in full. Tap a day with 5 entries: part of row 4 shows, a swipe scrolls the list both from on a row and from a gap between rows, and the X still closes the card.

## Not on this list, on purpose

- "Reset Database" is `__DEV__` only and does not exist in a release APK; the 2026-11-05 pass could not run it (case R1). Do not list it as a release case.
- Cold-start crash rounds and Maestro walks of tabs and entries run in CI (`e2e.yml`).
- Theme readability: not covered by any case above. If the release changed theme tokens or dialogs, check one dark and one light theme by eye and record both (2026-11-05 ran dark only, K5-light NOT RUN).

## Handback

Return the report built from `RESULTS.md`: one line per case above, the build (versionName, versionCode, sha), and the crash sweep result. A FAIL is a bug: file it with the evidence, then add the cheaper test per TESTING.md before the fix merges.
