/**
 * Freeze the app's clock (`lib/clock.ts`) for one test.
 *
 *   const now = freezeNow(localAt('2026-06-15', 9));   // app code's now() is 09:00 that day
 *   freezeNow();                                         // the builders' FIXED_NOW
 *
 * The freeze is cleared before every test by `jest.afterEnv.ts`, so a call in
 * `beforeAll` is undone before the first test: freeze in `beforeEach` or in the
 * test. It survives `jest.resetModules()`.
 *
 * Only app code that reads `now()` sees the freeze. A test that also needs
 * `Date.now()` or timers to move uses jest's fake timers instead.
 */
import { __setFrozenNowForQa } from '@/lib/clock';
import { FIXED_NOW } from './builders';

/** Freeze `now()` at `at` (default: the builders' FIXED_NOW). Returns a copy of the instant. */
export function freezeNow(at: Date = FIXED_NOW): Date {
    __setFrozenNowForQa(at);
    return new Date(at.getTime());
}

/** Back to the wall clock. `jest.afterEnv.ts` calls this before every test. */
export function unfreezeNow(): void {
    __setFrozenNowForQa(null);
}
