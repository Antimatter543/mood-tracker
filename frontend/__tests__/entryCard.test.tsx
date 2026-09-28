/**
 * Render-structure tests for the Timeline EntryCard (redesigned 2026-09-28 as a
 * node on a per-day rail beside a calm card).
 *
 * These guard STRUCTURE and CONTRACTS (the device-QA pass owns pixel fidelity):
 *   - the mood lives in the rail NODE (integer bare, fraction to one decimal),
 *     and the node's ring is tinted with the app's one mood ramp (moodColor);
 *   - the rail enters/leaves the node according to first/last-of-day;
 *   - the whole card body is the edit button ("Edit entry"); delete sits one
 *     step away behind "More actions" and keeps its exact "Delete entry" label;
 *   - per-card UI state resets when FlashList RECYCLES the instance for another
 *     entry (the same component, re-rendered with a different entry);
 *   - one photo takes the stretched hero wrapper at a FIXED height (an image
 *     load must never change a virtualized row's height).
 */
import React from 'react';
import { render, fireEvent, within } from '@testing-library/react-native';
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

import { EntryCard, formatMood } from '@/components/timeline/EntryCard';
import { PHOTO_HERO_HEIGHT } from '@/components/timeline/EntryPhotos';
import { moodColor } from '@/components/timeline/moodColor';
import type { MoodEntry } from '@/components/types';

const THEME_ACCENT = '#4CAF50';

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
    const colors: any = (jest.requireMock('@/styles/global') as any).useThemeColors();

    it('puts the mood in the rail node (integers bare, fractions to one decimal), not "/10" prose', async () => {
        const view = await render(
            <EntryCard entry={baseEntry({ mood: 7 })} onEdit={noop} onDelete={noop} onToggleStar={noop} colors={colors} />
        );
        expect(within(view.getByTestId('entry-mood-node')).getByText('7')).toBeTruthy();
        expect(view.queryByText('/10')).toBeNull();
        expect(view.queryByText(/Mood:/)).toBeNull();

        await view.rerender(
            <EntryCard entry={baseEntry({ mood: 6.5 })} onEdit={noop} onDelete={noop} onToggleStar={noop} colors={colors} />
        );
        expect(within(view.getByTestId('entry-mood-node')).getByText('6.5')).toBeTruthy();
        expect(formatMood(8)).toBe('8');
        expect(formatMood(7.25)).toBe('7.3');
    });

    it("tints the node's ring with the canonical mood ramp", async () => {
        const expected = moodColor(7, THEME_ACCENT, '#333'); // rgba(76,175,80, 0.76)
        const view = await render(
            <EntryCard entry={baseEntry({ mood: 7 })} onEdit={noop} onDelete={noop} onToggleStar={noop} colors={colors} />
        );
        expect(styleOf(view.getByTestId('entry-mood-node')).borderColor).toBe(expected);
        // A different mood is a different ring (the ramp is actually applied).
        await view.rerender(
            <EntryCard entry={baseEntry({ mood: 2 })} onEdit={noop} onDelete={noop} onToggleStar={noop} colors={colors} />
        );
        expect(styleOf(view.getByTestId('entry-mood-node')).borderColor).toBe(moodColor(2, THEME_ACCENT, '#333'));
    });

    it('draws the rail into the node unless first of the day, and out of it unless last', async () => {
        const rail = (json: any) =>
            collectByStyle(json, (s) => s.position === 'absolute' && s.width === 2);
        const card = (first: boolean, last: boolean) => (
            <EntryCard
                entry={baseEntry()}
                isFirstOfDay={first}
                isLastOfDay={last}
                onEdit={noop}
                onDelete={noop}
                onToggleStar={noop}
                colors={colors}
            />
        );
        const view = await render(card(true, true));
        expect(rail(view.toJSON())).toHaveLength(0); // a lone entry: just the node
        await view.rerender(card(false, false));
        expect(rail(view.toJSON())).toHaveLength(2); // mid-day: in AND out
        await view.rerender(card(true, false));
        const [out] = rail(view.toJSON());
        expect(styleOf(out).top).toBeGreaterThan(0); // starts at the node, runs down
        expect(styleOf(out).bottom).toBe(0);
    });

    it('the card body is the edit button, and hands the entry to onEdit', async () => {
        const onEdit = jest.fn();
        const entry = baseEntry({ notes: 'tap me' });
        const view = await render(
            <EntryCard entry={entry} onEdit={onEdit} onDelete={noop} onToggleStar={noop} colors={colors} />
        );
        await fireEvent.press(view.getByLabelText('Edit entry'));
        expect(onEdit).toHaveBeenCalledWith(entry);
        // The notes are INSIDE the edit target (tapping the text edits).
        expect(within(view.getByLabelText('Edit entry')).getByText('tap me')).toBeTruthy();
    });

    it('keeps delete one step away, behind "More actions", with its exact label', async () => {
        const onDelete = jest.fn();
        const view = await render(
            <EntryCard entry={baseEntry({ id: 42 })} onEdit={noop} onDelete={onDelete} onToggleStar={noop} colors={colors} />
        );
        expect(view.queryByLabelText('Delete entry')).toBeNull();
        await fireEvent.press(view.getByLabelText('More actions'));
        await fireEvent.press(view.getByLabelText('Delete entry'));
        expect(onDelete).toHaveBeenCalledTimes(1);
        expect(onDelete).toHaveBeenCalledWith(42);
        // Cancel closes the strip without deleting.
        await fireEvent.press(view.getByLabelText('More actions'));
        await fireEvent.press(view.getByLabelText('Cancel'));
        expect(view.queryByLabelText('Delete entry')).toBeNull();
        expect(onDelete).toHaveBeenCalledTimes(1);
    });

    it('action buttons are NOT nested inside the edit button (TalkBack cannot reach nested buttons)', async () => {
        const view = await render(
            <EntryCard entry={baseEntry()} onEdit={noop} onDelete={noop} onToggleStar={noop} colors={colors} />
        );
        const body = within(view.getByLabelText('Edit entry'));
        expect(body.queryByLabelText('Star entry')).toBeNull();
        expect(body.queryByLabelText('More actions')).toBeNull();
    });

    it('stretches the single-photo hero wrapper to full width at a FIXED height', async () => {
        const view = await render(
            <EntryCard
                entry={baseEntry({
                    photos: [
                        { id: 9, entry_id: 1, file_path: 'file:///media/a.jpg', media_type: 'image' },
                    ],
                })}
                onEdit={noop}
                onDelete={noop}
                onToggleStar={noop}
                colors={colors}
            />
        );
        // The single-photo Pressable carries the stretch style + its "View photo 1"
        // label (the multi-photo strip would have no stretched wrapper).
        const heroBtn = view.getByLabelText('View photo 1');
        expect(styleOf(heroBtn).alignSelf).toBe('stretch');
        const heights = collectByStyle(view.toJSON(), (s) => s.height === PHOTO_HERO_HEIGHT);
        expect(heights.length).toBeGreaterThan(0);
    });
});

describe('EntryCard — recycled into another entry (FlashList re-uses the instance)', () => {
    const colors: any = (jest.requireMock('@/styles/global') as any).useThemeColors();

    it("does not carry an open delete strip over to the next entry", async () => {
        const card = (id: number) => (
            <EntryCard entry={baseEntry({ id })} onEdit={noop} onDelete={noop} onToggleStar={noop} colors={colors} />
        );
        const view = await render(card(1));
        await fireEvent.press(view.getByLabelText('More actions'));
        expect(view.queryByLabelText('Delete entry')).not.toBeNull();

        // Same instance, same entry: a parent re-render must NOT close it.
        await view.rerender(card(1));
        expect(view.queryByLabelText('Delete entry')).not.toBeNull();

        // Recycled to entry 2: a stray tap must not delete an entry the user never
        // opened.
        await view.rerender(card(2));
        expect(view.queryByLabelText('Delete entry')).toBeNull();
    });
});

describe('EntryCard — star toggle', () => {
    const colors: any = (jest.requireMock('@/styles/global') as any).useThemeColors();

    it('shows an UNSTARRED (outline) star when starred_at is null: "Star entry", not selected', async () => {
        const view = await render(
            <EntryCard
                entry={baseEntry({ starred_at: null })}
                onEdit={noop}
                onDelete={noop}
                onToggleStar={noop}
                colors={colors}
            />
        );
        const btn = view.getByTestId('entry-star-toggle');
        expect(view.getByLabelText('Star entry')).toBeTruthy();
        expect(view.queryByLabelText('Unstar entry')).toBeNull();
        expect(btn.props.accessibilityState).toMatchObject({ selected: false });
    });

    it('shows a STARRED (filled, accent-tinted) star when starred_at is set: "Unstar entry", selected', async () => {
        const view = await render(
            <EntryCard
                entry={baseEntry({ starred_at: '2026-07-20T10:00:00.000Z' })}
                onEdit={noop}
                onDelete={noop}
                onToggleStar={noop}
                colors={colors}
            />
        );
        const btn = view.getByTestId('entry-star-toggle');
        expect(view.getByLabelText('Unstar entry')).toBeTruthy();
        expect(btn.props.accessibilityState).toMatchObject({ selected: true });
        // The filled star is the only glyph tinted with the pure accent color —
        // proves the starred branch renders the accent-colored (filled) icon.
        const accentGlyphs = collectByStyle(view.toJSON(), (s) => s.color === THEME_ACCENT);
        expect(accentGlyphs.length).toBeGreaterThan(0);
    });

    it('fires onToggleStar exactly once when the star button is pressed', async () => {
        const onToggleStar = jest.fn();
        const view = await render(
            <EntryCard
                entry={baseEntry()}
                onEdit={noop}
                onDelete={noop}
                onToggleStar={onToggleStar}
                colors={colors}
            />
        );
        fireEvent.press(view.getByTestId('entry-star-toggle'));
        expect(onToggleStar).toHaveBeenCalledTimes(1);
    });
});
