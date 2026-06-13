/**
 * Pure unit tests for the floating tab bar's safe-area-aware style.
 *
 * The bug: the tab bar set a FIXED `height: 64`, and react-navigation's
 * BottomTabBar `getTabBarHeight` returns a fixed height verbatim (skipping the
 * `+ insets.bottom` it applies to its default height) — so on a 3-button-nav
 * Pixel (inset ≈ 48dp) the bar sat flush UNDER the Android nav buttons. Fix:
 * compute height + paddingBottom as BASE + inset.
 *
 * `buildTabBarStyle` is the extracted pure builder; testing it directly avoids
 * rendering the provider-coupled navigator. Math, not pixels — pixel placement
 * is the on-device QA pass.
 */
import {
    buildTabBarStyle,
    TAB_BAR_CONTENT_HEIGHT,
    TAB_BAR_CONTENT_PADDING_BOTTOM,
} from '@/lib/tabBarStyle';

const THEME = {
    secondaryBackground: '#222',
    isDark: true,
} as any;

describe('buildTabBarStyle — bottom safe-area inset', () => {
    it('adds the inset to BOTH height and paddingBottom (3-button nav = 48dp)', () => {
        const style = buildTabBarStyle(THEME, 48);
        expect(style.height).toBe(TAB_BAR_CONTENT_HEIGHT + 48); // 64 + 48 = 112
        expect(style.paddingBottom).toBe(TAB_BAR_CONTENT_PADDING_BOTTOM + 48); // 8 + 48 = 56
    });

    it('handles a gesture-nav inset (≈ 24dp)', () => {
        const style = buildTabBarStyle(THEME, 24);
        expect(style.height).toBe(TAB_BAR_CONTENT_HEIGHT + 24);
        expect(style.paddingBottom).toBe(TAB_BAR_CONTENT_PADDING_BOTTOM + 24);
    });

    it('falls back to the base content height when there is no inset (0)', () => {
        const style = buildTabBarStyle(THEME, 0);
        expect(style.height).toBe(TAB_BAR_CONTENT_HEIGHT);
        expect(style.paddingBottom).toBe(TAB_BAR_CONTENT_PADDING_BOTTOM);
    });

    it('keeps the visual content height constant — the bar only GROWS by the inset', () => {
        // height - paddingBottom is the icon/label band; it must not change with
        // the inset (the inset is pure system-nav clearance below the content).
        const band = (inset: number) => {
            const s = buildTabBarStyle(THEME, inset);
            return (s.height as number) - (s.paddingBottom as number);
        };
        expect(band(0)).toBe(band(48));
        expect(band(24)).toBe(band(48));
    });

    it('preserves the floating-bar chrome (radius, top padding, theme bg)', () => {
        const style = buildTabBarStyle(THEME, 48);
        expect(style.borderTopLeftRadius).toBe(20);
        expect(style.borderTopRightRadius).toBe(20);
        expect(style.paddingTop).toBe(4);
        expect(style.backgroundColor).toBe(THEME.secondaryBackground);
    });
});
