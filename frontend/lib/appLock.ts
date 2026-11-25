/**
 * App lock: the PURE decision layer (no native deps, unit-tested in
 * __tests__/appLock.test.ts). The native call lives in lib/biometricAuth.ts and
 * the React state machine in context/AppLock.tsx.
 *
 * Two opt-in settings drive it (databases/settings.ts, both default OFF):
 *   - app_lock_enabled:      ask for biometrics on every cold start and every
 *                            return from the background,
 *   - distress_wipe_enabled: a biometric LOCKOUT in our prompt silently runs the
 *                            distress wipe (databases/distressWipe.ts).
 */

/** The subset of expo-local-authentication's result this module reasons about. */
export type AuthAttempt =
    | { success: true }
    | { success: false; error: string };

/**
 * What the lock screen does with one finished prompt:
 *   - unlock:      the user proved who they are,
 *   - wipe:        distress mode + a lockout the user produced IN OUR prompt,
 *   - locked_out:  too many attempts, nothing else happens (try again later),
 *   - dismissed:   the user backed out / the system cancelled; stay locked,
 *   - unavailable: no biometrics and no screen lock on the device (see
 *                  `failsOpen`), or the prompt could not be shown.
 */
export type AuthOutcome = 'unlock' | 'wipe' | 'locked_out' | 'dismissed' | 'unavailable';

/**
 * A lockout that comes back faster than this was NOT produced in our prompt:
 * the biometric sensor was already locked out (e.g. failed attempts on the
 * phone's own lock screen, or in another app) and the system refused at once.
 * Five deliberate wrong fingers in our prompt always take longer than this.
 * Without this guard an unrelated lockout elsewhere would wipe the journal on
 * the next open, which is never what the user meant.
 */
export const MIN_PROMPT_MS_FOR_DISTRESS = 2500;

export function classifyAuthAttempt(
    attempt: AuthAttempt,
    opts: { distressEnabled: boolean; elapsedMs: number }
): AuthOutcome {
    if (attempt.success) return 'unlock';
    switch (attempt.error) {
        case 'lockout':
            return opts.distressEnabled && opts.elapsedMs >= MIN_PROMPT_MS_FOR_DISTRESS
                ? 'wipe'
                : 'locked_out';
        case 'not_enrolled':
        case 'not_available':
        case 'passcode_not_set':
            return 'unavailable';
        default:
            // user_cancel, system_cancel, app_cancel, user_fallback, timeout,
            // authentication_failed, unknown, ...: stay locked, offer a retry.
            return 'dismissed';
    }
}

/** Options handed to LocalAuthentication.authenticateAsync. */
export type PromptOptions = {
    promptMessage: string;
    cancelLabel: string;
    disableDeviceFallback: boolean;
    requireConfirmation: boolean;
};

/**
 * Distress mode needs a BIOMETRIC-ONLY prompt: with the device PIN allowed,
 * Android silently switches to the PIN after the fifth wrong finger and never
 * reports a lockout, so the wipe could never trigger. Everyone else gets the
 * PIN fallback, which is what keeps a wet finger from locking them out.
 *
 * `biometricsEnrolled` false (fingerprints removed since the option was turned
 * on) always allows the PIN: a biometric-only prompt would then be impossible
 * to pass and the user would be locked out of their own journal for good.
 */
export function promptOptionsFor(opts: {
    distressEnabled: boolean;
    biometricsEnrolled: boolean;
}): PromptOptions {
    const biometricOnly = opts.distressEnabled && opts.biometricsEnrolled;
    return {
        promptMessage: 'Unlock SoulSync',
        cancelLabel: 'Cancel',
        disableDeviceFallback: biometricOnly,
        // No extra "Confirm" tap after a face match: unlock should feel instant.
        requireConfirmation: false,
    };
}

/**
 * The lock never strands a user: if the device has NO way to authenticate (no
 * biometrics enrolled and no screen lock: someone removed them after turning
 * the lock on), the app opens instead of showing an unpassable lock screen.
 * Security level 0 = expo-local-authentication's SecurityLevel.NONE.
 */
export function failsOpen(enrolledSecurityLevel: number): boolean {
    return enrolledSecurityLevel <= 0;
}

/**
 * Whether an AppState change should (re)lock the app. Locks on the move to the
 * BACKGROUND only ('inactive' is iOS's app-switcher peek and the moment a
 * system sheet opens over us; Android goes straight to 'background').
 *
 * `authInFlight`: on Android < 11 the device-PIN fallback is a separate
 * activity, so OUR activity pauses while the user types the PIN. Re-locking on
 * that pause would throw away the very unlock in progress and loop forever.
 */
export function shouldLockOnAppStateChange(
    next: string,
    opts: { lockEnabled: boolean; authInFlight: boolean }
): boolean {
    return opts.lockEnabled && !opts.authInFlight && next === 'background';
}

/** Lock screen status line for each outcome (none for unlock / wipe-in-progress). */
export function lockMessageFor(outcome: AuthOutcome | null): string | null {
    switch (outcome) {
        case 'locked_out':
        case 'wipe':
            // Deliberately IDENTICAL for a plain lockout and a distress wipe: the
            // person watching must not be able to tell that anything happened.
            return 'Too many attempts. Try again in a moment.';
        case 'dismissed':
            return null;
        case 'unavailable':
            return 'Biometric unlock is not available right now.';
        default:
            return null;
    }
}

/** Why a Settings switch cannot be turned on yet (null = it can). */
export type EnableBlocker = 'no_screen_lock' | 'no_biometrics';

/** The app lock needs SOME way to authenticate: biometrics or a screen lock. */
export function appLockBlocker(caps: { securityLevel: number }): EnableBlocker | null {
    return failsOpen(caps.securityLevel) ? 'no_screen_lock' : null;
}

/**
 * The distress wipe needs ENROLLED biometrics: it fires on a biometric lockout,
 * which a PIN-only phone can never produce.
 */
export function distressWipeBlocker(caps: { enrolled: boolean; securityLevel: number }): EnableBlocker | null {
    if (failsOpen(caps.securityLevel)) return 'no_screen_lock';
    return caps.enrolled ? null : 'no_biometrics';
}

/** Settings copy, kept here so the tests can pin the promises it makes. */
export const APP_LOCK_COPY = {
    lockDescription:
        'Ask for your fingerprint, face or device PIN every time SoulSync opens or comes back from the background.',
    distressDescription:
        'If biometric unlock fails too many times, quietly erase everything private. Only mood scores and default activities stay.',
    distressWarningTitle: 'Turn on distress wipe?',
    distressWarning:
        'While this is on, SoulSync unlocks with biometrics only (no PIN). If the check fails so often that ' +
        'your phone blocks biometrics, SoulSync silently and permanently erases:\n\n' +
        '• all notes and photos\n' +
        '• your custom activities and groups\n' +
        '• the recycle bin\n\n' +
        'Your dates, mood scores and the default activities stay, so the app still looks normal.\n\n' +
        'This also happens if it fails by accident (wet finger, gloves). It cannot be undone. ' +
        'Make a backup first and keep it somewhere other than this phone.',
    distressActiveHint:
        'Distress wipe is on. Keep a recent backup outside this phone: it is the only way to get your notes back after a wipe.',
    noScreenLockTitle: 'No screen lock',
    noScreenLock: 'Set up a fingerprint, face unlock or a screen lock PIN in your phone settings first.',
    noBiometricsTitle: 'No biometrics set up',
    noBiometrics: 'Distress wipe needs a fingerprint or face unlock. Add one in your phone settings first.',
} as const;
