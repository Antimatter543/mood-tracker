/**
 * EntryForm keyboard-handling tests (the empirically-correct fix).
 *
 * The release-APK failure: under enforced edge-to-edge the KeyboardAvoidingView
 * was a no-op — the Notes field stayed behind the keyboard and the form's
 * ScrollView stayed full-height (nothing to scroll). The fix is deterministic:
 *   (1) pad the ScrollView contentContainer by the keyboard height (so there's
 *       physical scroll RANGE above the keyboard), and
 *   (2) scrollToEnd when the Notes field focuses / the keyboard opens while
 *       Notes is focused (so the focused field + Submit are brought into that
 *       padded region). A keyboard opened by any other field (the activity
 *       dialogs autofocus their name field) must NOT drag the form to Notes.
 *
 * Real occlusion is release-APK only; these assert the WIRING: the
 * contentContainer paddingBottom grows by the keyboard height, and focusing
 * Notes calls scrollToEnd on the ScrollView ref.
 */
import { render, fireEvent, act } from '@testing-library/react-native';
import { setKeyboardHeight, animatedScroll } from '@/testing/platform';

// ── theme + settings + heavy form children stubbed to keep the render light ──
jest.mock('@/styles/global', () => require('@/testing/theme').mockThemeModule());
jest.mock('@/context/SettingsContext', () => ({
    useSettings: () => ({ settings: { mood_precision: 'integer', show_mood_benchmarks: false } }),
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
jest.mock('../components/InfoBubble', () => {
    const ReactActual = require('react');
    const { Text } = require('react-native');
    return { __esModule: true, default: () => ReactActual.createElement(Text, null, 'info-bubble') };
});

import { EntryForm } from '@/components/forms/EntryForm';

// Reach the details step: tap Continue on step 1.
async function advanceToDetails(view: any) {
    await act(async () => {
        fireEvent.press(view.getByText('Continue'));
    });
}

beforeEach(() => {
    jest.spyOn(global, 'requestAnimationFrame').mockImplementation((cb: any) => {
        cb();
        return 0 as any;
    });
});
afterEach(() => jest.restoreAllMocks());

describe('EntryForm — keyboard handling (deterministic)', () => {
    it('scrolls to the end when the Notes field focuses (lifts it above the keyboard)', async () => {
        const view = await render(
            <EntryForm onSubmit={jest.fn().mockResolvedValue(undefined)} onCancel={jest.fn()} />
        );
        await advanceToDetails(view);

        const notes = view.getByPlaceholderText('How are you feeling?');
        await act(async () => {
            fireEvent(notes, 'focus');
        });
        expect(animatedScroll.toEnd).toHaveBeenCalled();
    });

    it('pads the scroll content by the keyboard height (gives scroll range)', async () => {
        // Base padding (keyboard hidden).
        const base = await render(
            <EntryForm onSubmit={jest.fn()} onCancel={jest.fn()} />
        );
        const basePad = scrollPadding(base);

        // Keyboard up -> padding grows by exactly the keyboard height.
        setKeyboardHeight(804);
        const withKb = await render(
            <EntryForm onSubmit={jest.fn()} onCancel={jest.fn()} />
        );
        expect(scrollPadding(withKb)).toBe(basePad + 804);
    });

    it('scrolls to the end when the keyboard opens for the focused Notes field', async () => {
        const view = await render(
            <EntryForm onSubmit={jest.fn()} onCancel={jest.fn()} />
        );
        await advanceToDetails(view);
        await act(async () => {
            fireEvent(view.getByPlaceholderText('How are you feeling?'), 'focus');
        });
        animatedScroll.toEnd.mockClear();

        await openKeyboard(view);
        expect(animatedScroll.toEnd).toHaveBeenCalled();
    });

    it('stays put when another field opens the keyboard (e.g. the edit-activity dialog)', async () => {
        const view = await render(
            <EntryForm onSubmit={jest.fn()} onCancel={jest.fn()} />
        );
        await advanceToDetails(view);
        animatedScroll.toEnd.mockClear();

        await openKeyboard(view);
        expect(animatedScroll.toEnd).not.toHaveBeenCalled();
    });

    it('stays put once Notes has lost focus', async () => {
        const view = await render(
            <EntryForm onSubmit={jest.fn()} onCancel={jest.fn()} />
        );
        await advanceToDetails(view);
        const notes = view.getByPlaceholderText('How are you feeling?');
        await act(async () => {
            fireEvent(notes, 'focus');
        });
        await act(async () => {
            fireEvent(notes, 'blur');
        });
        animatedScroll.toEnd.mockClear();

        await openKeyboard(view);
        expect(animatedScroll.toEnd).not.toHaveBeenCalled();
    });

    it('forgets the Notes focus when going Back to the mood step', async () => {
        const view = await render(
            <EntryForm onSubmit={jest.fn()} onCancel={jest.fn()} />
        );
        await advanceToDetails(view);
        await act(async () => {
            fireEvent(view.getByPlaceholderText('How are you feeling?'), 'focus');
        });
        await act(async () => {
            fireEvent.press(view.getByText('Back'));
        });
        await advanceToDetails(view);
        animatedScroll.toEnd.mockClear();

        await openKeyboard(view);
        expect(animatedScroll.toEnd).not.toHaveBeenCalled();
    });
});

// Keyboard opens: re-render with a height, as useKeyboardHeight would.
async function openKeyboard(view: any) {
    setKeyboardHeight(804);
    await act(async () => {
        await view.rerender(<EntryForm onSubmit={jest.fn()} onCancel={jest.fn()} />);
    });
}

// The ScrollView's contentContainerStyle is an array; flatten + read paddingBottom.
function scrollPadding(view: any): number {
    const { StyleSheet } = require('react-native');
    // The form's scroll is the only node carrying keyboardShouldPersistTaps;
    // container.queryAll walks the host tree (overlayHost.test.tsx pattern).
    const matches = view.container.queryAll(
        (n: any) => n.props?.keyboardShouldPersistTaps === 'handled'
    );
    const flat = StyleSheet.flatten(matches[0].props.contentContainerStyle) || {};
    return flat.paddingBottom;
}
