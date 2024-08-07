import { StyleSheet } from 'react-native';
import { useMemo } from 'react';
import { useSettings } from '@/context/SettingsContext';

// Theme type definitions
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
};

// Define theme names
export type ThemeName = 'light' | 'dark' | 'cherry' | 'midnight' | 'forest';

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
    }
};

const lightColors: ThemeColors = {
    background: '#F5F5F5',
    cardBackground: '#FFFFFF',
    secondaryBackground: '#FFFFFF',
    text: '#000000',
    textSecondary: 'rgba(0, 0, 0, 0.6)',
    border: 'rgba(0, 0, 0, 0.1)',
    accent: '#4CAF50',  // Keep accent colors consistent
    accentDark: '#3d8b40',
    overlays: {
        tag: 'rgba(0, 0, 0, 0.05)',
        tagBorder: 'rgba(0, 0, 0, 0.1)',
        border: 'rgba(0, 0, 0, 0.1)',
        textSecondary: 'rgba(0, 0, 0, 0.6)',
    }
};

// Cherry blossom theme
const cherryColors: ThemeColors = {
    background: '#FFF0F5', // Light pink background
    cardBackground: '#FFFFFF',
    secondaryBackground: '#FFEBF3',
    text: '#4A2932', // Deep rose for text
    textSecondary: 'rgba(74, 41, 50, 0.7)',
    border: 'rgba(219, 112, 147, 0.2)',
    accent: '#DB7093', // Pink accent
    accentDark: '#C25B7C', // Darker pink
    overlays: {
        tag: 'rgba(219, 112, 147, 0.1)',
        tagBorder: 'rgba(219, 112, 147, 0.2)',
        border: 'rgba(219, 112, 147, 0.2)',
        textSecondary: 'rgba(74, 41, 50, 0.6)',
    }
};

// Midnight Blue theme
const midnightColors: ThemeColors = {
    background: '#0F1C2E', // Deep blue background
    cardBackground: '#1A2B40',
    secondaryBackground: '#253952',
    text: '#E0E7FF', // Light blue-white text
    textSecondary: 'rgba(224, 231, 255, 0.7)',
    border: 'rgba(100, 149, 237, 0.3)',
    accent: '#6495ED', // Cornflower blue accent
    accentDark: '#4169E1', // Royal blue
    overlays: {
        tag: 'rgba(100, 149, 237, 0.15)',
        tagBorder: 'rgba(100, 149, 237, 0.3)',
        border: 'rgba(100, 149, 237, 0.2)',
        textSecondary: 'rgba(224, 231, 255, 0.6)',
    }
};

// Forest theme
const forestColors: ThemeColors = {
    background: '#E8F5E9', // Light green background
    cardBackground: '#FFFFFF',
    secondaryBackground: '#F1F8E9',
    text: '#1B5E20', // Deep forest green text
    textSecondary: 'rgba(27, 94, 32, 0.7)',
    border: 'rgba(76, 175, 80, 0.2)',
    accent: '#43A047', // Green accent
    accentDark: '#2E7D32', // Darker green
    overlays: {
        tag: 'rgba(76, 175, 80, 0.1)',
        tagBorder: 'rgba(76, 175, 80, 0.2)',
        border: 'rgba(76, 175, 80, 0.2)',
        textSecondary: 'rgba(27, 94, 32, 0.6)',
    }
};

// Map of all available themes
export const themeColors: Record<ThemeName, ThemeColors> = {
    dark: darkColors,
    light: lightColors,
    cherry: cherryColors,
    midnight: midnightColors,
    forest: forestColors,
};

// Hook to get current theme colors
export const useThemeColors = () => {
    const { settings } = useSettings();
    
    // First check if a specific theme is selected
    if (settings.theme) {
        // If theme is 'light' or 'dark', use the corresponding theme
        if (settings.theme === 'light' || settings.theme === 'dark') {
            return settings.theme === 'dark' ? darkColors : lightColors;
        }
        
        // Otherwise, check if it's a custom theme
        if (themeColors[settings.theme as ThemeName]) {
            return themeColors[settings.theme as ThemeName];
        }
    }
    
    // Fallback to light/dark based on theme_mode (for backward compatibility)
    const themeMode = settings.theme_mode;
    return themeMode === 'dark' ? darkColors : lightColors;
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

// Static colors (for backward compatibility)
export const colors = darkColors;
