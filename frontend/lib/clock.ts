/**
 * The app's one clock. Every "what time is it" in app code reads `now()` (or a
 * helper that does); nothing else calls `new Date()` / `Date.now()` for the
 * current time (`__tests__/clockInjection.test.ts` scans for it).
 *
 * In a user's build `now()` IS the wall clock: a fresh `new Date()` on every
 * call, exactly what the call sites read before this module existed.
 *
 * Pure transforms do not import this. They take `now` / `today` as a parameter
 * and their callers (screens, loaders, the database layer) pass `now()`, so a
 * test hands them a fixed day instead of racing the real one.
 *
 * Tests freeze the clock with `freezeNow` from `@/testing/clock`; the freeze is
 * cleared before every test (`jest.afterEnv.ts`).
 */

// The frozen instant (epoch ms) lives on globalThis, not in a module variable,
// so a test's freeze survives `jest.resetModules()` / `isolateModules()` (a
// fresh copy of this module would otherwise see the wall clock again).
// Never set in a user's build.
const FROZEN_KEY = Symbol.for('soulsync.clock.frozenAtMs');
type ClockGlobal = typeof globalThis & { [FROZEN_KEY]?: number };
const clockGlobal = globalThis as ClockGlobal;

/** The current instant. A NEW Date every call, so callers may mutate it. */
export function now(): Date {
    const frozenAtMs = clockGlobal[FROZEN_KEY];
    return frozenAtMs === undefined ? new Date() : new Date(frozenAtMs);
}

/**
 * QA ONLY. Freezes `now()` at one instant (it does not tick), or restores the
 * wall clock with `null`. For the QA build's seed channel (`lib/qa/`, reached
 * only when `EXPO_PUBLIC_QA === '1'`) so golden screenshots see a fixed
 * "today", and for tests (through `@/testing/clock`).
 *
 * App code must never call this: `__tests__/clockInjection.test.ts` fails if
 * anything outside `lib/qa/` does. As a second line, it throws in any build
 * that is neither the QA build nor jest: Metro inlines both `process.env`
 * reads (dot notation), so in a user's build the guard is a constant.
 */
export function __setFrozenNowForQa(at: Date | null): void {
    if (process.env.EXPO_PUBLIC_QA !== '1' && process.env.NODE_ENV !== 'test') {
        throw new Error('__setFrozenNowForQa is only available in the QA build');
    }
    if (at === null) {
        delete clockGlobal[FROZEN_KEY];
        return;
    }
    if (Number.isNaN(at.getTime())) {
        throw new Error('__setFrozenNowForQa: invalid date');
    }
    clockGlobal[FROZEN_KEY] = at.getTime();
}
