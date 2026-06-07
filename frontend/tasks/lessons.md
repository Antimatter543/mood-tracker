# SoulSync — Project Lessons

## Empty-database (fresh-install) crash: heatmap NULL date -> RangeError (2026-06-07)

**Symptom**: On a fresh/empty `entries` table (every new user before their first
entry), the **Statistics** screen white-screened with
`RangeError: Date value out of bounds`, pinned to `CustomHeatmap`.

**Root cause**: `CustomHeatMap.tsx`'s SQL is the ONLY visualisation query that
seeds its date axis from `(SELECT MIN(date) FROM all_entries)`. On an empty
table MIN(date) is NULL, so `start_date` is NULL and the query returns a single
row `{date: null}`. `buildHeatmapGrid` had an empty-array guard but not a
null-date-row guard (`rows.length === 1`), so `addDaysUTC(null, ...)` ran
`new Date("nullT00:00:00Z").toISOString()` which throws. Unhandled in render ->
whole Stats screen unmounts to white.

**Rule**:
1. Any SQL that derives a date axis from `MIN/MAX(date)` (not JS-supplied
   `BETWEEN ?start AND ?end` bounds) MUST filter out null/invalid-date rows in
   the component before handing them to a transform: `results.filter(r => r.date)`.
2. A pure date transform must NEVER throw on degenerate input. Validate dates
   with a `^\d{4}-\d{2}-\d{2}$` regex at the top and early-return the empty
   shape if nothing valid remains. An empty-array guard is NOT enough — a single
   `{date: null}` row passes a length check.
3. Audit the WHOLE empty-db class at once, not one rebuild at a time. The other
   charts were already safe BECAUSE they filter by JS-supplied window bounds
   (empty db -> `[]`, handled by transform empty-guards) or read a null-coalesced
   scalar aggregate (`avg_mood: NULL, count: 0`, div-by-zero guarded). The
   `MIN(date)`-seeded query was the structural outlier.

**Verifying empty-db on-device**: `adb uninstall com.raeduslabs.soulsync` gives
a guaranteed-empty db (wipes app data; EAS keystore differs from dev keystore so
uninstall is needed anyway). Dev build: load the bundle via a deep link, NOT by
tapping the dev-launcher row (synthetic taps on that list are unreliable):
`adb shell am start -a android.intent.action.VIEW -d "myapp://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081"`
(scheme is `myapp`), then tap "Continue" to dismiss the first-launch dev menu.
Maestro `assertVisible "Overview"` on the Stats tab is the decisive empty-db
check (if the heatmap threw, StatisticsContent unmounts and the assert fails).
Flows: `.maestro/empty-db-verify.yaml` (dev, already-loaded) and
`.maestro/release-empty-verify.yaml` (release, standalone `launchApp`).

**Date**: 2026-06-07

## Fabric / new-architecture transparent `<Modal>` flex-collapse on Android (2026-06-07)

**Symptom**: A transparent `<Modal>` (e.g. the FAB entry form) opens but renders
BLANK — only intrinsic-height children (close button) paint; the `flex: 1` content
tree collapses to zero height. No JS error. BACK dismisses the invisible modal.
uiautomator shows the content ViewGroup at `Rect(0,77 - 0,77)`.

**Root cause**: On RN 0.76 Android new architecture (`newArchEnabled: true`, Fabric),
a transparent `<Modal>`'s host window does not give its child Fabric ShadowTree a
measured height on first mount. A root content view styled `flex: 1` therefore
resolves to height 0 and collapses all flex children. Documented in expo/expo#34470,
facebook/react-native#49717 / #50442, gorhom/bottom-sheet#2167. Only surfaced because
this was the app's first new-arch NATIVE build — Expo Go runs the old architecture, so
it never reproduced there.

**Rule / fix**: The root content `<View>` of every transparent `<Modal>` MUST have
EXPLICIT dimensions (`width`/`height` from `Dimensions.get('window')`), never bare
`flex: 1`. Inner `flex: 1` children are fine once the root has a concrete size. Also
add `statusBarTranslucent` so the explicit height covers the full window incl. status
bar. `statusBarTranslucent` ALONE does NOT fix flex-collapse — explicit sizing is the
load-bearing change.

Applied to: EntryForm.tsx, ActivityEditModal.tsx, SettingRow.tsx (select overlay),
DBViewer.tsx (PhotoViewer), IconPicker.tsx (opaque/slide — hardened for consistency,
less affected since opaque modals get a measured native window).

Note: DBViewer.tsx has dead `modalContainer`/`modalContent` styles (~lines 142-214)
not referenced in JSX — only `viewerStyles.overlay` is used. Left untouched.

**If you add a new `<Modal transparent>`**: size its root view to the window, don't
use `flex: 1`.

## Synthetic touch CANNOT drive an open `<Modal>` on RN 0.76 new arch (2026-06-07)

While verifying the modal fix on-device, neither `adb input tap`/`swipe`/`motionevent`
NOR Maestro/uiautomator could drive any control INSIDE an open `<Modal>` (Continue,
close X, mood numbers all inert). Every in-modal tap logs:
`E unknown:ReactNative: Got DOWN touch before receiving UP or CANCEL from last gesture`
The modal renders fully (proven by screenshot) and its window is focused
(`mCurrentFocus` = the modal's APPLICATION window per `dumpsys window`), but RN's
JSTouchDispatcher for the modal's second React root only ever sees DOWN, never UP, so
it stays frozen. This is a SYNTHETIC-INJECTION limitation (`InjectInputEvent` delivers
DOWN+UP across the just-created modal window and the UP is lost/transferred), NOT a
real-finger bug and NOT introduced by the flex fix (FAB/input code untouched).
Confirmed orthogonal: reverting reanimated FAB, deferring open (rAF / 150ms setTimeout),
GestureHandlerRootView, opaque modal, and uiautomator dumps (6 empty nodes while modal
open) all reproduce it. Detox has the same class of issue ("tap() freezes while a
system modal is open, disable synchronization"). Refs: facebook/react-native#36452,
#30080; gorhom/bottom-sheet#2167.

**Consequence for QA**: Maestro CANNOT auto-assert in-modal beats on this app
(`assertVisible "How were you?"` fails because uiautomator can't read the modal tree;
in-modal `tapOn` does nothing). Verify modal flows by SCREENSHOT + a REAL finger tap,
not by Maestro/adb taps. The modal RENDERING is the part to assert via screenshot.

## Device QA
- Verify modal/UI flows with Maestro (`.maestro/soulsync-tour.yaml`), NOT blind adb taps:
  RN/Fabric doesn't expose tab text and the FAB only responds via its
  accessibilityLabel ("Add mood entry"). Run maestro from ~/Pictures/screenshots so
  `takeScreenshot` PNGs land there. Tabs are tapped by `point: X%, 89%`
  (Home 10 / Stats 30 / Timeline 50 / Insights 70 / Settings 90).
- Build incremental new-arch dev build:
  `export ANDROID_HOME=/home/astraedus/Android/Sdk && npx expo run:android`
  (android/ is prebuilt). Ensure `adb reverse tcp:8081 tcp:8081`. Device 192.168.1.68:5555, PIN 1337.
