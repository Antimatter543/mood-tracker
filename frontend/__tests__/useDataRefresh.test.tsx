/**
 * Unit tests for useDataRefresh — the reload hook behind every data-reading
 * screen/widget (see hooks/useDataRefresh.ts header).
 *
 * The hook owns TWO refresh vectors, tested here as separate contracts:
 *   VECTOR 1 — FOCUS GAIN: `useFocusEffect` runs the loader on mount/refocus.
 *   VECTOR 2 — DATA CHANGED WHILE MOUNTED: a `useEffect` keyed on the external
 *              data version reloads a mounted screen the moment data changes.
 *
 * The reload signal is an EXTERNAL store (`useDataVersion`), NOT a context value:
 * a `refreshCount` threaded through DataContext did not reach the tab screens for
 * in-place updates (device-proven 2026-07-13 — see context/dataRefreshStore.ts).
 * Here we mock `useDataVersion` as a test-controlled number and assert: a mounted
 * screen reloads on every version change, and does not double-load on mount.
 * (Frozen-tab skipping is the navigator's job via react-freeze — a component that
 * isn't mounted/committed doesn't run effects — so it's out of scope for a plain
 * renderHook unit test, which never freezes.)
 *
 * `useFocusEffect` is mocked as a faithful FOCUS-GAIN-only stand-in: run once on
 * mount (deps `[]`), so it does NOT double VECTOR 2 on a version bump.
 */
import React from 'react';
import { renderHook, act } from '@testing-library/react-native';

import { useDataRefresh } from '@/hooks/useDataRefresh';

// ── Mock expo-router: useFocusEffect = focus-gain-once ───────────────────────
jest.mock('expo-router', () => {
    const ReactActual = require('react') as typeof React;
    return {
        useFocusEffect: (cb: () => void | (() => void)) => {
            // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only = "focus gain once"; the ref keeps the latest cb without re-running
            const ref = ReactActual.useRef(cb);
            ref.current = cb;
            ReactActual.useEffect(() => ref.current(), []);
        },
    };
});

// ── Mock the external data-version store so we control the reload signal ──────
let mockDataVersion = 0;
jest.mock('@/context/dataRefreshStore', () => ({
    useDataVersion: () => mockDataVersion,
}));

beforeEach(() => {
    mockDataVersion = 0;
});

describe('useDataRefresh', () => {
    it('runs the loader exactly once on the initial mount (VECTOR 1 only, no VECTOR 2 double-load)', async () => {
        const load = jest.fn();
        await renderHook(() => useDataRefresh(load, []));
        // VECTOR 1 loads once on focus-gain; VECTOR 2 skips the initial mount.
        expect(load).toHaveBeenCalledTimes(1);
    });

    it('re-runs the loader when the data version changes (the live in-place update — the bug this fixes)', async () => {
        const load = jest.fn();
        const { rerender } = await renderHook(() => useDataRefresh(load, []));
        expect(load).toHaveBeenCalledTimes(1); // mount

        // A write elsewhere (e.g. adding a mood on Home) bumps the data version.
        // VECTOR 2 fires because this screen is mounted — the exact path the
        // Home-doesn't-update bug broke.
        await act(async () => {
            mockDataVersion = 1;
            rerender({});
        });
        expect(load).toHaveBeenCalledTimes(2);

        await act(async () => {
            mockDataVersion = 2;
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

    it('produces a fresh loader cleanup on each VECTOR 2 reload', async () => {
        const cleanups: jest.Mock[] = [];
        const load = jest.fn(() => {
            const c = jest.fn();
            cleanups.push(c);
            return c;
        });
        const { rerender } = await renderHook(() => useDataRefresh(load, []));
        expect(load).toHaveBeenCalledTimes(1); // mount (VECTOR 1)

        await act(async () => {
            mockDataVersion = 1;
            rerender({});
        });
        expect(load).toHaveBeenCalledTimes(2);
        expect(cleanups.length).toBeGreaterThanOrEqual(2);
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
