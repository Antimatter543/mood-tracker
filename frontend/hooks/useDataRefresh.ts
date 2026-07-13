import { useCallback, useEffect, useRef } from 'react';
import { useFocusEffect } from 'expo-router';

import { useDataVersion } from '@/context/dataRefreshStore';

/**
 * Reliable, focus-aware data reload for any screen/widget that reads the DB.
 *
 * There are TWO distinct refresh vectors, and they are NOT the same event —
 * conflating them is the bug this hook has been bitten by repeatedly:
 *
 *   VECTOR 1 — FOCUS GAIN (a blurred tab becomes active again).
 *   VECTOR 2 — DATA CHANGED WHILE ALREADY FOCUSED (a write happens on the
 *              screen you're already on, e.g. adding a mood on Home).
 *
 * ── Why VECTOR 1 needs `useFocusEffect` ─────────────────────────────────────
 * expo-router v6 bottom-tabs (the SDK-56 forked react-navigation) FREEZES a
 * blurred tab's subtree via react-native-screens / react-freeze. A frozen
 * subtree is suspended, so React does NOT run its effects while blurred.
 * `useFocusEffect` runs `load()` on every focus gain, so navigating back to a
 * tab always shows current data (no app reopen), even after it was frozen.
 *
 * ── Why VECTOR 2 subscribes to an EXTERNAL store, not a context value ────────
 * This is the fix for the year-old "add a mood on Home and Home doesn't update
 * until you leave and come back" bug (reported 2026-06-26, still live in 2.3.8;
 * root-caused on-device 2026-07-13). The old signal was a `refreshCount` number
 * kept in React state on the `(tabs)` layout and handed to screens through
 * DataContext. On-device instrumentation proved the whole chain worked EXCEPT
 * the last hop: a write fired `refetchEntries`, the layout re-rendered with the
 * bumped count — but that context update never reached the tab-screen consumers.
 * Home never re-rendered, so its reload effect never ran. (The write fires from
 * the entry-form's async submit handler while the in-tree overlay is unmounting;
 * in that commit the new context value simply doesn't propagate down through the
 * bottom-tab navigator to the screens. Theme/settings context works because it
 * changes outside that flow.)
 *
 * The reload signal is therefore an EXTERNAL store subscribed via
 * `useSyncExternalStore` (`useDataVersion` from context/dataRefreshStore.ts). A
 * write calls `bumpDataVersion()`, which notifies every subscribed screen
 * DIRECTLY — React re-renders each from that imperative signal instead of
 * relying on a value threading down through the navigator. VECTOR 2 keys a plain
 * `useEffect` on that version (+ caller deps): a mounted (therefore
 * visible/unfrozen) screen is GUARANTEED to run the effect when the version
 * changes; a frozen/blurred screen skips it for free and catches up via VECTOR 1
 * on refocus. No `useIsFocused()` gate — an earlier attempt gated VECTOR 2 on it
 * and it silently skipped the reload; a mounted screen's effect running IS the
 * signal we want.
 *
 * The two vectors can BOTH fire on a focus-gain-that-also-changed-data; that
 * overlap is harmless — every caller's loader is idempotent (Home/DBViewer gate
 * with `useLatestRun`; the chart/insight widgets gate with an `active` flag), so
 * a redundant reload just reads the same rows and sets the same state.
 *
 * `load` MAY return a cleanup function (exactly like `useEffect`). When it does,
 * that cleanup is forwarded so it runs on BLUR/unmount (VECTOR 1) — the right
 * place to flip an `active` flag and cancel a late `setState`, or tear down a
 * subscription. A `load` that returns nothing (the common case) is fine too, and
 * an async loader's Promise is swallowed (never mistaken for a cleanup fn).
 *
 * @param load      The screen's data loader. Reads the DB and sets state. May return
 *                  a cleanup function (run on blur/unmount) like a useEffect callback.
 * @param extraDeps Anything else that should trigger a reload while focused — always
 *                  include the `db` handle and any timeframe/prop the query depends on.
 */
export function useDataRefresh(
    load: () => void | (() => void) | Promise<void>,
    extraDeps: readonly unknown[] = [],
) {
    // The reload signal: an EXTERNAL store subscribed via useSyncExternalStore,
    // NOT a context value. A `refreshCount` threaded through DataContext did not
    // reach the tab screens for in-focus updates (device-proven — see
    // context/dataRefreshStore.ts); this imperative subscription does.
    const dataVersion = useDataVersion();

    // Normalize the loader's result to a cleanup fn or undefined (never a
    // Promise — `useFocusEffect`/`useEffect` would try to call it on teardown).
    // `load` is intentionally omitted from the deps: callers don't memoize it,
    // so the explicit `dataVersion` + caller deps are the re-run contract.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const runLoad = useCallback((): (() => void) | undefined => {
        const result = load();
        return typeof result === 'function' ? result : undefined;
    }, [dataVersion, ...extraDeps]);

    // VECTOR 1 — focus gain. Reloads whenever the screen (re)gains focus, so a
    // tab that was frozen while blurred reflects any writes made while it was
    // away. Its cleanup runs on blur/unmount (forwarded from `load`).
    useFocusEffect(runLoad);

    // VECTOR 2 — data changed while THIS screen is mounted/visible. Owns the live
    // in-place update (the "Home doesn't update after adding a mood" bug). Fires
    // whenever the external data version changes: a mounted screen is, on this
    // navigator, an unfrozen/visible screen, so the effect running IS the signal
    // we want. We only skip the INITIAL mount (VECTOR 1 already loads on first
    // focus); a frozen/blurred screen doesn't run effects and catches up via
    // VECTOR 1 on refocus. The loader's cleanup is forwarded here too, so a
    // superseded run tears down before the next fires.
    const mounted = useRef(false);
    useEffect(() => {
        if (!mounted.current) {
            mounted.current = true;
            return;
        }
        return runLoad();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- runLoad already closes over dataVersion + extraDeps; deps mirror runLoad's so it re-runs on every data change while mounted
    }, [dataVersion, ...extraDeps]);
}
