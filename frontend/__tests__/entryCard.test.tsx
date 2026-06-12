/**
 * Render-structure tests for the Timeline EntryCard.
 *
 * These guard the redesign's STRUCTURE (the device-QA pass owns pixel fidelity):
 *   - the mood number + "/10" render (not "Mood:" label prose),
 *   - a left accent bar element is present and absolutely positioned with a
 *     mood-derived backgroundColor (the QA pass caught it rendering invisible
 *     when it was an in-flow child of Card's wrapper — this asserts the bar
 *     style is `position:'absolute'`, the shape of the fix),
 *   - edit/delete keep their exact accessibility labels,
 *   - one photo takes the stretched hero wrapper (the QA pass caught it
 *     shrink-wrapping to ~40% width — this asserts `alignSelf:'stretch'`).
 *
 * The real Card is used (the bug lived in how Card wraps children); heavy leaf
 * deps (OverlayModal / image picker) are mocked to keep the render cheap.
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

// Minimal theme so useThemeColors works without SettingsProvider (Card reads it).
jest.mock('@/styles/global', () => {
    const actual = jest.requireActual('@/styles/global');
    return {
        ...actual,
        useThemeColors: () => ({
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
        }),
    };
});

// OverlayModal pulls overlay-host context we don't need here.
jest.mock('@/components/OverlayModal', () => ({
    OverlayModal: ({ children, visible }: { children: React.ReactNode; visible: boolean }) => {
        const ReactActual = require('react') as typeof React;
        const { View } = require('react-native');
        return visible ? ReactActual.createElement(View, null, children) : null;
    },
}));

import { EntryCard } from '@/components/timeline/EntryCard';
import { moodColor } from '@/components/timeline/moodColor';
import type { MoodEntry } from '@/components/types';

const THEME_ACCENT = '#4CAF50';
const TAG = '#222';

const baseEntry = (over: Partial<MoodEntry> = {}): MoodEntry => ({
    id: 1,
    mood: 7,
    notes: '',
    date: '2026-06-12T10:05:00.000Z',
    activities: [],
    photos: [],
    ...over,
});

const noop = () => {};

// Flatten a JSON node's style prop to a single object for assertion.
const styleOf = (node: any) => (node?.props ? StyleSheet.flatten(node.props.style) || {} : {});

/** Depth-first collect of every JSON node matching a predicate on its style. */
const collectByStyle = (
    json: any,
    pred: (s: any) => boolean,
    out: any[] = []
): any[] => {
    if (!json || typeof json !== 'object') return out;
    if (pred(styleOf(json))) out.push(json);
    const kids = json.children;
    if (Array.isArray(kids)) for (const k of kids) collectByStyle(k, pred, out);
    return out;
};

describe('EntryCard — structure', () => {
    it('shows the mood number and "/10", not "Mood:" label prose', async () => {
        const colors: any = (jest.requireMock('@/styles/global') as any).useThemeColors();
        const view = await render(
            <EntryCard entry={baseEntry({ mood: 7 })} onEdit={noop} onDelete={noop} colors={colors} />
        );
        expect(view.getByText('7')).toBeTruthy();
        expect(view.getByText('/10')).toBeTruthy();
        expect(view.queryByText(/Mood:/)).toBeNull();
    });

    it('renders an absolutely-positioned accent bar tinted by the mood', async () => {
        const colors: any = (jest.requireMock('@/styles/global') as any).useThemeColors();
        const expected = moodColor(7, THEME_ACCENT, TAG); // rgba(76,175,80, 0.76)
        const view = await render(
            <EntryCard entry={baseEntry({ mood: 7 })} onEdit={noop} onDelete={noop} colors={colors} />
        );
        // The bar is the View whose backgroundColor is the mood color AND is
        // absolutely positioned (the shape of the fix).
        const bars = collectByStyle(
            view.toJSON(),
            (s) => s.backgroundColor === expected && s.position === 'absolute'
        );
        expect(bars.length).toBeGreaterThan(0);
        const barStyle = styleOf(bars[0]);
        expect(barStyle.left).toBe(0);
        expect(barStyle.width).toBe(4);
    });

    it('preserves the exact edit/delete accessibility labels', async () => {
        const colors: any = (jest.requireMock('@/styles/global') as any).useThemeColors();
        const view = await render(
            <EntryCard entry={baseEntry()} onEdit={noop} onDelete={noop} colors={colors} />
        );
        expect(view.getByLabelText('Edit entry')).toBeTruthy();
        expect(view.getByLabelText('Delete entry')).toBeTruthy();
    });

    it('stretches the single-photo hero wrapper to full width', async () => {
        const colors: any = (jest.requireMock('@/styles/global') as any).useThemeColors();
        const view = await render(
            <EntryCard
                entry={baseEntry({
                    photos: [
                        { id: 9, entry_id: 1, file_path: 'file:///media/a.jpg', media_type: 'image' },
                    ],
                })}
                onEdit={noop}
                onDelete={noop}
                colors={colors}
            />
        );
        // The single-photo Pressable carries the stretch style + its "View photo 1"
        // label (the multi-photo strip would have no stretched wrapper).
        const heroBtn = view.getByLabelText('View photo 1');
        expect(styleOf(heroBtn).alignSelf).toBe('stretch');
    });
});
