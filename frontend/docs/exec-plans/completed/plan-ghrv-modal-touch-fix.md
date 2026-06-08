# Plan: GestureHandlerRootView modal-touch fix (v1.2.2)

## Goal
Fix the dead "add mood" entry modal (no scroll, no tap, no Continue) by adding the
missing GestureHandlerRootView root + wrapping every native `<Modal>`'s content.

## Root cause
`react-native-gesture-handler@2.20.2` is installed (transitive via react-navigation /
react-native-screens) but there is NO `GestureHandlerRootView` anywhere in app/ or
components/. RN `<Modal>` renders in a SEPARATE native window outside the app's gesture
root, so on the new architecture (Fabric) touch/scroll delivery inside the modal dies.
This is the documented RNGH "modal needs its own GestureHandlerRootView" gotcha and
matches the earlier logcat "Got DOWN touch before receiving UP or CANCEL" stuck dispatcher
(wrongly dismissed as an automation artifact -- a real finger also can't interact).

## Steps
- [ ] Root GHRV in app/_layout.tsx wrapping <Stack>
- [ ] Wrap EntryFormModal content (EntryForm.tsx)
- [ ] Wrap SettingRow select modal
- [ ] Wrap ActivityEditModal
- [ ] Wrap IconPicker modal
- [ ] Wrap DBViewer PhotoViewer modal
- [ ] Wrap ActivitySelector AddActivityModal + AddGroupModal
- [ ] tsc + eslint + jest green
- [ ] On-device: build dev, seed data, open modal, `adb input tap` Continue -> step 2 advances
- [ ] On-device: swipe mood numbers -> "Selected: N" changes
- [ ] Ship v1.2.2 via scripts/release.sh patch

## Decisions made
- GHRV must have real height: use `style={{ flex: 1 }}` (the modalContainer keeps its own
  explicit window Dimensions INSIDE the GHRV -- both layers coexist fine; flex:1 on GHRV
  gives the modal window a measured height, the inner explicit dims survive the prior
  flex-collapse gotcha).
- GHRV is the OUTERMOST child inside each <Modal>.
- DateTimePicker (SettingRow) is a native picker, not a <Modal>, so not wrapped.
