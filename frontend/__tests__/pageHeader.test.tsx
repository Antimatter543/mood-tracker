/**
 * Render tests for the shared page-title primitive (components/PageHeader.tsx).
 *
 * Every tab screen opens with this component, so its contract is worth locking:
 *   - the title renders, and is the a11y header node,
 *   - the subtitle renders when given and is ABSENT (not empty) when not,
 *   - the glyph render-prop is called with the size/colour PageHeader owns, so
 *     no screen can quietly ship a differently-sized or off-theme icon,
 *   - a caller-supplied `style` composes with the base container style (this is
 *     how the full-height screens apply their horizontal inset).
 *
 * Pattern mirrors __tests__/statTile.test.tsx (real component, mocked theme so
 * useThemeColors works without a SettingsProvider). RNTL 14 is async-by-default
 * — every render() is awaited (see tasks/lessons.md 2026-08-29).
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import { Text, StyleSheet } from 'react-native';

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

import {
    PageHeader,
    PAGE_HEADER_ICON_SIZE,
    pageHeaderFullHeightInset,
} from '@/components/PageHeader';
import { LAYOUT_CONTENT_PADDING } from '@/styles/layout';

const styleOf = (node: any) =>
    node?.props ? StyleSheet.flatten(node.props.style) || {} : {};

describe('PageHeader', () => {
    it('renders the title', async () => {
        const view = await render(<PageHeader title="Settings" />);
        expect(view.getByText('Settings')).toBeTruthy();
        expect(view.getByTestId('page-header-title').props.children).toBe('Settings');
    });

    it('marks the title as an accessibility header', async () => {
        const view = await render(<PageHeader title="Timeline" />);
        expect(view.getByTestId('page-header-title').props.accessibilityRole).toBe(
            'header'
        );
    });

    it('renders the subtitle when given', async () => {
        const view = await render(
            <PageHeader title="Insights" subtitle="What your entries say about you" />
        );
        expect(view.getByText('What your entries say about you')).toBeTruthy();
        expect(styleOf(view.getByTestId('page-header-subtitle')).color).toBe(
            THEME.textSecondary
        );
    });

    it('renders NO subtitle node at all when none is given', async () => {
        const view = await render(<PageHeader title="Statistics" />);
        expect(view.queryByTestId('page-header-subtitle')).toBeNull();
    });

    it('drives the glyph with the size and colour it owns, not the caller', async () => {
        const icon = jest.fn(() => <Text>glyph</Text>);
        const view = await render(<PageHeader title="Home" icon={icon} />);

        expect(icon).toHaveBeenCalledWith({
            size: PAGE_HEADER_ICON_SIZE,
            color: THEME.text,
        });
        expect(view.getByText('glyph')).toBeTruthy();
    });

    it('renders without a glyph', async () => {
        const view = await render(<PageHeader title="Home" />);
        expect(view.getByText('Home')).toBeTruthy();
    });

    it('composes a caller style over the base container style', async () => {
        const view = await render(
            <PageHeader title="Timeline" style={pageHeaderFullHeightInset} />
        );
        const container = styleOf(view.getByTestId('page-header'));
        // Caller inset applied...
        expect(container.paddingHorizontal).toBe(LAYOUT_CONTENT_PADDING);
        // ...without dropping the component's own spacing.
        expect(container.marginBottom).toBeGreaterThan(0);
    });

    it('derives the full-height inset from Layout\'s content padding', () => {
        // Guards the reason the constant exists: the full-height screens
        // (Statistics, Timeline) must line their title up with the scrolling
        // screens, which get their padding from Layout.
        // BOTH axes: Layout's ScrollView pads every side, so restoring only the
        // gutter left these titles 20px higher than Home / Insights (2026-09-04).
        expect(StyleSheet.flatten(pageHeaderFullHeightInset)).toEqual({
            paddingHorizontal: LAYOUT_CONTENT_PADDING,
            paddingTop: LAYOUT_CONTENT_PADDING,
        });
    });

    it('honours a custom testID', async () => {
        const view = await render(<PageHeader title="Home" testID="home-header" />);
        expect(view.getByTestId('home-header')).toBeTruthy();
    });
});
