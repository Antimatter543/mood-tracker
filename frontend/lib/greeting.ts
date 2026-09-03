import type Ionicons from '@expo/vector-icons/Ionicons';

/**
 * Home's page title is the time-of-day greeting rather than the literal word
 * "Home" (the tab bar already names the tab). Both the wording and the glyph
 * live here, pure and side-effect free, so they can be unit-tested across all
 * 24 hours and can't drift apart — a "Good morning" beside a moon is exactly
 * the sort of mismatch that only shows up in a user's screenshot.
 *
 * Type-only import of Ionicons: this module stays runtime-dependency-free.
 */
export type IoniconName = keyof typeof Ionicons.glyphMap;

/** Greeting for a local hour (0–23). */
export const greetingForHour = (hour: number): string => {
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
};

/** Glyph for the same hour, switching on the SAME boundaries as the greeting. */
export const greetingIconForHour = (hour: number): IoniconName => {
    if (hour < 12) return 'sunny-outline';
    if (hour < 18) return 'partly-sunny-outline';
    return 'moon-outline';
};
