/**
 * Theme registry sanity tests.
 *
 * The TypeScript type system already enforces token completeness via
 * `Record<ThemeName, ThemeColors>`, but a runtime test belongs here too
 * because:
 *   1. Some token values are strings (colors) that TS can't validate beyond
 *      "is a string" — we want to catch empty/garbage values too.
 *   2. The fallback chain in `resolveTheme` has runtime branches that are
 *      easy to break accidentally.
 */
import { themeColors, resolveTheme, ThemeName, ThemeColors } from '@/styles/global';

const REQUIRED_TOP_LEVEL: (keyof ThemeColors)[] = [
    'background',
    'cardBackground',
    'secondaryBackground',
    'text',
    'textSecondary',
    'border',
    'accent',
    'accentDark',
    'accentLight',
    'overlays',
    'elevation',
    'isDark',
];

const REQUIRED_OVERLAY: (keyof ThemeColors['overlays'])[] = [
    'tag',
    'tagBorder',
    'border',
    'textSecondary',
];

const ALL_THEMES: ThemeName[] = ['light', 'dark', 'cherry', 'midnight', 'forest'];

describe('themeColors registry', () => {
    it.each(ALL_THEMES)('theme "%s" defines every required top-level token', (name) => {
        const theme = themeColors[name];
        for (const key of REQUIRED_TOP_LEVEL) {
            expect(theme[key]).toBeDefined();
        }
    });

    it.each(ALL_THEMES)('theme "%s" defines every required overlay token', (name) => {
        const theme = themeColors[name];
        for (const key of REQUIRED_OVERLAY) {
            // The bug we're guarding: components reference `overlays.tag` and
            // `overlays.tagBorder` — a missing key crashes the app on theme
            // switch.
            expect(theme.overlays[key]).toBeDefined();
            expect(typeof theme.overlays[key]).toBe('string');
            expect((theme.overlays[key] as string).length).toBeGreaterThan(0);
        }
    });

    it.each(ALL_THEMES)('theme "%s" provides numeric elevation values', (name) => {
        const theme = themeColors[name];
        expect(typeof theme.elevation.elevation).toBe('number');
        expect(typeof theme.elevation.shadowOpacity).toBe('number');
        expect(typeof theme.elevation.shadowRadius).toBe('number');
        expect(typeof theme.elevation.shadowColor).toBe('string');
    });

    it('marks dark-family themes as isDark and light-family as not', () => {
        expect(themeColors.dark.isDark).toBe(true);
        expect(themeColors.midnight.isDark).toBe(true);
        expect(themeColors.light.isDark).toBe(false);
        expect(themeColors.cherry.isDark).toBe(false);
        expect(themeColors.forest.isDark).toBe(false);
    });
});

describe('resolveTheme fallback chain', () => {
    it('returns the named theme when it is a known value', () => {
        for (const name of ALL_THEMES) {
            expect(resolveTheme({ theme: name, theme_mode: 'dark' })).toBe(name);
        }
    });

    it('falls back to theme_mode when theme is the empty-string sentinel', () => {
        expect(resolveTheme({ theme: '', theme_mode: 'light' })).toBe('light');
        expect(resolveTheme({ theme: '', theme_mode: 'dark' })).toBe('dark');
    });

    it('falls back to theme_mode when theme is unknown garbage', () => {
        // Cast via `as any` because the type-narrowed signature disallows
        // garbage at compile time — but real persisted values can be stale.
        expect(resolveTheme({ theme: 'nope' as any, theme_mode: 'light' })).toBe('light');
    });
});
