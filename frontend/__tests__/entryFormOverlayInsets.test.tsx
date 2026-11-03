/**
 * The entry-form overlay owns BOTH safe-area insets, each applied exactly once.
 *
 * The overlay is StyleSheet.absoluteFill at the window root, so under
 * edge-to-edge it is drawn behind the status bar AND the nav bar. A community
 * fix (#20) correctly added the insets, but applied the top one three times
 * (header padding, the InfoBubble, and the form's scroll content), which put a
 * second status-bar-sized gap between the header and the form on every step,
 * and doubled the horizontal gutter to 40px. These tests pin the shape:
 *   - the top inset appears on ONE node (the overlay container), so the header
 *     and the scroll area both sit below it once;
 *   - the form's scroll content keeps its own 8px top / 20px side padding;
 *   - the bottom inset (and the keyboard height on top of it) pads the scroll
 *     content, so Submit can scroll clear of the nav bar and the keyboard.
 */
import { render, act } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { setInsets, setKeyboardHeight } from '@/testing/platform';
import { THEME } from '@/testing/theme';

const TOP = 30;
const BOTTOM = 48;

jest.mock('@/styles/global', () => require('@/testing/theme').mockThemeModule());
jest.mock('@/context/SettingsContext', () => ({
    useSettings: () => ({
        settings: { mood_precision: 'integer', show_mood_benchmarks: false, fab_position: 'right' },
    }),
}));
jest.mock('../components/forms/MoodSelector', () => {
    const ReactActual = require('react');
    const { Text } = require('react-native');
    return { __esModule: true, default: () => ReactActual.createElement(Text, null, 'mood-selector') };
});
jest.mock('../components/forms/DatePicker', () => {
    const ReactActual = require('react');
    const { Text } = require('react-native');
    return { DatePicker: () => ReactActual.createElement(Text, null, 'date-picker') };
});
jest.mock('../components/forms/ActivitySelector', () => {
    const ReactActual = require('react');
    const { Text } = require('react-native');
    return { ActivitySelector: () => ReactActual.createElement(Text, null, 'activity-selector') };
});

import { OverlayProvider } from '@/context/OverlayHost';
import { EntryFormModal } from '@/components/forms/EntryForm';

const flat = (node: any) => StyleSheet.flatten(node?.props?.style) || {};

async function renderOverlay() {
    const view = await render(
        <OverlayProvider>
            <EntryFormModal visible onClose={jest.fn()} onSubmit={jest.fn()} />
        </OverlayProvider>
    );
    await act(async () => {});
    return view;
}

function formScroll(view: any) {
    const matches = view.container.queryAll(
        (n: any) => n.props?.keyboardShouldPersistTaps === 'handled'
    );
    expect(matches).toHaveLength(1);
    return StyleSheet.flatten(matches[0].props.contentContainerStyle) || {};
}

// The status-bar inset is deliberately not Pixel's 24dp (INSETS.THREE_BUTTON_NAV): a distinct
// value makes the "applied exactly once" carrier query unambiguous. Bottom is the 3-button nav bar.
beforeEach(() => setInsets({ top: TOP, bottom: BOTTOM }));

describe('EntryForm overlay: safe-area insets applied once', () => {
    it('applies the top inset on exactly one node, the overlay container', async () => {
        const view = await renderOverlay();
        // Any node whose own top padding/offset is at least the inset is a
        // node that applied it. There must be exactly one.
        const carriers = view.container.queryAll((n: any) => {
            const s = flat(n);
            return (
                typeof n.type === 'string' &&
                (((s.paddingTop as number) ?? 0) >= TOP || ((s.top as number) ?? 0) >= TOP)
            );
        });
        expect(carriers).toHaveLength(1);
        const container = flat(carriers[0]);
        expect(container.position).toBe('absolute'); // the absoluteFill overlay root
        expect(container.paddingTop).toBe(TOP + 8);
    });

    it('keeps the form scroll content at its own 8px top padding', async () => {
        const view = await renderOverlay();
        expect(formScroll(view).paddingTop).toBe(8);
    });

    it('has a single 20px horizontal gutter (on the scroll content, not the overlay)', async () => {
        const view = await renderOverlay();
        expect(formScroll(view).paddingHorizontal).toBe(20);
        // The overlay root: the absoluteFill node painted with the theme
        // background. It must add no gutter of its own.
        const roots = view.container.queryAll((n: any) => {
            const s = flat(n);
            return typeof n.type === 'string' && s.position === 'absolute' && s.backgroundColor === THEME.background;
        });
        expect(roots).toHaveLength(1);
        const root = flat(roots[0]);
        expect(root.paddingHorizontal ?? 0).toBe(0);
        expect(root.paddingLeft ?? 0).toBe(0);
        expect(root.paddingRight ?? 0).toBe(0);
    });

    it('pads the scroll content by the bottom inset so Submit clears the nav bar', async () => {
        const view = await renderOverlay();
        expect(formScroll(view).paddingBottom).toBe(24 + BOTTOM);
    });

    it('adds the keyboard height on top of the bottom inset', async () => {
        setKeyboardHeight(804);
        const view = await renderOverlay();
        expect(formScroll(view).paddingBottom).toBe(24 + BOTTOM + 804);
    });
});
