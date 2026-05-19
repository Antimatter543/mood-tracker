import { StyleSheet } from 'react-native';
import { useMemo } from 'react';
import { useSettings } from '@/context/SettingsContext';

/**
 * Theme token interface.
 *
 * Every named theme MUST satisfy this shape; the TypeScript compiler enforces
 * completeness via the `Record<ThemeName, ThemeColors>` map below. Adding a
 * token here requires updating every theme (compile error otherwise).
 *
 * `elevation` controls shadow intensity in `Card` / `AddEntryButton`. Light
 * themes get a softer drop; dark themes get a deeper one for visual depth.
 */
export type ThemeColors = {
    background: string;
    cardBackground: string;
    secondaryBackground: string;
    text: string;
    textSecondary: string;
    border: string;
    accent: string;
    accentDark: string;
    overlays: {
        tag: string;
        tagBorder: string;
        border: string;
        textSecondary: string;
    };
    elevation: {
        shadowColor: string;
        shadowOpacity: number;
        shadowRadius: number;
        elevation: number; // Android
    };
    /** Whether the theme is dark-on-light or light-on-dark. Drives StatusBar. */
    isDark: boolean;
};

// Define theme names
export type ThemeName = 'light' | 'dark' | 'cherry' | 'midnight' | 'forest';

// Shared elevation presets — light themes use a soft black drop, dark themes
// use a slightly heavier black drop because their backgrounds absorb shadow.
const lightElevation: ThemeColors['elevation'] = {
    shadowColor: '#000000',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
};

const darkElevation: ThemeColors['elevation'] = {
    shadowColor: '#000000',
    shadowOpacity: 0.32,
    shadowRadius: 8,
    elevation: 4,
};

// Define themes
const darkColors: ThemeColors = {
    background: '#121212',
    cardBackground: '#1E1E1E',
    secondaryBackground: '#25292e',
    text: '#FFFFFF',
    textSecondary: 'rgba(211,212,213, 1)',
    border: 'rgba(255, 255, 255, 0.1)',
    accent: '#4CAF50',
    accentDark: '#3d8b40',
    overlays: {
        tag: 'rgba(255, 255, 255, 0.1)',
        tagBorder: 'rgba(255, 255, 255, 0.2)',
        border: 'rgba(255, 255, 255, 0.1)',
        textSecondary: 'rgba(255, 255, 255, 0.6)',
    },
    elevation: darkElevation,
    isDark: true,
};

const lightColors: ThemeColors = {
    background: '#F5F5F5',
    cardBackground: '#FFFFFF',
    secondaryBackground: '#FFFFFF',
    text: '#000000',
    textSecondary: 'rgba(0, 0, 0, 0.6)',
    border: 'rgba(0, 0, 0, 0.1)',
    accent: '#4CAF50',
    accentDark: '#3d8b40',
    overlays: {
        tag: 'rgba(0, 0, 0, 0.05)',
        tagBorder: 'rgba(0, 0, 0, 0.1)',
        border: 'rgba(0, 0, 0, 0.1)',
        textSecondary: 'rgba(0, 0, 0, 0.6)',
    },
    elevation: lightElevation,
    isDark: false,
};

// Cherry blossom theme — light family
const cherryColors: ThemeColors = {
    background: '#FFF0F5',
    cardBackground: '#FFFFFF',
    secondaryBackground: '#FFEBF3',
    text: '#4A2932',
    textSecondary: 'rgba(74, 41, 50, 0.7)',
    border: 'rgba(219, 112, 147, 0.2)',
    accent: '#DB7093',
    accentDark: '#C25B7C',
    overlays: {
        tag: 'rgba(219, 112, 147, 0.1)',
        tagBorder: 'rgba(219, 112, 147, 0.2)',
        border: 'rgba(219, 112, 147, 0.2)',
        textSecondary: 'rgba(74, 41, 50, 0.6)',
    },
    elevation: lightElevation,
    isDark: false,
};

// Midnight Blue theme — dark family
const midnightColors: ThemeColors = {
    background: '#0F1C2E',
    cardBackground: '#1A2B40',
    secondaryBackground: '#253952',
    text: '#E0E7FF',
    textSecondary: 'rgba(224, 231, 255, 0.7)',
    border: 'rgba(100, 149, 237, 0.3)',
    accent: '#6495ED',
    accentDark: '#4169E1',
    overlays: {
        tag: 'rgba(100, 149, 237, 0.15)',
        tagBorder: 'rgba(100, 149, 237, 0.3)',
        border: 'rgba(100, 149, 237, 0.2)',
        textSecondary: 'rgba(224, 231, 255, 0.6)',
    },
    elevation: darkElevation,
    isDark: true,
};

// Forest theme — light family
const forestColors: ThemeColors = {
    background: '#E8F5E9',
    cardBackground: '#FFFFFF',
    secondaryBackground: '#F1F8E9',
    text: '#1B5E20',
    textSecondary: 'rgba(27, 94, 32, 0.7)',
    border: 'rgba(76, 175, 80, 0.2)',
    accent: '#43A047',
    accentDark: '#2E7D32',
    overlays: {
        tag: 'rgba(76, 175, 80, 0.1)',
        tagBorder: 'rgba(76, 175, 80, 0.2)',
        border: 'rgba(76, 175, 80, 0.2)',
        textSecondary: 'rgba(27, 94, 32, 0.6)',
    },
    elevation: lightElevation,
    isDark: false,
};

// Map of all available themes.
// The `Record<ThemeName, ThemeColors>` annotation means TypeScript will reject
// any theme that's missing a required token (e.g. `overlays.tag`). This is the
// compile-time guarantee that protects components from crashing on theme swap.
export const themeColors: Record<ThemeName, ThemeColors> = {
    dark: darkColors,
    light: lightColors,
    cherry: cherryColors,
    midnight: midnightColors,
    forest: forestColors,
};

/**
 * Resolve the active theme name from settings.
 *
 * Fallback chain (see also [[settings-theme-vs-theme_mode]]):
 *   1. If `settings.theme` is a valid named theme → use it.
 *   2. Else if `settings.theme` is `''` (the "system default" sentinel) →
 *      fall back to `settings.theme_mode` (`'light' | 'dark'`).
 *   3. Else → `'dark'` as a final safety net.
 *
 * `theme_mode` is kept for backward compatibility; `theme === ''` means
 * "use theme_mode". When the user picks a named theme via SettingRow we also
 * sync theme_mode to match so the StatusBar / system styling stays coherent.
 */
export function resolveTheme(settings: {
    theme: string;
    theme_mode: 'light' | 'dark';
}): ThemeName {
    const t = settings.theme;
    if (t && (t === 'light' || t === 'dark' || t === 'cherry' || t === 'midnight' || t === 'forest')) {
        return t;
    }
    return settings.theme_mode === 'light' ? 'light' : 'dark';
}

// Hook to get current theme colors
export const useThemeColors = (): ThemeColors => {
    const { settings } = useSettings();
    const themeName = resolveTheme(settings);
    return themeColors[themeName];
};

// Global styles hook (for dynamic styles)
export const useGlobalStyles = (colors: ThemeColors) => {
    return useMemo(() => StyleSheet.create({
        container: {
            flex: 1,
            backgroundColor: colors.background,
        },
        contentContainer: {
            flex: 1,
            backgroundColor: colors.background,
        },
        text: {
            color: colors.text,
            fontSize: 16,
        },
        textSecondary: {
            color: colors.textSecondary,
            fontSize: 14,
        },
        cardTitle: {
            fontSize: 18,
            fontWeight: '600',
            color: colors.text,
            marginBottom: 16,
        },
        header: {
            flexDirection: 'row',
            alignItems: 'center',
            padding: 16,
            marginBottom: 16,
        },
        headerText: {
            fontSize: 24,
            fontWeight: 'bold',
            color: colors.text,
            marginLeft: 12,
        },
    }), [colors]);
};

// Static colors (for backward compatibility — DO NOT use in new code; use
// `useThemeColors()` instead so theme switches actually rebroadcast).
export const colors = darkColors;
