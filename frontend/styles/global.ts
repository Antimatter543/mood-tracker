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
    /** ~10% opacity tint of accent for card tinted backgrounds / pills. */
    accentLight: string;
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
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 3,
};

const darkElevation: ThemeColors['elevation'] = {
    shadowColor: '#000000',
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 6,
};

// Define themes
const darkColors: ThemeColors = {
    background: '#141418',
    cardBackground: '#1E1F24',
    secondaryBackground: '#25272e',
    text: '#FFFFFF',
    textSecondary: 'rgba(211,212,213, 1)',
    border: 'rgba(255, 255, 255, 0.1)',
    accent: '#4CAF50',
    accentDark: '#3d8b40',
    accentLight: 'rgba(76, 175, 80, 0.10)',
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
    accentLight: 'rgba(76, 175, 80, 0.08)',
    overlays: {
        tag: 'rgba(0, 0, 0, 0.05)',
        tagBorder: 'rgba(0, 0, 0, 0.1)',
        border: 'rgba(0, 0, 0, 0.1)',
        textSecondary: 'rgba(0, 0, 0, 0.6)',
    },
    elevation: lightElevation,
    isDark: false,
};

// Cherry blossom theme — light family (rich, saturated)
const cherryColors: ThemeColors = {
    background: '#FDE8F0',
    cardBackground: '#FFF5F8',
    secondaryBackground: '#FFE0EC',
    text: '#3D1F28',
    textSecondary: 'rgba(61, 31, 40, 0.7)',
    border: 'rgba(199, 82, 124, 0.15)',
    accent: '#C7527C',
    accentDark: '#A83D64',
    accentLight: 'rgba(199, 82, 124, 0.10)',
    overlays: {
        tag: 'rgba(199, 82, 124, 0.1)',
        tagBorder: 'rgba(199, 82, 124, 0.2)',
        border: 'rgba(199, 82, 124, 0.2)',
        textSecondary: 'rgba(61, 31, 40, 0.6)',
    },
    elevation: lightElevation,
    isDark: false,
};

// Midnight Blue theme — dark family (deep navy)
const midnightColors: ThemeColors = {
    background: '#0B1628',
    cardBackground: '#152238',
    secondaryBackground: '#1E304A',
    text: '#E0E7FF',
    textSecondary: 'rgba(224, 231, 255, 0.7)',
    border: 'rgba(100, 149, 237, 0.25)',
    accent: '#6495ED',
    accentDark: '#4169E1',
    accentLight: 'rgba(100, 149, 237, 0.12)',
    overlays: {
        tag: 'rgba(100, 149, 237, 0.15)',
        tagBorder: 'rgba(100, 149, 237, 0.3)',
        border: 'rgba(100, 149, 237, 0.2)',
        textSecondary: 'rgba(224, 231, 255, 0.6)',
    },
    elevation: darkElevation,
    isDark: true,
};

// Forest theme — light family (earthy golden-green)
const forestColors: ThemeColors = {
    background: '#ECF2E4',
    cardBackground: '#FAFCF7',
    secondaryBackground: '#F0F5E8',
    text: '#2D4A1E',
    textSecondary: 'rgba(45, 74, 30, 0.7)',
    border: 'rgba(85, 145, 55, 0.2)',
    accent: '#558B2F',
    accentDark: '#3E7A1E',
    accentLight: 'rgba(85, 139, 47, 0.10)',
    overlays: {
        tag: 'rgba(85, 139, 47, 0.1)',
        tagBorder: 'rgba(85, 139, 47, 0.2)',
        border: 'rgba(85, 139, 47, 0.2)',
        textSecondary: 'rgba(45, 74, 30, 0.6)',
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
            fontSize: 16,
            fontWeight: '700',
            color: colors.textSecondary,
            marginBottom: 16,
            textTransform: 'uppercase',
            letterSpacing: 1.2,
        },
        header: {
            flexDirection: 'row',
            alignItems: 'center',
            padding: 16,
            marginBottom: 16,
        },
        headerText: {
            fontSize: 28,
            fontWeight: '800',
            color: colors.text,
            marginLeft: 12,
            letterSpacing: -0.5,
        },
    }), [colors]);
};

// Static colors (for backward compatibility — DO NOT use in new code; use
// `useThemeColors()` instead so theme switches actually rebroadcast).
export const colors = darkColors;
