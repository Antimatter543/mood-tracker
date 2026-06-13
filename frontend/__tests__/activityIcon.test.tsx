/**
 * Tests for the shared ActivityIcon glyph renderer (extracted from
 * timeline/ActivityRow so the Timeline + Home recent-activities card map
 * (icon_family, icon_name) -> glyph the same way).
 *
 * Guards the three mapping branches that matter for correctness:
 *   - Emoji family  -> the emoji rendered as plain Text (icon_name IS the emoji),
 *   - a known vector family -> THAT family's component, with the requested name
 *     forwarded (NOT the Feather `circle` fallback),
 *   - unknown/missing family -> the Feather `circle` fallback (never the bogus
 *     name reaching a glyph, which on device renders "?", and never a crash).
 *
 * jest-expo renders the real @expo/vector-icons as a <Text> that drops the
 * `name`/family props, so we can't assert the mapping on the rendered glyph.
 * Instead we mock the iconRegistry's ICON_FAMILIES with sentinel components
 * that tag themselves with `testID`s carrying the family + received name — this
 * tests ActivityIcon's actual DECISION (which component, which name) rather than
 * jest-expo's icon mock.
 */
import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';

/** Depth-first: collect the fontFamily off every node's flattened style. */
const collectFontFamilies = (json: any, out: string[] = []): string[] => {
    if (!json || typeof json !== 'object') return out;
    const s = StyleSheet.flatten(json.props?.style) as { fontFamily?: string } | undefined;
    if (s?.fontFamily) out.push(s.fontFamily);
    const kids = json.children;
    if (Array.isArray(kids)) for (const k of kids) collectFontFamilies(k, out);
    return out;
};

// Sentinel family components: each renders a Text whose testID encodes the
// family it stands for and the icon name it was handed. Shape mirrors the real
// registry entries: `{ component: <module with a `default` export> }`.
const makeFamily = (family: string) => ({
    default: ({ name }: { name: string }) =>
        React.createElement(Text, { testID: `glyph:${family}:${name}` }, family),
});

jest.mock('@/components/iconRegistry', () => ({
    ICON_FAMILIES: {
        Feather: { component: makeFamily('Feather') },
        MaterialCommunityIcons: { component: makeFamily('MaterialCommunityIcons') },
        MaterialIcons: { component: makeFamily('MaterialIcons') },
        FontAwesome6: { component: makeFamily('FontAwesome6') },
        Emoji: { component: null },
    },
}));

import { ActivityIcon } from '@/components/activityIcon';

describe('ActivityIcon — family mapping', () => {
    it('renders an Emoji family as plain text (the emoji itself), no glyph component', async () => {
        const view = await render(
            <ActivityIcon iconName="😊" iconFamily="Emoji" color="#aaa" />
        );
        expect(view.getByText('😊')).toBeTruthy();
        // No family glyph component should be used for an emoji.
        expect(view.queryByTestId(/^glyph:/)).toBeNull();
    });

    it('renders a known vector family with its OWN component and the requested name', async () => {
        const view = await render(
            <ActivityIcon iconName="coffee" iconFamily="Feather" color="#aaa" />
        );
        // Feather's component got the name "coffee" (not the circle fallback).
        expect(view.getByTestId('glyph:Feather:coffee')).toBeTruthy();
        expect(view.queryByTestId('glyph:Feather:circle')).toBeNull();
    });

    it('routes a MaterialCommunityIcons name to the MCI component', async () => {
        const view = await render(
            <ActivityIcon iconName="run" iconFamily="MaterialCommunityIcons" color="#aaa" />
        );
        expect(view.getByTestId('glyph:MaterialCommunityIcons:run')).toBeTruthy();
    });

    it('falls back to the (real) Feather circle glyph for an unknown family', async () => {
        const view = await render(
            <ActivityIcon iconName="whatever" iconFamily="NotARealFamily" color="#aaa" />
        );
        // The fallback uses the directly-imported Feather (NOT a registry
        // sentinel) — so NO registry glyph component is selected, and the bogus
        // requested name never reaches a registry component (would render "?").
        expect(view.queryByTestId(/^glyph:/)).toBeNull();
        // It rendered the real Feather glyph: jest-expo renders vector icons as
        // a <Text> tagged with the family's fontFamily.
        expect(collectFontFamilies(view.toJSON())).toContain('feather');
    });
});
