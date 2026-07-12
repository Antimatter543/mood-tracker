/**
 * Unit tests for useDataRefresh — the focus-aware data-reload hook behind every
 * data-reading screen/widget (see hooks/useDataRefresh.ts header).
 *
 * The hook owns TWO refresh vectors, tested here as separate contracts:
 *   VECTOR 1 — FOCUS GAIN: `useFocusEffect` runs the loader on mount/refocus.
 *   VECTOR 2 — DATA-CHANGED-WHILE-FOCUSED: an explicit `useEffect` keyed on
 *              `refreshCount`/`extraDeps`, gated by the reactive `useIsFocused()`,
 *              reloads the CURRENTLY-focused screen the moment data changes.
 *
 * VECTOR 2 exists because relying on `useFocusEffect`'s in-focus re-run (via a
 * changing callback identity) is unreliable for the already-focused screen on
 * expo-router v6 bottom-tabs — the "add a mood on Home, Home doesn't update until
 * you leave and return" bug. The `re-runs the loader when refreshCount changes
 * WHILE FOCUSED` and `does NOT re-run while blurred` cases below are the
 * regression guard for exactly that.
 *
 * We mock the two expo-router hooks:
 *   - `useFocusEffect` as a faithful FOCUS-GAIN-only stand-in: run once on mount
 *     (deps `[]`), so it does NOT double VECTOR 2 on a refreshCount bump. This
 *     mirrors what we now rely on — useFocusEffect for focus transitions, the
 *     explicit effect for live updates.
 *   - `useIsFocused` as a test-controlled boolean.
 */
import React from 'react';
import { renderHook, act } from '@testing-library/react-native';

import { useDataRefresh } from '@/hooks/useDataRefresh';

// ── Mocked focus state, flipped per test ─────────────────────────────────────
let mockIsFocused = true;

// ── Mock expo-router ─────────────────────────────────────────────────────────
// `useFocusEffect` models FOCUS GAIN only (run the memoized callback once on
// mount, forward its cleanup on unmount) — it deliberately does NOT re-run on
// callback-identity change, because VECTOR 2's explicit effect is what we rely on
// for in-focus data updates. `useIsFocused` returns the test-controlled flag.
jest.mock('expo-router', () => {
    const ReactActual = require('react') as typeof React;
    return {
        useFocusEffect: (cb: () => void | (() => void)) => {
            // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only = "focus gain once"; the ref keeps the latest cb without re-running
            const ref = ReactActual.useRef(cb);
            ref.current = cb;
            ReactActual.useEffect(() => ref.current(), []);
        },
        useIsFocused: () => mockIsFocused,
    };
});

// ── Mock the data context so we control refreshCount ─────────────────────────
let mockRefreshCount = 0;
jest.mock('@/context/DataContext', () => ({
    useDataContext: () => ({
        refreshCount: mockRefreshCount,
        refetchEntries: jest.fn(),
    }),
}));

beforeEach(() => {
    mockRefreshCount = 0;
    mockIsFocused = true;
});

describe('useDataRefresh', () => {
    it('runs the loader once on focus (initial mount)', async () => {
        const load = jest.fn();
        await renderHook(() => useDataRefresh(load, []));
        expect(load).toHaveBeenCalledTimes(1);
    });

    it('re-runs the loader when refreshCount changes WHILE FOCUSED (the live in-focus update)', async () => {
        const load = jest.fn();
        const { rerender } = await renderHook(() => useDataRefresh(load, []));
        expect(load).toHaveBeenCalledTimes(1); // mount

        // A write elsewhere bumps the global refreshCount. VECTOR 2 fires because
        // this screen is focused — this is the exact path the Home-doesn't-update
        // bug broke (previously it relied on useFocusEffect's flaky in-focus re-run).
        await act(async () => {
            mockRefreshCount = 1;
            rerender({});
        });
        expect(load).toHaveBeenCalledTimes(2);

        await act(async () => {
            mockRefreshCount = 2;
            rerender({});
        });
        expect(load).toHaveBeenCalledTimes(3);
    });

    it('does NOT re-run on a refreshCount change while BLURRED (frozen tab stays put)', async () => {
        mockIsFocused = false;
        const load = jest.fn();
        const { rerender } = await renderHook(() => useDataRefresh(load, []));
        // Mount still calls once via the focus-gain stand-in (models the screen
        // having been focused at least once); the important assertion is that a
        // blurred refreshCount bump does NOT reload.
        const afterMount = load.mock.calls.length;

        await act(async () => {
            mockRefreshCount = 1;
            rerender({});
        });
        // Blurred: VECTOR 2 is gated off — no extra reload. The screen will pick
        // the change up via VECTOR 1 (focus gain) when the user returns to it.
        expect(load).toHaveBeenCalledTimes(afterMount);
    });

    it('reloads when a blurred screen regains focus (VECTOR 1 covers what VECTOR 2 skipped)', async () => {
        mockIsFocused = false;
        const load = jest.fn();
        const { rerender } = await renderHook(() => useDataRefresh(load, []));
        load.mockClear();

        // Data changed while blurred (no reload), THEN the screen regains focus.
        await act(async () => {
            mockRefreshCount = 1;
            mockIsFocused = true;
            rerender({});
        });
        // isFocused flipped false→true with a changed refreshCount → VECTOR 2 fires.
        expect(load).toHaveBeenCalled();
    });

    it('re-runs when an extraDep changes while focused (e.g. a timeframe prop)', async () => {
        const load = jest.fn();
        let timeframe = 'week';
        const { rerender } = await renderHook(() =>
            useDataRefresh(load, [timeframe]),
        );
        expect(load).toHaveBeenCalledTimes(1);

        await act(async () => {
            timeframe = 'month';
            rerender({});
        });
        expect(load).toHaveBeenCalledTimes(2);
    });

    it('does NOT re-run when nothing relevant changes (stable identity)', async () => {
        const load = jest.fn();
        const { rerender } = await renderHook(() => useDataRefresh(load, []));
        expect(load).toHaveBeenCalledTimes(1);

        await act(async () => {
            rerender({});
        });
        expect(load).toHaveBeenCalledTimes(1);
    });

    it('forwards a cleanup function from the loader (runs on blur/unmount)', async () => {
        const cleanup = jest.fn();
        const load = jest.fn(() => cleanup);
        const { unmount } = await renderHook(() => useDataRefresh(load, []));
        expect(load).toHaveBeenCalledTimes(1);
        expect(cleanup).not.toHaveBeenCalled();

        await act(async () => {
            unmount();
        });
        expect(cleanup).toHaveBeenCalledTimes(1);
    });

    it('swallows a Promise return from an async loader (no Promise as cleanup)', async () => {
        const load = jest.fn(async () => {
            /* async work */
        });
        const { unmount } = await renderHook(() => useDataRefresh(load, []));
        expect(load).toHaveBeenCalledTimes(1);
        await act(async () => {
            expect(() => unmount()).not.toThrow();
        });
    });
});
