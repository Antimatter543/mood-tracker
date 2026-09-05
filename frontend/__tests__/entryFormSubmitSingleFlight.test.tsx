/**
 * EntryForm, Submit is idempotent per gesture (duplicate-entry regression).
 *
 * Device QA 2026-09-05: ONE fast double-tap on the entry form's Submit created
 * two identical entries (count 35 -> 37). The `disabled` prop alone cannot stop
 * that, it only takes effect after React re-renders, and both presses of a
 * real double tap land in the same frame. The fix is `useSingleFlight`'s
 * synchronous ref gate inside EntryForm.
 *
 * These tests press Submit twice inside ONE `act` block. Nested `act` defers
 * the flush to the outermost call, so no re-render happens between the two
 * presses, i.e. the button is still visibly ENABLED for the second press,
 * exactly like the real gesture. Without the ref gate the write runs twice.
 */
import { render, fireEvent, act } from '@testing-library/react-native';

// ── keyboard height (EntryForm reads it for scroll padding) ──────────────────
jest.mock('@/hooks/useKeyboardHeight', () => ({ useKeyboardHeight: () => 0 }));

// ── reanimated: Animated.ScrollView -> a real RN ScrollView ──────────────────
jest.mock('react-native-reanimated', () => {
    const ReactActual = require('react');
    const RN = require('react-native');
    const entering = { duration: () => entering };
    return {
        __esModule: true,
        default: {
            ScrollView: ReactActual.forwardRef((props: any, ref: any) => {
                ReactActual.useImperativeHandle(ref, () => ({ scrollToEnd: jest.fn() }));
                return ReactActual.createElement(RN.ScrollView, props);
            }),
            View: (p: any) => ReactActual.createElement(RN.View, p),
        },
        FadeIn: entering,
        useAnimatedRef: () => ReactActual.useRef(null),
    };
});

// ── theme + settings + heavy children stubbed to keep the render light ───────
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

function deferred<T = void>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

async function renderOnDetailsStep(onSubmit: (data: any) => Promise<void>) {
    // RNTL 14: render/fireEvent are ASYNC. An un-awaited press silently does
    // nothing, so every navigation press below is awaited.
    const view = await render(<EntryForm onSubmit={onSubmit} onCancel={jest.fn()} />);
    await act(async () => {
        await fireEvent.press(view.getByText('Continue'));
    });
    return view;
}

/** The Submit button's host node (the only one carrying an accessibilityState.busy). */
function submitHost(view: any) {
    const matches = view.container.queryAll(
        (n: any) => typeof n.props?.accessibilityState?.busy === 'boolean'
    );
    return matches[0];
}

describe('EntryForm, Submit single-flight (no duplicate entries)', () => {
    it('writes ONCE when Submit is pressed twice in the same frame', async () => {
        const gate = deferred();
        const onSubmit = jest.fn(() => gate.promise);
        const view = await renderOnDetailsStep(onSubmit);
        const submit = view.getByText('Submit');

        // BOTH presses dispatched before either is awaited - the double tap.
        // Without the single-flight gate the button is only ever disabled by
        // `!isValid`, so the second press reaches the write and the entry is
        // saved twice (device QA 2026-09-05).
        await act(async () => {
            const first = fireEvent.press(submit);
            const second = fireEvent.press(submit);
            gate.resolve();
            await Promise.all([first, second]);
        });

        expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    it('marks the Submit button disabled + busy while the write is in flight', async () => {
        const gate = deferred();
        const onSubmit = jest.fn(() => gate.promise);
        const view = await renderOnDetailsStep(onSubmit);

        // Non-vacuous baseline: the button starts enabled and not busy.
        expect(submitHost(view).props.accessibilityState).toEqual({ disabled: false, busy: false });

        // NOT awaited here: the press does not resolve until the write does,
        // and the write is deliberately parked on `gate`.
        let pressed!: Promise<void>;
        await act(async () => {
            pressed = fireEvent.press(view.getByText('Submit'));
        });
        expect(submitHost(view).props.accessibilityState).toEqual({ disabled: true, busy: true });

        await act(async () => {
            gate.resolve();
            await pressed;
        });
        expect(submitHost(view).props.accessibilityState).toEqual({ disabled: false, busy: false });
    });

    it('re-enables after a FAILED write so a second press writes again', async () => {
        const onSubmit = jest
            .fn<Promise<void>, [any]>()
            .mockRejectedValueOnce(new Error('db is locked'))
            .mockResolvedValueOnce(undefined);
        const view = await renderOnDetailsStep(onSubmit);

        await act(async () => {
            await fireEvent.press(view.getByText('Submit'));
        });
        // The draft hook swallows the rejection; the button must come back.
        expect(onSubmit).toHaveBeenCalledTimes(1);
        expect(submitHost(view).props.accessibilityState).toEqual({ disabled: false, busy: false });

        await act(async () => {
            await fireEvent.press(view.getByText('Submit'));
        });
        expect(onSubmit).toHaveBeenCalledTimes(2);
    });
});
