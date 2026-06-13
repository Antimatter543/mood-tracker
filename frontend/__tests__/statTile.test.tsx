/**
 * Render-structure tests for the shared StatTile "Overview" primitive.
 *
 * Pixel fidelity is the device-QA pass's job; these guard the STRUCTURE that
 * both StatSummaryCard (Stats) and the Home monthly-overview card depend on:
 *   - value + label text both render,
 *   - the icon chip is a 36x36 round accent-tinted View (the "open tile" chip,
 *     not a box-inside-box),
 *   - a `color` override recolors the value Text (semantic states like
 *     "Falling"); without it the value uses theme text.
 *
 * The pattern mirrors __tests__/entryCard.test.tsx (real component, mocked
 * theme so useThemeColors works without SettingsProvider).
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

const THEME = {
    background: '#000',
    cardBackground: '#111',
    secondaryBackground: '#222',
    text: '#fff',
    textSecondary: '#aaa',
    border: '#333',
    accent: '#4CAF50',
    accentDark: '#388E3C',
    accentLight: 'rgba(76,175,80,0.1)',
    overlays: { tag: '#222', tagBorder: '#333', border: '#333', textSecondary: '#aaa' },
    elevation: { shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, elevation: 8 },
    isDark: true,
};

jest.mock('@/styles/global', () => {
    const actual = jest.requireActual('@/styles/global');
    return { ...actual, useThemeColors: () => THEME };
});

import { StatTile } from '@/components/StatTile';

const styleOf = (node: any) => (node?.props ? StyleSheet.flatten(node.props.style) || {} : {});

const collectByStyle = (json: any, pred: (s: any) => boolean, out: any[] = []): any[] => {
    if (!json || typeof json !== 'object') return out;
    if (pred(styleOf(json))) out.push(json);
    const kids = json.children;
    if (Array.isArray(kids)) for (const k of kids) collectByStyle(k, pred, out);
    return out;
};

describe('StatTile — structure', () => {
    it('renders the value and label text', async () => {
        const view = await render(
            <StatTile icon="activity" value="7.2 / 10" label="Avg mood" />
        );
        expect(view.getByText('7.2 / 10')).toBeTruthy();
        expect(view.getByText('Avg mood')).toBeTruthy();
    });

    it('renders a 36x36 round accent-tinted icon chip (the open-tile chip)', async () => {
        const view = await render(
            <StatTile icon="zap" value="5 days" label="Streak" />
        );
        const chips = collectByStyle(
            view.toJSON(),
            (s) =>
                s.width === 36 &&
                s.height === 36 &&
                s.borderRadius === 18 &&
                s.backgroundColor === THEME.accentLight
        );
        expect(chips.length).toBe(1);
    });

    it('recolors the value Text when a color override is given', async () => {
        const view = await render(
            <StatTile icon="trending-down" value="Falling" label="Trend" color="#e57373" />
        );
        const valueNode = view.getByText('Falling');
        expect(styleOf(valueNode).color).toBe('#e57373');
    });

    it('defaults the value Text to the theme text color with no override', async () => {
        const view = await render(
            <StatTile icon="check-circle" value="92%" label="Consistency" />
        );
        const valueNode = view.getByText('92%');
        expect(styleOf(valueNode).color).toBe(THEME.text);
    });
});
