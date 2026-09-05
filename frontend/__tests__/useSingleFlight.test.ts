/**
 * useSingleFlight, the synchronous re-entrancy gate.
 *
 * The bug it exists for: a `disabled` prop only takes effect after a re-render,
 * so a rapid double-tap delivers BOTH presses before the button goes disabled
 * and both reach the awaited write (entry form, device QA 2026-09-05: one fast
 * double-tap took the entry count 35 -> 37). These tests drive `run` the way a
 * same-frame double tap does: twice, synchronously, with nothing awaited in
 * between.
 */
import { act, renderHook } from '@testing-library/react-native';

function deferred<T = void>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

import { useSingleFlight } from '@/hooks/useSingleFlight';

describe('useSingleFlight', () => {
    it('invokes the action ONCE for two synchronous calls', async () => {
        const gate = deferred();
        const fn = jest.fn(() => gate.promise);
        const { result } = await renderHook(() => useSingleFlight(fn));

        // Both calls happen before anything is awaited, the same-tick double tap.
        let first!: Promise<unknown>;
        let second!: Promise<unknown>;
        await act(async () => {
            first = result.current.run();
            second = result.current.run();
            gate.resolve();
            await Promise.all([first, second]);
        });

        expect(fn).toHaveBeenCalledTimes(1);
        // The suppressed call resolves undefined rather than throwing.
        await expect(second).resolves.toBeUndefined();
    });

    it('reports inFlight while the action is pending and clears it on settle', async () => {
        const gate = deferred();
        const fn = jest.fn(() => gate.promise);
        const { result } = await renderHook(() => useSingleFlight(fn));

        expect(result.current.inFlight).toBe(false);

        let pending!: Promise<unknown>;
        await act(async () => {
            pending = result.current.run();
        });
        expect(result.current.inFlight).toBe(true);

        await act(async () => {
            gate.resolve();
            await pending;
        });
        expect(result.current.inFlight).toBe(false);
    });

    it('releases the gate when the action REJECTS, so the caller can retry', async () => {
        const fn = jest
            .fn<Promise<string>, []>()
            .mockRejectedValueOnce(new Error('write failed'))
            .mockResolvedValueOnce('ok');
        const { result } = await renderHook(() => useSingleFlight(fn));

        await act(async () => {
            await expect(result.current.run()).rejects.toThrow('write failed');
        });
        expect(result.current.inFlight).toBe(false);

        // Second attempt actually runs (the gate did not stick shut).
        let retry!: string | undefined;
        await act(async () => {
            retry = await result.current.run();
        });
        expect(fn).toHaveBeenCalledTimes(2);
        expect(retry).toBe('ok');
    });

    it('allows a NEW call once the previous one has settled', async () => {
        const fn = jest.fn().mockResolvedValue(undefined);
        const { result } = await renderHook(() => useSingleFlight(fn));

        await act(async () => {
            await result.current.run();
        });
        await act(async () => {
            await result.current.run();
        });
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it('passes arguments through to the wrapped action', async () => {
        const fn = jest.fn(async (a: number, b: string) => `${a}:${b}`);
        const { result } = await renderHook(() => useSingleFlight(fn));

        let out: string | undefined;
        await act(async () => {
            out = await result.current.run(7, 'x');
        });
        expect(fn).toHaveBeenCalledWith(7, 'x');
        expect(out).toBe('7:x');
    });
});
