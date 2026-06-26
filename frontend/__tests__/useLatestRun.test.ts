/**
 * Unit tests for useLatestRun — the run-sequence latch that guards Home's
 * fetchData against out-of-order completion.
 *
 * useDataRefresh ignores fetchData's returned Promise, so two overlapping
 * invocations can resolve in either order; without this latch the older run's
 * stale results overwrite the newer run's setState. The latch lets ONLY the most
 * recently started run commit. These tests pin that contract at the unit level
 * (the integration is the 3-line guard in app/(tabs)/index.tsx).
 */
import { renderHook, act } from '@testing-library/react-native';

import { useLatestRun } from '@/hooks/useLatestRun';

describe('useLatestRun', () => {
  it('marks the most recently begun run as the latest', async () => {
    const { result } = await renderHook(() => useLatestRun());

    let id1 = 0;
    await act(async () => {
      id1 = result.current.begin();
    });
    expect(result.current.isLatest(id1)).toBe(true);
  });

  it('invalidates an earlier run once a later run begins (out-of-order guard)', async () => {
    const { result } = await renderHook(() => useLatestRun());

    let runA = 0;
    let runB = 0;
    await act(async () => {
      runA = result.current.begin(); // run A starts (e.g. focus gained)
      runB = result.current.begin(); // run B starts before A finished
    });

    // B is the latest; A is now stale and must be dropped if it resolves late.
    expect(result.current.isLatest(runB)).toBe(true);
    expect(result.current.isLatest(runA)).toBe(false);
  });

  it('returns strictly increasing ids', async () => {
    const { result } = await renderHook(() => useLatestRun());

    const ids: number[] = [];
    await act(async () => {
      ids.push(result.current.begin());
      ids.push(result.current.begin());
      ids.push(result.current.begin());
    });

    expect(ids[1]).toBeGreaterThan(ids[0]);
    expect(ids[2]).toBeGreaterThan(ids[1]);
    // Only the final id is "latest".
    expect(result.current.isLatest(ids[2])).toBe(true);
    expect(result.current.isLatest(ids[0])).toBe(false);
  });

  it('begin/isLatest identities are stable across re-renders (safe in dep arrays)', async () => {
    const { result, rerender } = await renderHook(() => useLatestRun());
    const firstBegin = result.current.begin;
    const firstIsLatest = result.current.isLatest;

    await act(async () => {
      rerender({});
    });

    expect(result.current.begin).toBe(firstBegin);
    expect(result.current.isLatest).toBe(firstIsLatest);
  });

  it('models the fetchData race: the slow earlier run does not clobber the fast later run', async () => {
    // Simulate the exact Home shape: each "fetchData" begins a run, awaits, then
    // commits only if still latest. Run A (slow) starts first, Run B (fast)
    // starts second and commits first; when A finally resolves it must be a no-op.
    const { result } = await renderHook(() => useLatestRun());
    const committed: string[] = [];

    const fakeFetch = async (label: string, settle: Promise<void>) => {
      const runId = result.current.begin();
      await settle;
      if (!result.current.isLatest(runId)) return; // stale -> drop
      committed.push(label);
    };

    let resolveA!: () => void;
    let resolveB!: () => void;
    const settleA = new Promise<void>((r) => (resolveA = r));
    const settleB = new Promise<void>((r) => (resolveB = r));

    // Both runs begin (synchronously, A then B) before either settles. Kicking
    // them off inside act lets the begin() calls run; the awaits inside each
    // fakeFetch suspend on the unresolved settle promises.
    let pA!: Promise<void>;
    let pB!: Promise<void>;
    await act(async () => {
      pA = fakeFetch('A', settleA);
      pB = fakeFetch('B', settleB);
    });

    // B (the latest) resolves first and commits.
    await act(async () => {
      resolveB();
      await pB;
    });
    expect(committed).toEqual(['B']);

    // A (stale) resolves later and must NOT commit (no clobber back to A's data).
    await act(async () => {
      resolveA();
      await pA;
    });
    expect(committed).toEqual(['B']);
  });
});
