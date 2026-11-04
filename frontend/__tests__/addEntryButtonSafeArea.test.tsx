/**
 * The FAB ("Add mood entry") floats a fixed FAB_BOTTOM_GAP above the bottom of
 * the TAB SCENE and must NOT add the bottom safe-area inset.
 *
 * react-navigation lays the tab scene out above the tab bar (flex column, the
 * bar is not absolutely positioned), and the bar has already grown by the inset
 * (lib/tabBarStyle.ts). So the scene's bottom edge already clears the Android
 * nav buttons; the old `24 + insetBottom` floated the FAB a whole nav-bar
 * height (48dp on 3-button nav) too high. Fixed in #20.
 *
 * We set useSafeAreaInsets to a 3-button-nav inset (48dp) so a regression that
 * re-adds the inset fails loudly. Math, not pixels.
 */
import { render } from '@testing-library/react-native';
import type { RenderResult } from '@testing-library/react-native';
import { setInsets } from '@/testing/platform';
import { styleOf } from '@/testing/rntl';

jest.mock('@/styles/global', () => require('@/testing/theme').mockThemeModule());

jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => ({}) }));
jest.mock('@/context/DataContext', () => ({ useDataContext: () => ({ refetchEntries: jest.fn() }) }));
jest.mock('@/context/SettingsContext', () => ({
    useSettings: () => ({ settings: { fab_position: 'right' } }),
}));
// The entry-form modal is irrelevant here (it renders null when not visible);
// stub it so we don't pull the whole form + overlay host graph.
jest.mock('@/components/forms/EntryForm', () => ({
    EntryFormModal: () => null,
}));

// expo-router's ESM entry can't load under jest; the FAB only needs useFocusEffect.
jest.mock('expo-router', () => {
    const ReactActual = require('react');
    return { useFocusEffect: (cb: () => void) => ReactActual.useEffect(() => cb(), [cb]) };
});

import { AddEntryButton } from '@/components/AddEntryButton';
import { BACK_TO_TOP_BOTTOM, PILL_HEIGHT } from '@/components/timeline/BackToTopPill';
import { FAB_BOTTOM_GAP, FAB_SIZE, LAYOUT_FAB_CLEARANCE } from '@/styles/layout';

describe('AddEntryButton: float above the tab scene, no double-counted inset', () => {
    // 3-button-nav inset (Pixel 3). The whole point of the test.
    beforeEach(() => setInsets({ top: 0, bottom: 48 })); // top 0 as before; INSETS.THREE_BUTTON_NAV has top 24

    it('floats the FAB FAB_BOTTOM_GAP above the scene bottom, ignoring the 48dp inset', async () => {
        const view: RenderResult = await render(<AddEntryButton />);
        // The floating button is the round absolute accent circle.
        const fabs = view.container.queryAll((node: any) => {
            const s = styleOf(node);
            return s.width === FAB_SIZE && s.height === FAB_SIZE && s.position === 'absolute';
        });
        expect(fabs).toHaveLength(1);

        const fab = styleOf(fabs[0]);
        expect(fab.bottom).toBe(FAB_BOTTOM_GAP);
        expect(fab.bottom).toBe(24);
        // Honors the right-hand fab_position from settings.
        expect(fab.right).toBe(24);
    });

    it('keeps the FAB clearance consistent with the FAB geometry', () => {
        // Every tab scroller pads its tail by this; it must clear the FAB top.
        expect(LAYOUT_FAB_CLEARANCE).toBeGreaterThan(FAB_BOTTOM_GAP + FAB_SIZE);
    });

    it("centres the Timeline's back-to-top pill on the FAB's centre line", () => {
        expect(BACK_TO_TOP_BOTTOM + PILL_HEIGHT / 2).toBe(FAB_BOTTOM_GAP + FAB_SIZE / 2);
    });
});
