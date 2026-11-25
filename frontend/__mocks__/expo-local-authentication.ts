/**
 * expo-local-authentication for jest. Plain functions over mutable state (not
 * jest.fn), so suites that call jest.resetAllMocks() keep a working module.
 *
 *   __setCapabilities({ enrolled: false, securityLevel: 1 })
 *   __queueResult({ success: false, error: 'lockout' }, 4000)  // result, ms "on screen"
 *   __calls()  // every authenticateAsync options object, in order
 *
 * A queued result's delay is reported through Date.now(): the mock advances a
 * Date.now spy by that many ms, which is how lib/biometricAuth measures how
 * long the prompt was open (the distress guard).
 */
type Result = { success: true } | { success: false; error: string };

let caps = { hasHardware: true, enrolled: true, securityLevel: 3 };
let queue: Array<{ result: Result; ms: number }> = [];
let calls: unknown[] = [];
let pending: Array<() => void> = [];
let holdNext = false;

export enum SecurityLevel { NONE = 0, SECRET = 1, BIOMETRIC_WEAK = 2, BIOMETRIC_STRONG = 3 }

export const hasHardwareAsync = async () => caps.hasHardware;
export const isEnrolledAsync = async () => caps.enrolled;
export const getEnrolledLevelAsync = async () => caps.securityLevel;

export const authenticateAsync = async (options: unknown): Promise<Result> => {
    calls.push(options);
    const next = queue.shift() ?? { result: { success: true } as Result, ms: 0 };
    if (holdNext) {
        holdNext = false;
        await new Promise<void>(resolve => pending.push(resolve));
    }
    if (next.ms) {
        const real = Date.now();
        const spy = jest.spyOn(Date, 'now').mockReturnValue(real + next.ms);
        // Restore after the caller has read the end time.
        setTimeout(() => spy.mockRestore(), 0);
    }
    return next.result;
};

export const cancelAuthenticate = async () => {};

export function __setCapabilities(next: Partial<typeof caps>) {
    caps = { ...caps, ...next };
}
export function __queueResult(result: Result, ms = 0) {
    queue.push({ result, ms });
}
/** The next prompt stays open until __releasePrompt() (simulates the PIN activity). */
export function __holdNextPrompt() {
    holdNext = true;
}
export function __releasePrompt() {
    pending.splice(0).forEach(r => r());
}
export function __calls() {
    return calls;
}
export function __reset() {
    caps = { hasHardware: true, enrolled: true, securityLevel: 3 };
    queue = [];
    calls = [];
    pending = [];
    holdNext = false;
}
