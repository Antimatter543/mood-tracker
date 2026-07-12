import { useCallback, useEffect, useRef } from 'react';
import { useFocusEffect, useIsFocused } from 'expo-router';

import { useDataContext } from '@/context/DataContext';

/**
 * Reliable, focus-aware data reload for any screen/widget that reads the DB.
 *
 * There are TWO distinct refresh vectors, and they are NOT the same event —
 * conflating them is the bug this hook has been bitten by twice:
 *
 *   VECTOR 1 — FOCUS GAIN (a blurred tab becomes active again).
 *   VECTOR 2 — DATA CHANGED WHILE ALREADY FOCUSED (a write on the *current*
 *              screen bumps the global `refreshCount`).
 *
 * ── Why VECTOR 1 needs `useFocusEffect` ─────────────────────────────────────
 * expo-router v6 bottom-tabs (the SDK-56 forked react-navigation) FREEZES a
 * blurred tab's subtree via react-native-screens / react-freeze
 * (`BottomTabView` renders each inactive tab inside `<Screen shouldFreeze>`). A
 * frozen subtree is suspended, so React does NOT run its effects while blurred.
 * `useFocusEffect` runs `load()` on every focus gain, so navigating back to a
 * tab always shows current data (no app reopen), even after it was frozen.
 *
 * ── Why VECTOR 2 needs its OWN explicit effect ──────────────────────────────
 * The obvious trick — put `refreshCount` in the `useFocusEffect` callback's dep
 * list so its identity changes and the effect "re-runs while focused" — is
 * UNRELIABLE for the *already-focused* screen on this navigator. It is exactly
 * why "add a mood on Home and Home doesn't update until you leave and come back"
 * kept reproducing (reported 2026-06-26, still live in 2.3.8, device-confirmed):
 * Timeline refreshed because you *navigate to it* (VECTOR 1 fires on focus
 * gain), but Home — already focused when you tap its own FAB — relied on the
 * flaky in-focus re-run and never reloaded. So we stop depending on that re-run
 * for live updates and OWN VECTOR 2 explicitly: a plain `useEffect` keyed on
 * `refreshCount` (+ caller deps), gated by the REACTIVE `useIsFocused()` so it
 * only fires for the visible screen. A blurred screen is skipped here (it's
 * frozen anyway) and picks the change up via VECTOR 1 when it refocuses.
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
    const { refreshCount } = useDataContext();
    const isFocused = useIsFocused();

    // Normalize the loader's result to a cleanup fn or undefined (never a
    // Promise — `useFocusEffect`/`useEffect` would try to call it on teardown).
    // `load` is intentionally omitted from the deps: callers don't memoize it,
    // so the explicit `refreshCount` + caller deps are the re-run contract.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const runLoad = useCallback((): (() => void) | undefined => {
        const result = load();
        return typeof result === 'function' ? result : undefined;
    }, [refreshCount, ...extraDeps]);

    // VECTOR 1 — focus gain. Reloads whenever the screen (re)gains focus, so a
    // tab that was frozen while blurred reflects any writes made while it was
    // away. Its cleanup runs on blur/unmount (forwarded from `load`).
    useFocusEffect(runLoad);

    // VECTOR 2 — data changed while THIS screen is focused. Owns the live
    // in-focus update that VECTOR 1's in-focus re-run can miss (the reported
    // "Home doesn't update after adding a mood" bug). Skips the initial mount
    // (VECTOR 1 already loads on first focus) and any run while blurred (frozen
    // screens reload on refocus via VECTOR 1). The loader's cleanup is forwarded
    // here too, so a superseded run tears down before the next fires.
    const mounted = useRef(false);
    useEffect(() => {
        if (!mounted.current) {
            mounted.current = true;
            return;
        }
        if (!isFocused) return;
        return runLoad();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- runLoad already closes over refreshCount + extraDeps; isFocused gates to the visible screen
    }, [refreshCount, isFocused, ...extraDeps]);
}
