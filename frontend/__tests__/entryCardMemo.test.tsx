/**
 * EntryCard must bail out of re-rendering when its props are value-equal.
 *
 * Half of the third defect behind the 2026-09-13 Timeline scroll bug (the other
 * half — the Timeline actually handing out value-equal props — is
 * timelineListPerf.test.tsx, and each is useless without the other).
 *
 * Why this is a correctness problem and not a micro-optimisation: the Timeline's
 * SectionList keeps a large window mounted (no `getItemLayout`, so RN cannot
 * cheaply virtualize by height), and each page append fires THREE parent renders —
 * footer spinner on, new sections in, spinner off. Unmemoized, every one of those
 * rebuilt the view tree for every loaded card while the user's finger was still
 * dragging the list. On device RN said so itself: "VirtualizedList: You have a large
 * list that is slow to update - make sure your renderItem function renders
 * components that follow React performance best practices".
 *
 * Render counts are observed behaviourally, by counting the renders of a leaf the
 * card always renders (`Card`) — not by asserting on `React.memo`'s internals.
 */
import React from 'react';
import { render, act } from '@testing-library/react-native';

let mockCardBodyRenders = 0;
jest.mock('@/components/Card', () => {
    const ReactLocal = require('react');
    const { View } = require('react-native');
    return {
        Card: ({ children, ...rest }: any) => {
            mockCardBodyRenders += 1;
            return ReactLocal.createElement(View, rest, children);
        },
    };
});
// Leaves the card always renders; irrelevant to the render-count contract.
jest.mock('@/components/timeline/ActivityRow', () => ({ ActivityRow: () => null }));
jest.mock('@/components/timeline/EntryPhotos', () => ({ EntryPhotos: () => null }));

import { EntryCard } from '@/components/timeline/EntryCard';
import { MoodEntry } from '@/components/types';
import { ThemeColors } from '@/styles/global';

const COLORS = {
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
} as unknown as ThemeColors;

const entry = (over: Partial<MoodEntry> = {}): MoodEntry => ({
    id: 1,
    mood: 7,
    notes: 'a note',
    date: '2026-09-12T10:00:00.000Z',
    starred_at: null,
    activities: [],
    photos: [],
    ...over,
});

const noop = () => {};

describe('EntryCard — memoized so a parent re-render is not a whole-list re-render', () => {
    beforeEach(() => {
        mockCardBodyRenders = 0;
    });

    it('does NOT re-render when handed identical props again', async () => {
        const props = {
            entry: entry(),
            onEdit: noop,
            onDelete: noop,
            onToggleStar: noop,
            colors: COLORS,
        };
        const view = await render(<EntryCard {...props} />);
        expect(mockCardBodyRenders).toBe(1);

        await act(async () => {
            view.rerender(<EntryCard {...props} />);
        });
        // The bail-out. Pre-memo this was 2 — and in the real list, one extra render
        // of EVERY loaded card, three times per page append.
        expect(mockCardBodyRenders).toBe(1);
    });

    it('DOES re-render when its own entry changes', async () => {
        const shared = { onEdit: noop, onDelete: noop, onToggleStar: noop, colors: COLORS };
        const view = await render(<EntryCard entry={entry({ mood: 7 })} {...shared} />);
        expect(mockCardBodyRenders).toBe(1);

        await act(async () => {
            // A star toggle or an edit replaces the entry object wholesale, so the
            // card follows it. Memo is only safe BECAUSE rows are never mutated in
            // place — see the note on EntryCard.
            view.rerender(
                <EntryCard
                    entry={entry({ mood: 3, starred_at: '2026-09-12T11:00:00.000Z' })}
                    {...shared}
                />
            );
        });
        expect(mockCardBodyRenders).toBe(2);
    });

    it('re-renders if a callback identity changes — which is why the Timeline memoizes them', async () => {
        const base = { entry: entry(), onDelete: noop, onToggleStar: noop, colors: COLORS };
        const view = await render(<EntryCard {...base} onEdit={() => {}} />);
        expect(mockCardBodyRenders).toBe(1);
        await act(async () => {
            view.rerender(<EntryCard {...base} onEdit={() => {}} />);
        });
        // A shallow compare cannot see that two fresh closures do the same thing.
        // This is exactly the failure mode timelineListPerf.test.tsx guards at the
        // list level: a per-row `onEdit={() => onEdit(entry)}` would make memo a
        // no-op while LOOKING correct.
        expect(mockCardBodyRenders).toBe(2);
    });
});
