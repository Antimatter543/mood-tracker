/**
 * "The database has been initialized" signal.
 *
 * `initializeDatabase` (lifecycle.ts) runs on the SQLiteProvider's READ
 * connection when the (tabs) layout mounts: it switches the file to WAL and runs
 * the migrations. Code that lives OUTSIDE that provider (the QA seed channel in
 * lib/qa, mounted from the root layout) must not open the write connection
 * before then: on a fresh install it would race the WAL switch and the
 * migrations. It awaits `whenDatabaseInitialized()` instead of polling.
 *
 * Module-level and process-lifetime, like dataRefreshStore. Once initialized it
 * stays initialized (a (tabs) remount re-runs init, which is idempotent).
 */

let initialized = false;
let waiters: (() => void)[] = [];

/** Called by `initializeDatabase` once WAL + migrations + the bin sweep are done. */
export function markDatabaseInitialized(): void {
  initialized = true;
  const pending = waiters;
  waiters = [];
  for (const resolve of pending) resolve();
}

export function isDatabaseInitialized(): boolean {
  return initialized;
}

/** Resolves once `markDatabaseInitialized` has run (immediately if it already has). */
export function whenDatabaseInitialized(): Promise<void> {
  if (initialized) return Promise.resolve();
  return new Promise<void>((resolve) => {
    waiters.push(resolve);
  });
}

/** TEST ONLY. Back to "not initialized", dropping any waiters. */
export function __resetDatabaseReadinessForTests(): void {
  initialized = false;
  waiters = [];
}
