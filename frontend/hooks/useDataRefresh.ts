import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';

import { useDataContext } from '@/context/DataContext';

/**
 * Reliable, focus-aware data reload for any screen/widget that reads the DB.
 *
 * WHY THIS EXISTS — the old `useEffect(() => { load() }, [db, refreshCount])`
 * pattern was fragile. expo-router v6 bottom-tabs (the SDK-56 forked
 * react-navigation) FREEZES a blurred tab's subtree via react-native-screens /
 * react-freeze (`BottomTabView` renders each inactive tab inside
 * `<Screen shouldFreeze>`). A frozen subtree is suspended, so React does NOT run
 * its effects. When a write on the active tab bumps the global `refreshCount`,
 * the blurred screen's reload effect is suspended and never fires — the user only
 * saw fresh data after fully reopening the app.
 *
 * `useFocusEffect` is the idiomatic fix and covers BOTH refresh vectors:
 *   1. On every focus gain it runs `load()` — so navigating back to a tab always
 *      shows current data (no reopen needed), even after it was frozen.
 *   2. Because the wrapped callback's identity changes whenever `refreshCount`
 *      (or any `extraDeps`) changes, expo-router's `useFocusEffect` re-runs the
 *      effect; if the screen is currently focused it re-invokes `load()`
 *      immediately — giving live in-focus updates the moment data changes.
 *
 * The `refreshCount` / `refetchEntries` mechanism is intentionally KEPT: it is the
 * in-focus "data changed" signal that this hook consumes via the dependency list.
 *
 * `load` MAY return a cleanup function (exactly like `useEffect`). When it does,
 * that cleanup is forwarded to `useFocusEffect`, so it runs when the screen
 * BLURS (or unmounts) — the right place to flip an `active` flag and cancel a
 * late `setState`, or tear down a subscription. A `load` that returns nothing
 * (the common case) is fine too. (Async loaders resolve to a Promise, which
 * `useFocusEffect` ignores — return a cleanup synchronously if you need one.)
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

    useFocusEffect(
        // The loader closes over its own state setters; `refreshCount` + caller deps
        // drive the in-focus re-run. `load` is intentionally omitted to avoid
        // re-running on every render (callers don't memoize it) — the explicit
        // dep list is the contract. Only forward the loader's result when it's a
        // cleanup FUNCTION (runs on blur/unmount); a Promise from an async loader
        // is swallowed (useFocusEffect's EffectCallback can't return a Promise).
        // eslint-disable-next-line react-hooks/exhaustive-deps
        useCallback(() => {
            const result = load();
            return typeof result === 'function' ? result : undefined;
        }, [refreshCount, ...extraDeps]),
    );
}
