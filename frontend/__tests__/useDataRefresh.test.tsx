/**
 * Unit tests for useDataRefresh — the focus-aware data-reload hook that replaced
 * the freeze-fragile `useEffect(() => load(), [db, refreshCount])` pattern across
 * every data-reading screen/widget (see hooks/useDataRefresh.ts header).
 *
 * The hook delegates to expo-router's `useFocusEffect`, whose real behaviour is:
 *   - run the effect once when the route gains focus, and
 *   - re-run it whenever the memoized callback's IDENTITY changes while focused.
 * (Confirmed against node_modules/expo-router/build/useFocusEffect.js: the inner
 * React.useEffect deps are `[effect, navigation, optionalNavigation]`, so a new
 * `effect` identity re-runs it; the returned function is forwarded as the
 * blur/unmount cleanup only when it's `undefined` or a function.)
 *
 * We mock `useFocusEffect` with a faithful stand-in — `React.useEffect(() => cb(),
 * [cb])` — which reproduces exactly that contract (run on mount = "focus", re-run
 * when the callback identity changes, and forward the callback's return as the
 * effect cleanup). That lets us assert both refresh vectors with a real render.
 */
import React from 'react';
import { renderHook, act } from '@testing-library/react-native';

import { useDataRefresh } from '@/hooks/useDataRefresh';

// ── Mock expo-router's useFocusEffect ────────────────────────────────────────
// Stand-in that mirrors the real hook's observable contract: invoke the memoized
// callback on mount and again whenever its identity changes, forwarding its
// return value as the React effect cleanup (so a cleanup fn runs on "blur"/unmount).
jest.mock('expo-router', () => {
    const ReactActual = require('react') as typeof React;
    return {
        useFocusEffect: (cb: () => void | (() => void)) => {
            ReactActual.useEffect(() => cb(), [cb]);
        },
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
});

describe('useDataRefresh', () => {
    it('runs the loader once on focus (initial mount)', async () => {
        const load = jest.fn();
        await renderHook(() => useDataRefresh(load, []));
        expect(load).toHaveBeenCalledTimes(1);
    });

    it('re-runs the loader when refreshCount changes (live in-focus update)', async () => {
        const load = jest.fn();
        const { rerender } = await renderHook(() => useDataRefresh(load, []));
        expect(load).toHaveBeenCalledTimes(1);

        // A write elsewhere bumps the global refreshCount. The hook's wrapped
        // callback identity changes -> the (mock) focus effect re-runs the loader.
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

    it('re-runs when an extraDep changes (e.g. a timeframe prop)', async () => {
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

        // Re-render with the same refreshCount + deps: the wrapped callback keeps
        // its identity, so the focus effect does not re-fire.
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

        // Unmount = "blur" in the real hook -> the forwarded cleanup must run.
        await act(async () => {
            unmount();
        });
        expect(cleanup).toHaveBeenCalledTimes(1);
    });

    it('swallows a Promise return from an async loader (no Promise as cleanup)', async () => {
        // An async loader resolves to a Promise; useFocusEffect must NOT receive
        // it as a cleanup (the real hook console.errors on that). The hook returns
        // undefined for any non-function result, so unmount must not throw.
        const load = jest.fn(async () => {
            /* async work */
        });
        const { unmount } = await renderHook(() => useDataRefresh(load, []));
        expect(load).toHaveBeenCalledTimes(1);
        // If a Promise had leaked through as the cleanup, calling it on unmount
        // would throw "promise is not a function". It must unmount cleanly.
        await act(async () => {
            expect(() => unmount()).not.toThrow();
        });
    });
});
