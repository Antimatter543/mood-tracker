# Plan: qol/v2.1.0 device-QA fix batch (edit modal width + button labels + hub refresh)

## Goal
Fix the three device-QA bugs on the Edit Activity flow: modal renders ~49% width,
Delete/Update labels truncate, and the "Edit Activities" hub shows a stale name after Update.

## Root causes
- **BUG 1 (width)**: `OverlayModal` dialog variant nests `modalContent` (`width:'94%'`)
  inside a *bare* inner `<Pressable onPress={()=>{}}>` (no width/flex) whose parent
  `backdrop` Pressable has `alignItems:'center'`. Under center-alignment a styleless
  child shrink-wraps to its content; the card's `94%` then resolves against that
  shrink-wrapped width, not the screen — Yoga settles at ~49%. Fix lives in
  `OverlayModal.tsx`: give the inner Pressable `alignSelf:'stretch'` (+ horizontal
  padding for tablet margin) so it spans the full backdrop width; the card's `%` then
  resolves against the real screen width and centers inside it. Fixes all 3 dialog
  consumers (edit, add-activity, add-group) at once; fullScreen variant untouched;
  SettingRow uses its OWN backdrop/inner-Pressable pair (not OverlayModal) so unaffected.
- **BUG 2 (truncated labels)**: a side effect of BUG 1 (each `button` is `flex:1` of a
  49%-wide row). Real row width restores them. Add a `minWidth` floor + remove any
  truncation risk so labels never clip even at large font scale.
- **BUG 3 (stale hub name)**: `ActivityReorder` seeds `useState([...activities])` ONCE at
  mount. After modal Update/Delete, `ActivitySelector.loadActivities()` updates the
  `activities` PROP, but the hub never re-syncs its snapshot. Chips update (they read the
  live `activities` state); the hub doesn't. Fix: re-seed `reorderedActivities` from the
  `activities` prop whenever its content changes (the app's existing prop->state sync
  idiom), so Update and Delete both refresh the hub row in place.

## Steps
- [ ] BUG 1: OverlayModal inner Pressable `alignSelf:'stretch'` + side padding; keep card %s
- [ ] BUG 1: cap ActivityEditModal card maxWidth ~560 (tablets)
- [ ] BUG 2: give edit-modal buttons a minWidth floor; verify labels full
- [ ] BUG 3: re-seed ActivityReorder local state from prop on content change
- [ ] Extend activityReorder.test.tsx: hub re-renders when activities prop changes
- [ ] Gates: tsc --noEmit, jest (358), eslint changed files
- [ ] Live Expo Go verify on Pixel: card >=90% width, labels full, hub refresh on Update+Delete
- [ ] One conventional commit on qol/v2.1.0, push origin

## Decisions made
- Fix BUG 1 in OverlayModal (shared) not per-consumer: it's the actual broken node and
  every dialog consumer inherits the fix; `alignSelf:'stretch'` is the minimal change that
  preserves each card's own width/maxWidth/centering.
- BUG 3 via prop->state re-seed (not lifting state up): least-invasive, matches the
  ActivityEditModal prop-sync idiom; persisted reorder flows back through the same path.
