/**
 * App lock PIN rules, pure (unit-tested in __tests__/pinLock.test.ts).
 *
 * The app lock is PIN-only. The distress wipe is a second PIN (the distress
 * PIN) that unlocks exactly like the real one and runs the wipe first. RULE:
 * nothing a person can see or time may differ between the two, or between a
 * phone with and without a distress PIN. Everything here is the same for both.
 */

export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 8;

/** Wrong PINs before the first wait. */
export const FREE_ATTEMPTS = 5;
/** First wait after FREE_ATTEMPTS wrong PINs; doubles per further wrong PIN. */
export const BASE_COOLDOWN_MS = 30_000;
export const MAX_COOLDOWN_MS = 15 * 60_000;

export type PinProblem = 'too_short' | 'too_long' | 'not_digits' | 'same_as_app_pin' | 'mismatch';

/** Why a new PIN cannot be used (null = fine). */
export function pinProblem(pin: string, opts: { confirm?: string; mustDifferFrom?: string } = {}): PinProblem | null {
    if (!/^\d*$/.test(pin)) return 'not_digits';
    if (pin.length < PIN_MIN_LENGTH) return 'too_short';
    if (pin.length > PIN_MAX_LENGTH) return 'too_long';
    if (opts.mustDifferFrom !== undefined && pin === opts.mustDifferFrom) return 'same_as_app_pin';
    if (opts.confirm !== undefined && opts.confirm !== pin) return 'mismatch';
    return null;
}

export const PIN_PROBLEM_COPY: Record<PinProblem, string> = {
    too_short: `Use at least ${PIN_MIN_LENGTH} digits.`,
    too_long: `Use at most ${PIN_MAX_LENGTH} digits.`,
    not_digits: 'Use digits only.',
    same_as_app_pin: 'The distress PIN must be different from your app PIN.',
    mismatch: "The PINs don't match. Try again.",
};

/** How long to wait before the next try, after `failures` wrong PINs in a row. */
export function cooldownMs(failures: number): number {
    if (failures < FREE_ATTEMPTS) return 0;
    const steps = failures - FREE_ATTEMPTS;
    return Math.min(MAX_COOLDOWN_MS, BASE_COOLDOWN_MS * 2 ** steps);
}

/** Milliseconds left to wait at `nowMs` (0 = may try now). */
export function remainingWaitMs(state: { failures: number; lastFailureAt: number }, nowMs: number): number {
    const wait = cooldownMs(state.failures);
    if (!wait) return 0;
    return Math.max(0, state.lastFailureAt + wait - nowMs);
}

/** "Try again in 25 s" / "in 2 min". */
export function waitMessage(ms: number): string {
    const s = Math.ceil(ms / 1000);
    if (s < 60) return `Too many wrong PINs. Try again in ${s} s.`;
    return `Too many wrong PINs. Try again in ${Math.ceil(s / 60)} min.`;
}

/**
 * Whether an AppState change should (re)lock the app: on the move to the
 * BACKGROUND only ('inactive' is iOS's app-switcher peek and the moment a
 * system sheet opens over us; Android goes straight to 'background').
 * `paused` covers our own device-credential prompt ("Forgot PIN?"), whose
 * activity pauses ours.
 */
export function shouldLockOnAppStateChange(
    next: string,
    opts: { lockEnabled: boolean; paused: boolean }
): boolean {
    return opts.lockEnabled && !opts.paused && next === 'background';
}

/** Shortest time the "Unlocking…" state shows, so a distress unlock (which wipes first) looks the same. */
export const MIN_UNLOCK_MS = 900;
