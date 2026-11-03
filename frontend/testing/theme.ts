/**
 * The app's REAL theme tokens for tests (never an invented palette).
 *
 *   jest.mock('@/styles/global', () => require('@/testing/theme').mockThemeModule());
 *   import { THEME } from '@/testing/theme';
 *   expect(styleOf(node).color).toBe(THEME.textSecondary);
 *
 * mockThemeModule keeps every real export (themeColors, resolveTheme,
 * useGlobalStyles, ...) and only replaces useThemeColors, so components render
 * without a SettingsProvider. Pass a theme name to render under another theme.
 *
 * Loaded through jest.requireActual so it works from inside a jest.mock factory
 * of '@/styles/global' itself.
 */
import type { ThemeColors, ThemeName } from '@/styles/global';

type GlobalStyles = typeof import('@/styles/global');
type SettingsModule = typeof import('@/databases/settings');

const actualTheme = () => jest.requireActual<GlobalStyles>('@/styles/global');

/** The theme a fresh install resolves to: resolveTheme over the SETTINGS_REGISTRY defaults. */
export function defaultThemeName(): ThemeName {
    const { SETTINGS_REGISTRY } = jest.requireActual<SettingsModule>('@/databases/settings');
    return actualTheme().resolveTheme({
        theme: SETTINGS_REGISTRY.theme.default as string,
        theme_mode: SETTINGS_REGISTRY.theme_mode.default as 'light' | 'dark',
    });
}

/** Real tokens of a theme (default: the fresh-install theme). */
export function themeTokens(name: ThemeName = defaultThemeName()): ThemeColors {
    return actualTheme().themeColors[name];
}

/** The fresh-install theme's tokens. */
export const THEME: ThemeColors = themeTokens();

/** A '@/styles/global' module whose useThemeColors returns real tokens without a provider. */
export function mockThemeModule(name: ThemeName = defaultThemeName()): GlobalStyles {
    const actual = actualTheme();
    const tokens = actual.themeColors[name];
    return { ...actual, useThemeColors: () => tokens };
}
