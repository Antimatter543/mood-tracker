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
 * Geometry of the floating "add entry" FAB (components/AddEntryButton.tsx),
 * shared so everything that lines up with it (the Timeline's back-to-top pill,
 * the FAB clearance below) is derived from the same numbers.
 *
 * The gap is measured from the bottom of the TAB SCENE, and adds NO safe-area
 * inset: react-navigation lays the scene out ABOVE the tab bar (a flex column,
 * the bar is not absolutely positioned), and the bar has already grown by the
 * bottom inset (lib/tabBarStyle.ts). The scene's bottom edge therefore already
 * clears the Android nav buttons / gesture pill; adding the inset again floated
 * the FAB a whole nav-bar height too high on 3-button devices.
 */
export const FAB_BOTTOM_GAP = 24;
export const FAB_SIZE = 56;

/**
 * Bottom padding a scrollable page inside a tab must give its content so the
 * last item clears the FAB: the FAB's gap + its height + a little breathing
 * room. No safe-area inset here either, for the same reason as above (the tab
 * scene already ends at the top of the inset-grown tab bar).
 *
 * EVERY scroller owes this, not just `Layout`'s ScrollView. A screen that opts
 * out of that ScrollView (`useScrollView={false}`) and brings its own list —
 * Timeline's SectionList — has to apply it itself, and when it didn't, the tail
 * of the list sat permanently under the FAB with no way to scroll it into view.
 * Shared constant so the two can't drift apart again.
 */
export const LAYOUT_FAB_CLEARANCE = FAB_BOTTOM_GAP + FAB_SIZE + 20; // = 100
