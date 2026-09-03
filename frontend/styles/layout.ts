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
