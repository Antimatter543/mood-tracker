/**
 * Unit tests for the external data-version store (context/dataRefreshStore.ts) —
 * the cross-screen "a write happened, reload" signal that replaced the
 * DataContext `refreshCount` (which did not propagate to the bottom-tab screens
 * for in-place updates; device-proven 2026-07-13).
 *
 * Contract: `useDataVersion()` returns a number that CHANGES every time
 * `bumpDataVersion()` is called, re-rendering every subscribed component. The
 * absolute value is meaningless — only that it changes on each bump.
 */
import { renderHook, act } from '@testing-library/react-native';

import { bumpDataVersion, useDataVersion } from '@/context/dataRefreshStore';

describe('dataRefreshStore', () => {
    it('changes the version a subscriber reads on each bump', async () => {
        const { result } = await renderHook(() => useDataVersion());
        const start = result.current;

        await act(async () => {
            bumpDataVersion();
        });
        expect(result.current).not.toBe(start);
        const afterOne = result.current;

        await act(async () => {
            bumpDataVersion();
        });
        expect(result.current).not.toBe(afterOne);
    });

    it('increments monotonically (each bump = a distinct, later value)', async () => {
        const { result } = await renderHook(() => useDataVersion());
        const v0 = result.current;
        await act(async () => {
            bumpDataVersion();
        });
        const v1 = result.current;
        await act(async () => {
            bumpDataVersion();
        });
        const v2 = result.current;
        // Strictly increasing — a superseding write can't read as an older value.
        expect(v1).toBeGreaterThan(v0);
        expect(v2).toBeGreaterThan(v1);
    });

    it('notifies EVERY subscribed screen from a single bump (fan-out)', async () => {
        // Two independent screens both subscribe; one write must reload both.
        const a = await renderHook(() => useDataVersion());
        const b = await renderHook(() => useDataVersion());
        const a0 = a.result.current;
        const b0 = b.result.current;

        await act(async () => {
            bumpDataVersion();
        });

        expect(a.result.current).not.toBe(a0);
        expect(b.result.current).not.toBe(b0);
        // Both read the SAME new version (one shared store, not per-screen state).
        expect(a.result.current).toBe(b.result.current);
    });

    it('stops notifying a screen once it unmounts (no leak / no post-unmount reload)', async () => {
        const live = await renderHook(() => useDataVersion());
        const gone = await renderHook(() => useDataVersion());
        gone.unmount();

        // A bump after unmount must not throw (unsubscribe cleaned up) and must
        // still reach the live subscriber.
        const before = live.result.current;
        await act(async () => {
            expect(() => bumpDataVersion()).not.toThrow();
        });
        expect(live.result.current).not.toBe(before);
    });
});
