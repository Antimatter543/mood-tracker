/**
 * Layout constants shared between the page container and the things that have
 * to line up with it.
 *
 * Deliberately dependency-free: `components/PageHeader.tsx` needs the content
 * padding, but importing it from `components/PageContainer.tsx` would drag
 * reanimated (via AddEntryButton) into every screen and test that only wants a
 * page title.
 */

/**
 * Padding `Layout`'s ScrollView gives its content. Screens that opt OUT of the
 * ScrollView (`useScrollView={false}`) get none of it and must supply the
 * horizontal part themselves — see `pageHeaderFullHeightInset` in
 * components/PageHeader.tsx, derived from this so every page title starts on
 * the same vertical line whichever branch its screen uses.
 */
export const LAYOUT_CONTENT_PADDING = 20;

/**
 * Bottom padding a scrollable page must add ON TOP of the bottom safe-area inset
 * so its last item clears the floating "add entry" FAB. The FAB sits at
 * (24 + insetBottom) from the bottom and is ~56px tall, so 100 clears it with a
 * little breathing room.
 *
 * EVERY scroller owes this, not just `Layout`'s ScrollView. A screen that opts
 * out of that ScrollView (`useScrollView={false}`) and brings its own list —
 * Timeline's SectionList — has to apply it itself, and when it didn't, the tail
 * of the list sat permanently under the FAB with no way to scroll it into view.
 * Shared constant so the two can't drift apart again.
 */
export const LAYOUT_FAB_CLEARANCE = 100;
