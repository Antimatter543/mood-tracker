import * as LocalAuthentication from 'expo-local-authentication';
import type { AuthAttempt, PromptOptions } from '@/lib/appLock';

/**
 * The ONLY place that touches expo-local-authentication. Everything here is
 * wrapped so a native failure reads as an outcome, never as a thrown error that
 * could leave the lock screen stuck. Decisions live in lib/appLock.ts.
 *
 * Timing uses Date.now() on purpose, not lib/clock: the distress guard measures
 * how long the real prompt was on screen, and a frozen QA clock would make
 * every prompt look instant.
 */

export type BiometricCapabilities = {
    /** The device has biometric hardware at all. */
    hasHardware: boolean;
    /** At least one fingerprint / face is enrolled. */
    enrolled: boolean;
    /** expo SecurityLevel: 0 none, 1 PIN/pattern only, 2 weak, 3 strong biometrics. */
    securityLevel: number;
};

export async function getBiometricCapabilities(): Promise<BiometricCapabilities> {
    try {
        const [hasHardware, enrolled, securityLevel] = await Promise.all([
            LocalAuthentication.hasHardwareAsync(),
            LocalAuthentication.isEnrolledAsync(),
            LocalAuthentication.getEnrolledLevelAsync(),
        ]);
        return { hasHardware, enrolled, securityLevel: Number(securityLevel) };
    } catch {
        return { hasHardware: false, enrolled: false, securityLevel: 0 };
    }
}

/** One prompt, plus how long it was open (for the distress guard). */
export async function promptBiometric(
    options: PromptOptions
): Promise<{ attempt: AuthAttempt; elapsedMs: number }> {
    const started = Date.now();
    try {
        const result = await LocalAuthentication.authenticateAsync(options);
        const attempt: AuthAttempt = result.success
            ? { success: true }
            : { success: false, error: result.error };
        return { attempt, elapsedMs: Date.now() - started };
    } catch {
        return { attempt: { success: false, error: 'unknown' }, elapsedMs: Date.now() - started };
    }
}
