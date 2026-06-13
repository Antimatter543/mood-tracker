/**
 * Pure, UI-free builder for the floating tab bar's style.
 *
 * Lives in its OWN module (zero expo-router / React imports) so the inset math
 * is unit-testable WITHOUT pulling the provider-coupled route module's import
 * graph into jest (importing app/(tabs)/_layout.tsx drags expo-router's ESM
 * `standard-navigation`, which the test transform doesn't transpile). The route
 * layout imports this; tests import this. A module's import graph is part of its
 * API — keep assertable math out of the heavy UI module.
 */

// Visual size of the floating tab bar's CONTENT (icons + labels), independent of
// the system navigation area below it. The bar's real height is this PLUS the
// device's bottom safe-area inset, so the content sits ABOVE the Android nav
// buttons / gesture pill instead of flush under them.
export const TAB_BAR_CONTENT_HEIGHT = 64;
export const TAB_BAR_CONTENT_PADDING_BOTTOM = 8;

/** The subset of theme tokens the tab bar style needs. */
type TabBarColors = {
    secondaryBackground: string;
    isDark: boolean;
};

/**
 * Build the floating tab bar's style. GROWS the bar by `insetBottom` on BOTH
 * height and paddingBottom so the icon+label content keeps its visual height
 * (TAB_BAR_CONTENT_HEIGHT) while the bar extends down into the system-nav region.
 *
 * WHY we compute this ourselves: react-navigation's BottomTabBar normally adds
 * insets.bottom to its DEFAULT height + paddingBottom, but `getTabBarHeight`
 * short-circuits and returns a fixed `height` verbatim when one is set
 * (node_modules/expo-router/.../bottom-tabs/views/BottomTabBar.js: `if
 * (customHeight != null) return customHeight`). A fixed `height: 64` therefore
 * suppressed the inset; BASE + inset restores it without double-padding.
 */
export function buildTabBarStyle(colors: TabBarColors, insetBottom: number) {
    return {
        backgroundColor: colors.secondaryBackground,
        borderTopWidth: 0,
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        paddingBottom: TAB_BAR_CONTENT_PADDING_BOTTOM + insetBottom,
        paddingTop: 4,
        height: TAB_BAR_CONTENT_HEIGHT + insetBottom,
        // Shadow above the tab bar
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: colors.isDark ? 0.3 : 0.08,
        shadowRadius: 8,
        elevation: 8,
    };
}
