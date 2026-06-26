import { useCallback, useRef } from 'react';

/**
 * A run-sequence latch for guarding async work against out-of-order completion.
 *
 * WHY THIS EXISTS — an async loader fired by `useDataRefresh` (e.g. Home's
 * `fetchData`) returns a Promise that the hook intentionally ignores (it can't
 * cancel it; see hooks/useDataRefresh.ts). So two overlapping invocations — a
 * rapid focus change, or a `refreshCount` bump that re-runs the loader while a
 * previous run is still awaiting its `Promise.all(...)` of DB reads — can resolve
 * in EITHER order. If the older run resolves last, its (stale) results overwrite
 * the newer run's `setState` calls, and the screen shows stale/empty data. With
 * this branch's DB-transaction fix the reads no longer come back corrupt, but
 * the last-writer-wins clobber is an independent ordering bug; this latch closes
 * it so only the most recent invocation is allowed to commit state.
 *
 * Usage:
 *   const { begin, isLatest } = useLatestRun();
 *   const load = useCallback(async () => {
 *     const runId = begin();
 *     const data = await fetchEverything();
 *     if (!isLatest(runId)) return;   // a newer load() started; drop these results
 *     setState(data);
 *   }, [begin, isLatest]);
 *
 * Implemented with a ref (not state) so calling `begin()` never triggers a
 * re-render and the counter is shared across overlapping closures of the same
 * component instance.
 */
export function useLatestRun(): {
  /** Start a new run; returns its id. Any in-flight run is now stale. */
  begin: () => number;
  /** True only if `id` is the most recently started run. */
  isLatest: (id: number) => boolean;
} {
  const seqRef = useRef(0);

  const begin = useCallback(() => {
    seqRef.current += 1;
    return seqRef.current;
  }, []);

  const isLatest = useCallback((id: number) => id === seqRef.current, []);

  return { begin, isLatest };
}
