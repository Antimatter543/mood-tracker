/**
 * The FAB ("Add mood entry") must float ABOVE the bottom safe-area so it never
 * overlaps the Android nav buttons / gesture pill. We mock useSafeAreaInsets to
 * a 3-button-nav inset (48dp) and assert the floating button's `bottom` is the
 * base gap (24) PLUS the inset. Math, not pixels.
 *
 * jest-expo's safe-area is NOT auto-mocked and its default insets are all 0, so
 * we mock the module explicitly to return a non-zero bottom (mirrors a real
 * Pixel 3 in 3-button mode).
 */
import React from 'react';
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

const styleOf = (node: any) => StyleSheet.flatten(node?.props?.style) || {};

describe('AddEntryButton — bottom safe-area float', () => {
    it('floats the FAB at (24 + insetBottom) above the bottom edge', async () => {
        const view: RenderResult = await render(<AddEntryButton />);
        // The floating button is the round 56x56 absolute accent circle.
        const fabs = view.container.queryAll((node: any) => {
            const s = styleOf(node);
            return s.width === 56 && s.height === 56 && s.position === 'absolute';
        });
        expect(fabs).toHaveLength(1);

        const fab = styleOf(fabs[0]);
        expect(fab.bottom).toBe(24 + 48); // base gap + 3-button-nav inset
        // Honors the right-hand fab_position from settings.
        expect(fab.right).toBe(24);
    });
});
