// timelinePalette.ts
//
// The few colours the Timeline derives rather than reads straight off the theme.
// UI-free on purpose (no React, no components): the contrast invariant test
// imports it for every theme without dragging reanimated in through the cards
// (tasks/lessons.md 2026-06-13, "Keep icon/data registries UI-free").

import type { ThemeColors } from '@/styles/global';
import { moodAccentRgb, moodAlpha } from './moodColor';

/**
 * How much of the mood ramp's alpha the NODE's fill carries. The ring shows the
 * full ramp; the fill is a wash of it, light enough that the mood number printed
 * on it in `colors.text` keeps >= 4.5:1 in every theme (a solid accent disc
 * under `colors.text` fails that on the light themes). Pinned by
 * __tests__/timelineContrast.test.ts.
 */
export const NODE_FILL_STRENGTH = 0.3;

/** The mood node's fill: the accent at a fraction of the ramp's alpha. */
export const nodeFill = (mood: number, accent: string): string => {
    const { r, g, b } = moodAccentRgb(accent);
    const alpha = Number.isFinite(mood)
        ? Math.round(moodAlpha(mood) * NODE_FILL_STRENGTH * 1000) / 1000
        : 0;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

/**
 * Semantic destructive colour (the one hardcoded-colour exception CLAUDE.md
 * allows), picked per theme family so the 14px "Delete" label clears WCAG AA
 * 4.5:1 on the card surface: #C62828 on the light cards (~5.6:1), #FF6B6B on
 * the dark ones (~6:1). A single mid red fails both.
 */
export const dangerColor = (colors: ThemeColors): string => (colors.isDark ? '#FF6B6B' : '#C62828');
