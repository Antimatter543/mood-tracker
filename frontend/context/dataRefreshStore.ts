import { useSyncExternalStore } from 'react';

/**
 * External "data version" store — the reliable cross-screen "something was
 * written, reload" signal.
 *
 * WHY THIS EXISTS (2026-07-13, device-proven): the old signal was a
 * `refreshCount` number in React state on the `(tabs)` layout, handed to screens
 * through `DataContext`. Adding a mood bumped that number (verified on device:
 * `refetchEntries` fired, the layout re-rendered with the new count) — but the
 * context update DID NOT propagate to the tab-screen consumers: Home never
 * re-rendered, so its reload effect never ran, and "add a mood → Home doesn't
 * update until you leave and come back" reproduced for over a year. A write fires
 * from inside the entry-form's async submit handler while the in-tree overlay is
 * unmounting; in that specific commit the bumped context value never reaches the
 * screens sitting under the bottom-tab navigator. (Theme/settings context works
 * because it changes outside that flow.)
 *
 * `useSyncExternalStore` fixes this: it is React's purpose-built primitive for an
 * external mutable store. On `bump()` we call every registered listener directly,
 * and React re-renders each subscribed component from that imperative signal —
 * it does not rely on a context value threading down through the navigator. Every
 * data-reading screen subscribes via `useDataVersion()`; every write calls
 * `bumpDataVersion()`. That is the whole contract.
 *
 * The version is a plain module-level counter (monotonic, process-lifetime). It
 * is NOT persisted and its absolute value is meaningless — only its CHANGES
 * matter (each change = "reload"). `getServerSnapshot` returns the same snapshot
 * so it is SSR/first-render safe.
 */

let version = 0;
const listeners = new Set<() => void>();

/** Signal that the on-device data changed — reload every subscribed screen. */
export function bumpDataVersion(): void {
    version += 1;
    // Copy before iterating: a listener that unsubscribes mid-notify (a screen
    // unmounting on the same tick) must not mutate the set we're looping.
    for (const listener of Array.from(listeners)) {
        listener();
    }
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function getSnapshot(): number {
    return version;
}

/**
 * Subscribe to the data-version signal. The returned number changes (by exactly
 * how much is irrelevant) every time `bumpDataVersion()` is called, which
 * re-renders the caller. Feed it into a reload effect's dependency list.
 */
export function useDataVersion(): number {
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
