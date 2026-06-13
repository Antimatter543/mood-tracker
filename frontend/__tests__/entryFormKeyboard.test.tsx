/**
 * EntryForm keyboard-handling tests (the empirically-correct fix).
 *
 * The release-APK failure: under enforced edge-to-edge the KeyboardAvoidingView
 * was a no-op — the Notes field stayed behind the keyboard and the form's
 * ScrollView stayed full-height (nothing to scroll). The fix is deterministic:
 *   (1) pad the ScrollView contentContainer by the keyboard height (so there's
 *       physical scroll RANGE above the keyboard), and
 *   (2) scrollToEnd when the Notes field focuses / the keyboard opens (so the
 *       focused field + Submit are brought into that padded region).
 *
 * Real occlusion is release-APK only; these assert the WIRING: the
 * contentContainer paddingBottom grows by the keyboard height, and focusing
 * Notes calls scrollToEnd on the ScrollView ref.
 */
import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';

// ── keyboard height: mockable so we can assert the padding math ──────────────
const mockKeyboardHeight = jest.fn(() => 0);
jest.mock('@/hooks/useKeyboardHeight', () => ({
    useKeyboardHeight: () => mockKeyboardHeight(),
}));

// ── reanimated: Animated.ScrollView -> a real RN ScrollView (so the ref exposes
//    scrollToEnd, which we spy on), FadeIn/useAnimatedRef stubbed. The spy lives
//    on a `mock`-prefixed holder so the (hoisted) jest.mock factory may close
//    over it (jest only allows out-of-scope refs named /^mock/). ──────────────
const mockScroll = { toEnd: jest.fn() };
jest.mock('react-native-reanimated', () => {
    const ReactActual = require('react');
    const RN = require('react-native');
    const entering = { duration: () => entering };
    return {
        __esModule: true,
        default: {
            // Forward the ref; expose our spy scrollToEnd on the instance.
            ScrollView: ReactActual.forwardRef((props: any, ref: any) => {
                ReactActual.useImperativeHandle(ref, () => ({
                    scrollToEnd: (...args: any[]) => mockScroll.toEnd(...args),
                }));
                return ReactActual.createElement(RN.ScrollView, props);
            }),
            View: (p: any) => ReactActual.createElement(RN.View, p),
        },
        FadeIn: entering,
        useAnimatedRef: () => ReactActual.useRef(null),
    };
});

// ── theme + settings + heavy form children stubbed to keep the render light ──
jest.mock('@/styles/global', () => {
    const actual = jest.requireActual('@/styles/global');
    return {
        ...actual,
        useThemeColors: () => ({
            background: '#000', cardBackground: '#111', secondaryBackground: '#222',
            text: '#fff', textSecondary: '#aaa', border: '#333', accent: '#4CAF50',
            overlays: { tag: '#222', tagBorder: '#333', border: '#333', textSecondary: '#aaa', textOnAccent: '#fff' },
            elevation: { shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, elevation: 6 },
            isDark: true,
        }),
    };
});
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
    mockScroll.toEnd.mockClear();
    mockKeyboardHeight.mockReturnValue(0);
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
        expect(mockScroll.toEnd).toHaveBeenCalled();
    });

    it('pads the scroll content by the keyboard height (gives scroll range)', async () => {
        // Base padding (keyboard hidden).
        mockKeyboardHeight.mockReturnValue(0);
        const base = await render(
            <EntryForm onSubmit={jest.fn()} onCancel={jest.fn()} />
        );
        const basePad = scrollPadding(base);

        // Keyboard up -> padding grows by exactly the keyboard height.
        mockKeyboardHeight.mockReturnValue(804);
        const withKb = await render(
            <EntryForm onSubmit={jest.fn()} onCancel={jest.fn()} />
        );
        expect(scrollPadding(withKb)).toBe(basePad + 804);
    });

    it('scrolls to the end when the keyboard opens on the details step', async () => {
        // Start on details with keyboard hidden.
        const view = await render(
            <EntryForm onSubmit={jest.fn()} onCancel={jest.fn()} />
        );
        await advanceToDetails(view);
        mockScroll.toEnd.mockClear();

        // Keyboard opens (re-render with a height) -> the effect scrolls to end.
        mockKeyboardHeight.mockReturnValue(804);
        await act(async () => {
            await view.rerender(<EntryForm onSubmit={jest.fn()} onCancel={jest.fn()} />);
        });
        expect(mockScroll.toEnd).toHaveBeenCalled();
    });
});

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
