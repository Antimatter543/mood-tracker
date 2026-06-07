# Plan: Fix Fabric transparent-Modal flex-collapse on Android (new arch)

## Goal
Make all transparent `<Modal>` content render on Android new-arch (RN 0.76 / Fabric);
the entry-form modal currently renders blank because its `flex: 1` content tree
collapses to zero height under an unmeasured Modal host view.

## Root cause
On RN 0.76 Android new architecture, a transparent `<Modal>`'s host window does not
hand a measured height to its child Fabric ShadowTree on first mount. A root content
view styled `flex: 1` therefore resolves to height 0, collapsing all flex children
(the form body) while intrinsic-height children (header/close button) still paint.
This is a documented Fabric issue (expo/expo#34470, facebook/react-native#49717/#50442,
gorhom/bottom-sheet#2167). Surfaced now because this is the app's first new-arch
native build (previously Expo Go = old arch).

## Fix (minimal, documented)
Give each transparent Modal's ROOT content view explicit window dimensions
(`Dimensions.get('window')` width/height) instead of relying on `flex: 1` to fill an
unmeasured host. Add `statusBarTranslucent` on the full-screen modals so the explicit
height covers the full window incl. status bar. Inner `flex: 1` children are fine once
the root has a concrete size.

## Files (transparent Modals with flex-collapse risk)
- [x] components/forms/EntryForm.tsx      — `modalContainer` flex:1 (THE reported bug)
- [x] components/forms/ActivityEditModal.tsx — `modalContainer` flex:1 (centered overlay)
- [x] components/SettingRow.tsx            — `modalContainer` flex:1 (centered select overlay)
- [x] components/DBViewer.tsx              — `viewerStyles.overlay` flex:1 (photo viewer)
- [ ] components/IconPicker.tsx            — Modal is NOT transparent (slide); opaque
      window gets real bounds. Hardened anyway with explicit height for safety.
- DBViewer.tsx modalContainer/modalContent styles (lines ~142-214) are DEAD CODE
  (only `viewerStyles.overlay` is used in JSX) — left untouched, out of scope.

## Cosmetic (trivial)
- [x] app/(tabs)/index.tsx TodaysMoodCard — no-entry state shows 64px bold "--" in
      accent green (reads as two green bars). Render a clear no-entry state instead.

## Verify
- [ ] `npx expo run:android` incremental, on Pixel 3 (192.168.1.68:5555)
- [ ] Maestro `.maestro/soulsync-tour.yaml` entry+photo beats PASS
- [ ] `npx tsc --noEmit` clean
- [ ] `npx jest` green (333 baseline)

## Decisions made
- Explicit dimensions is the load-bearing fix for flex-collapse: rendering confirmed
  fixed on-device (full modal content paints).
- REMOVED `statusBarTranslucent`: first build kept it; the rendered modal painted
  correctly but synthetic `adb`/uiautomator touches did not reach ANY in-modal
  control (Continue, close X, mood numbers all inert) while the modal window was
  focused (`mCurrentFocus` = the transparent APPLICATION window per `dumpsys window`).
  statusBarTranslucent changes the modal window flags/touch region; stripping it back
  to the minimal documented fix (explicit dimensions only) is the right call and
  avoids stacking speculative props. Rebuilt to test.
- Use a shared `Dimensions.get('window')` per-component (cheap, sync) rather than a
  new util — these are leaf components and the value is read once at render.

## On-device verification notes
- Rendering fix CONFIRMED: screenshots (and Maestro's own failure-screenshot) show the
  entry modal fully rendered (title, mood selector, date, Continue) where it was
  previously blank.
- Maestro/uiautomator CANNOT see the transparent modal's view tree on RN 0.76 new arch
  (uiautomator dump returns ~6 empty nodes while the modal is open, despite full paint).
  So a text `assertVisible` inside the modal cannot pass regardless of the fix — this is
  a Maestro+Fabric a11y limitation, not a regression. Verification is by screenshot.
