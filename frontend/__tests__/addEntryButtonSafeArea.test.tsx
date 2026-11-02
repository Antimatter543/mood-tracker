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
 * We mock useSafeAreaInsets to a 3-button-nav inset (48dp) so a regression that
 * re-adds the inset fails loudly. Math, not pixels. jest-expo's safe-area is NOT
 * auto-mocked, so the module is mocked explicitly.
 */
import { render } from '@testing-library/react-native';
import type { RenderResult } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

const THEME = {
    background: '#000',
    cardBackground: '#111',
    secondaryBackground: '#222',
    text: '#fff',
    textSecondary: '#aaa',
    border: '#333',
    accent: '#4CAF50',
    overlays: { tag: '#222', tagBorder: '#333', border: '#333', textSecondary: '#aaa' },
    elevation: { shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, elevation: 6 },
    isDark: true,
};

// 3-button-nav inset (Pixel 3). The whole point of the test.
jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 48, left: 0, right: 0 }),
}));

// reanimated worklets runtime is unavailable under jest. Shim the exact surface
// AddEntryButton uses: createAnimatedComponent (passthrough to the base comp),
// useAnimatedStyle/useSharedValue/withSpring.
jest.mock('react-native-reanimated', () => ({
    __esModule: true,
    default: {
        createAnimatedComponent: (Comp: any) => Comp,
    },
    useAnimatedStyle: (fn: () => any) => fn(),
    useSharedValue: (v: any) => ({ value: v }),
    withSpring: (v: any) => v,
}));

jest.mock('@/styles/global', () => {
    const actual = jest.requireActual('@/styles/global');
    return { ...actual, useThemeColors: () => THEME };
});

// Stub the contexts + DB the FAB consumes (we only care about its float style).
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

import { AddEntryButton } from '@/components/AddEntryButton';
import { BACK_TO_TOP_BOTTOM, PILL_HEIGHT } from '@/components/timeline/BackToTopPill';
import { FAB_BOTTOM_GAP, FAB_SIZE, LAYOUT_FAB_CLEARANCE } from '@/styles/layout';

const styleOf = (node: any) => StyleSheet.flatten(node?.props?.style) || {};

describe('AddEntryButton: float above the tab scene, no double-counted inset', () => {
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
