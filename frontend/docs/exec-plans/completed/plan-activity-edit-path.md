# Plan: restore the activity-edit path alongside the drag gesture

## Goal
Make the edit-activity modal reachable again after the `Sortable.Grid` drag gesture
(`dragActivationDelay=300`) started cancelling the chip Pressable's `onLongPress=500` —
without breaking tap-to-toggle or long-press-to-reorder.

## Root cause (device-confirmed)
A chip in `Sortable.Grid` can't host BOTH a long-press-to-edit (500ms) and the drag's
long-press-to-activate (300ms): the shorter timer (drag) wins and cancels the Pressable.
Hold-duration cannot discriminate edit-vs-drag on the same chip.

## Decision: explicit path through the group "..." popover (deterministic)
Drag owns reordering in the main grid. Edit gets its own door: the popover's
"Reorder Activities" item becomes "Edit Activities" and `ActivityReorder` becomes the
group's **activity-management hub** — each row is tappable (with a pencil affordance) and
opens the existing big `ActivityEditModal` (which already contains BOTH update AND delete,
so deletion stays reachable). The up/down arrows stay as an accessible reorder fallback.

## Secondary (react-native-sortables real API) — investigated, SKIPPED
`react-native-sortables@1.9.4` exports `Sortable.Touchable` (`SortableTouchable`) with
`onTap / onDoubleTap / onLongPress / onTouchesDown/Up`, `failDistance` (default 10 → tap
fails if the finger moves), `gestureMode` (`exclusive` default). Internally it composes
each gesture `simultaneousWithExternalGesture(itemDragGesture)`.
- `onLongPress` fires on a stationary hold **simultaneously** with the drag's own
  activation → modal would pop mid-drag = exactly the risk the task says to avoid → SKIP.
- `onTap` is clean (movement fails it) but `onTap` is already owned by tap-to-toggle-select
  (the must-keep behavior); can't repurpose it for edit without breaking selection.
- No grid-level `onItemPress`/stationary-hold-and-release callback exists.
→ The explicit popover path IS the fix. No direct chip long-press restoration.

## Steps
- [x] Read all touched files + the sortables type defs in node_modules.
- [ ] `ActivityReorder` → activity-management hub: tappable rows (icon + name + pencil)
      that call a new `onEditActivity(activity)` prop; KEEP up/down arrows + Save/Close.
- [ ] `ActivitySelector`: rename popover item "Reorder Activities" → "Edit Activities"
      (icon → `edit`); plumb the hub's `onEditActivity` to the EXISTING edit flow
      (`setSelectedActivity` + open `modals.edit`) — reuses the single `ActivityEditModal`.
- [ ] Remove the dead `onLongPress`/`delayLongPress` zombie handlers from the chip
      (`ActivityItem`) and drop the now-unused `onLongPressActivity` plumbing.
- [ ] Add a cheap RNTL test for the hub edit flow (tap a row → onEditActivity called).
- [ ] Gates: `tsc --noEmit` 0 errors, `jest` all green, eslint changed files clean.

## Decisions made
- Reuse the single top-level `ActivityEditModal` instance (overlay host stacks fine) rather
  than mounting a second one inside the hub — less state, no duplicate db/refetch wiring.
- Keep the arrows working (accessible reorder fallback) per the task; the hub gains edit,
  it doesn't lose reorder.
