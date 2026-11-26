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

import { DistressScope, erasedCategoryLabels, isDefaultScope, keptSummary } from '@/lib/distressScope';

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
 * The system shows that refusal for ~2 s before reporting it, so the bar sits
 * well above that; five deliberate wrong fingers (each "Not recognised", then
 * the lockout message) always take longer.
 * Without this guard an unrelated lockout elsewhere would wipe the journal on
 * the next open, which is never what the user meant.
 */
export const MIN_PROMPT_MS_FOR_DISTRESS = 4000;

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
 * The unlock prompt is BIOMETRIC-ONLY until Android blocks biometrics, and it
 * is the same with the distress wipe on or off. That is deliberate: if only
 * distress mode hid the PIN option, anyone watching could tell it was on.
 * (Distress mode also needs it technically: with the PIN allowed, Android
 * switches to the PIN after the fifth wrong finger instead of reporting a
 * lockout, so the wipe could never trigger.)
 *
 * `pinAllowed`: after a block (or when biometrics are unavailable) the next
 * prompt allows the device PIN, again in both modes. With distress on, the
 * wipe has already run by then.
 *
 * `biometricsEnrolled` false (no fingerprint/face, or removed since the lock
 * was turned on) always allows the PIN: a biometric-only prompt would be
 * impossible to pass and the user would be locked out of their own journal.
 */
export function promptOptionsFor(opts: {
    pinAllowed: boolean;
    biometricsEnrolled: boolean;
}): PromptOptions {
    const biometricOnly = opts.biometricsEnrolled && !opts.pinAllowed;
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
        'Ask for your fingerprint or face every time SoulSync opens or comes back from the background. ' +
        'If Android blocks biometrics after too many tries, your device PIN works.',
    distressDescription:
        "If someone makes you unlock SoulSync, use a wrong finger until Android blocks biometrics (usually 5 tries). " +
        'SoulSync then quietly removes your notes, photos and other private details. Your days and mood scores stay, ' +
        'so the journal still looks normal.',
    distressWarningTitle: 'Turn on distress wipe?',
    distressWhyDefault:
        'An empty or freshly wiped mood tracker can itself look suspicious. So by default SoulSync keeps every ' +
        'logged day with its date, mood score and default activities, and removes only what could give you away. ' +
        'The journal then still looks like it has been used normally. Only change this if an empty app is safer for you.',
    distressCustomScope: 'Custom selection of what gets erased (see Technical details).',
    eraseEntriesTitle: 'Erase all entries too?',
    eraseEntriesWarning:
        'With this on, the distress wipe also deletes every entry and mood score. SoulSync then looks like a ' +
        'fresh install with an empty journal. Keep in mind that an empty mood tracker can itself look ' +
        'suspicious, which is why this is off by default. Only a backup kept outside this phone can bring it back.',
    distressActiveHint:
        'Distress wipe is on. Keep a recent backup outside this phone: it is the only way to get your notes back after a wipe.',
    noScreenLockTitle: 'No screen lock',
    noScreenLock: 'Set up a fingerprint, face unlock or a screen lock PIN in your phone settings first.',
    noBiometricsTitle: 'No biometrics set up',
    noBiometrics: 'Distress wipe needs a fingerprint or face unlock. Add one in your phone settings first.',
} as const;

/** Where the lockout rule comes from: the Android Compatibility Definition, 7.3.10. */
export const ANDROID_BIOMETRIC_RULE_URL =
    'https://source.android.com/docs/compatibility/17/android-17-cdd#7310_biometric_sensors';

/**
 * "Technical details" under the distress wipe (Settings). Kept here so the tests
 * can pin every promise it makes against what the code does.
 */
export const DISTRESS_TECH_DETAILS: readonly string[] = [
    'SoulSync does not count attempts itself. It reacts when Android blocks biometrics after wrong ' +
        "attempts. Android's rules strongly recommend a block of at least 30 seconds after 5 wrong attempts, " +
        'and require a switch to the PIN after at most 20. Most phones block after 5; the phone maker sets ' +
        'the exact number.',
    'Only attempts Android actually reads and rejects count. A smudged or partial touch usually does not.',
    "Only a block that happens in SoulSync's own unlock prompt counts. If biometrics were already blocked " +
        "(for example after wrong attempts on your phone's lock screen), nothing is erased.",
    "SoulSync's unlock prompt never offers the PIN before Android blocks biometrics, with or without the " +
        'distress wipe, so nobody can tell from the prompt whether it is on. Once biometrics are blocked, ' +
        'the PIN works; with the distress wipe on, it has already run by then and turns itself off.',
    'The erasing happens at once, in the background. The lock screen looks exactly like after a normal ' +
        'block. Erased data is overwritten in the database file, not just marked as deleted.',
    'Out of reach for the app: backups you saved elsewhere (Drive, email), Android\'s own device backup, ' +
        'and data stored in Health Connect itself.',
];

/**
 * The confirmation shown before turning the distress wipe on. With the
 * recommended selection it is short (most people never open the details);
 * a custom selection is listed in full, because that is what will happen.
 */
export function distressWarningFor(scope: DistressScope): string {
    const trigger =
        "If Android blocks biometrics after wrong attempts at SoulSync's unlock prompt (usually 5), " +
        'SoulSync silently and permanently ';
    const accident =
        'This also happens if it fails by accident (wet finger, gloves). It cannot be undone. ' +
        'Make a backup first and keep it somewhere other than this phone.';
    if (isDefaultScope(scope)) {
        return (
            trigger +
            'removes your notes, photos and other private details. Your days and mood scores stay, so the ' +
            'journal still looks normal.\n\n' +
            accident +
            '\n\nDetails and options: Technical details, under the switch.'
        );
    }
    const labels = erasedCategoryLabels(scope);
    const list = labels.length
        ? labels.map(l => `\u2022 ${l}`).join('\n')
        : '\u2022 nothing (every category is switched off)';
    return trigger + 'erases:\n\n' + list + '\n\n' + keptSummary(scope) + '\n\n' + accident;
}
