import { useCallback, useRef, useState } from 'react';

/**
 * useSingleFlight, make an async action idempotent per gesture.
 *
 * WHY: a `disabled` prop only takes effect after React re-renders. A rapid
 * double-tap delivers BOTH press events inside the same frame, before that
 * re-render lands, so both invocations reach the awaited write and the user
 * gets two identical rows. (Observed on the entry form 2026-09-05: one fast
 * double-tap on Submit took the entry count 35 -> 37.)
 *
 * The gate is therefore a **ref set synchronously** at the top of `run`, before
 * the first `await`, that is the only thing a same-tick re-entrant call can
 * observe. The `inFlight` state exists purely so the UI can disable/mark the
 * control busy; it is never the gate.
 *
 * The flag is released in a `finally`, so a REJECTED action re-enables the
 * control and the user can retry. Callers that must stay disabled after a
 * successful run should unmount or gate on their own success state.
 */
export type SingleFlight<A extends unknown[], R> = {
    /** True from the moment `run` is invoked until its promise settles. */
    inFlight: boolean;
    /**
     * Invoke the wrapped action unless one is already in flight. Re-entrant
     * calls resolve to `undefined` WITHOUT invoking the action.
     */
    run: (...args: A) => Promise<R | undefined>;
};

export function useSingleFlight<A extends unknown[], R>(
    fn: (...args: A) => Promise<R>
): SingleFlight<A, R> {
    // The real gate. A ref, because it must be readable/writable synchronously
    // by a second press that happens before any re-render.
    const inFlightRef = useRef(false);
    // Render-visible mirror, for `disabled` / `accessibilityState.busy`.
    const [inFlight, setInFlight] = useState(false);

    const run = useCallback(
        async (...args: A): Promise<R | undefined> => {
            if (inFlightRef.current) return undefined;
            inFlightRef.current = true;
            setInFlight(true);
            try {
                return await fn(...args);
            } finally {
                inFlightRef.current = false;
                setInFlight(false);
            }
        },
        [fn]
    );

    return { inFlight, run };
}
