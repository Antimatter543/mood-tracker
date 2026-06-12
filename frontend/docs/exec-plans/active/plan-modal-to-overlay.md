# Plan: Replace native `<Modal>` with in-tree overlay (fix dead touch dispatch)

## Goal
The "add mood" entry form's mood picker (and Continue/Submit) is dead under a real
finger. Root cause: native `<Modal>` on RN 0.76 Fabric/new-arch has broken touch
dispatch into its second native window. Replace the Modal with an in-tree, full-window
overlay so touch routing stays in the single React/Fabric root.

## Architecture decision (already made by CEO — implement, don't relitigate)
- Add a **context-based overlay host** at the root layout (`app/_layout.tsx`). Any
  component calls `useOverlay()` to mount full-window content as the LAST child of the
  root view (z-above the `<Tabs>` chrome incl. the floating tab bar). One mechanism
  serves every caller (altitude: generalize, don't special-case).
- `EntryFormModal` keeps its exact public API (`visible/onClose/onSubmit/initialData`)
  so callers (AddEntryButton, DBViewer) don't change. Internally it renders through the
  overlay host instead of `<Modal>`.
- Same mechanism converts the Settings theme `<Modal>` dropdown (SettingRow.tsx), which
  has the identical dead-touch pathology.

## Steps
- [ ] Create `OverlayHost` context + provider + `<View>` portal slot in `app/_layout.tsx`.
- [ ] Rewrite `EntryFormModal` to render through the overlay host (no `<Modal>`,
      no inner `GestureHandlerRootView`). Android hardware-back closes while visible
      (`BackHandler`). Fade-in via Reanimated. Full-window via `StyleSheet.absoluteFill`.
- [ ] `MoodSelector.tsx`: add `nestedScrollEnabled` to the horizontal ScrollView.
- [ ] Convert SettingRow.tsx select dropdown to the overlay host (verify on device too).
- [ ] `npm run check` (tsc + lint + jest) green.
- [ ] Device-verify the add-entry flow end-to-end via Metro (dev-client installed):
      FAB -> swipe picker (Selected: N CHANGES) -> Continue -> activity -> Submit ->
      entry on Home. Screenshot each beat.
- [ ] Convert other dead `<Modal>`s if the overlay proves out (ActivityEditModal,
      ActivitySelector add/group, IconPicker, DBViewer photo viewer).
- [ ] Update lessons.md + CLAUDE.md (old "synthetic-taps-can't-drive-modals" doctrine is
      WRONG) + CHANGELOG.md.
- [ ] `scripts/release.sh patch` -> v1.2.3, install release APK, re-verify on device.

## Decisions made
- Overlay host at root (not local to the FAB) because the FAB lives inside
  `PageContainer` -> a tab screen, which sits BEHIND the floating tab bar in z-order;
  an overlay rendered there would be clipped / under the tab bar. Root host is the only
  location that reliably covers the whole window including tab-bar chrome.
- `expo-updates` is NOT installed, so OTA `eas update` is unavailable. Dev iteration via
  Metro against the already-installed dev-client; final verification on a release APK.
