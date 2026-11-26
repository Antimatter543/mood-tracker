/**
 * expo-local-authentication for jest. SoulSync uses it for one thing: the
 * phone's own screen lock behind "Forgot PIN?" (lib/deviceCredential.ts).
 * Plain functions over mutable state (not jest.fn), so suites that call
 * jest.resetAllMocks() keep a working module.
 *
 *   __setCapabilities({ securityLevel: 0 })   // a phone without a screen lock
 *   __queueResult({ success: false, error: 'user_cancel' })
 *   __calls()                                 // every authenticateAsync options object
 */
type Result = { success: true } | { success: false; error: string };

let caps = { hasHardware: true, enrolled: true, securityLevel: 3 };
let queue: Result[] = [];
let calls: unknown[] = [];

export enum SecurityLevel { NONE = 0, SECRET = 1, BIOMETRIC_WEAK = 2, BIOMETRIC_STRONG = 3 }

export const hasHardwareAsync = async () => caps.hasHardware;
export const isEnrolledAsync = async () => caps.enrolled;
export const getEnrolledLevelAsync = async () => caps.securityLevel;

export const authenticateAsync = async (options: unknown): Promise<Result> => {
    calls.push(options);
    return queue.shift() ?? { success: true };
};

export const cancelAuthenticate = async () => {};

export function __setCapabilities(next: Partial<typeof caps>) {
    caps = { ...caps, ...next };
}
export function __queueResult(result: Result) {
    queue.push(result);
}
export function __calls() {
    return calls;
}
export function __reset() {
    caps = { hasHardware: true, enrolled: true, securityLevel: 3 };
    queue = [];
    calls = [];
}
