# Plan: QoL batch v2.1.0 (4 user-reported items)

Branch `qol/v2.1.0` off main @ f488cf2. One commit per item, conventional messages.
Gates: `npx tsc --noEmit` (0 err) + `npx jest` (>=348 green). No native builds. No app.json version bump.

## Verified facts (from node_modules / repo)
- **Overlay system**: `context/OverlayHost.tsx` `useOverlay().mount(node) -> {update, unmount}`.
  Mounts each entry full-window (`absoluteFill`, `pointerEvents="box-none"`). `OverlayModal` is the
  dialog/fullScreen wrapper. NEVER native Modal.
- **Item 3 ROOT CAUSE CONFIRMED**: `node_modules/expo-router/build/react-navigation/bottom-tabs/types.d.ts:212`
  declares `sceneStyle?: StyleProp<ViewStyle>` ("Style object for the component wrapping the screen
  content"). There is ZERO `sceneContainerStyle` anywhere in expo-router/build. So the current
  `sceneContainerStyle` screenOption (line 134) is silently dead since SDK 56 — react-navigation v7
  renamed it `sceneStyle`. tsc didn't catch it because `screenOptions` is a plain object (no excess-prop
  check). Fix = rename to `sceneStyle`, keep SystemUI call, wrap Tabs in a flex:1 themed View (belt+braces).
- **Item 4 data layer**: `databases/activities.ts::updateActivityPositions(db, Activity[])` reassigns
  `position = index+1` in a txn. Re-exported via `databases/database`. `Activity` has `position:number`,
  `group_id:number`. No schema change.
- **Item 4 nesting risk**: `ActivitySelector` has its OWN vertical `ScrollView` (line 773) nested inside
  `EntryForm`'s vertical `ScrollView` (line 409). Sortable lib must integrate with a scrollable ref or
  long-press drag may fight the scroll. Wire `scrollableRef` per the lib docs.
- Tests centralized in `__tests__/`, jest-expo preset, RNTL 14 (ASYNC render/renderHook). 5 themes in
  `styles/global.ts` (dark #141418, light, cherry, midnight, forest).

## Steps
- [x] Item 1: `OverlayPopover` component + convert group "..." menu to it (measure-in-window + clamp).
      Remove dead `menuOverlay` style + zIndex juggling. RNTL test for dismiss-on-outside-tap. (ebebb9e)
- [x] Item 2: enlarge Edit-activity modal (94%/520/85%). IconPicker grid already full-screen+flexible,
      no change needed there. (0c7598b)
- [x] Item 3: rename `sceneContainerStyle` -> `sceneStyle` (confirmed dead via node_modules types +
      screenOptions does NO excess-prop check, so tsc never caught it); keep SystemUI; wrap Tabs in
      themed flex:1 View. (9097ee6)
- [x] Item 4: installed `react-native-sortables@1.9.4` (exact); wrapped per-group chip list in
      `Sortable.Grid` (columns=5, dragActivationDelay=300, fail-offset default 5 so tap/scroll don't
      drag); tap still toggles via ActivityItem.onPress; onDragEnd -> onReorderActivities ->
      updateActivityPositions + reload; scrollableRef threaded from EntryForm's Animated.ScrollView.

## RISK for device QA
- **Long-press collision (PRIMARY)**: drag now activates on long-press (300ms). The chip's existing
  `onLongPress` -> edit-activity modal (500ms) will likely be SHADOWED by the drag gesture, so
  hold-to-edit a single activity may stop working. Edit is otherwise only reachable via that long-press
  (the "..." menu has Add/Reorder/Delete-group, not per-activity edit). If device QA confirms edit is
  lost, options: gate drag behind the existing "Reorder Activities" mode, or add an explicit edit
  affordance. InfoBubble copy ("Hold an activity to edit") may need updating.
- **Nested ScrollViews**: ActivitySelector's own ScrollView is nested in EntryForm's ScrollView. Drag +
  auto-scroll wired to the OUTER (form) ScrollView (the one that actually scrolls). Within-group grids
  are small (1-3 rows) so auto-scroll is an edge nicety; the within-grid drag itself is the main path.

## Decisions made
- Item 1: add a dedicated lightweight `OverlayPopover` (NOT reuse OverlayModal's centered dialog) — a popover
  needs free absolute positioning adjacent to an anchor, which the centered-card machinery can't express.
  Keep it in the overlay architecture (renders THROUGH `useOverlay`). Rationale: consistent + dismiss-anywhere
  comes for free from a full-window transparent backdrop Pressable.
