/**
 * The app lock's pure decision layer (lib/appLock.ts): when a prompt unlocks,
 * when it wipes, when the device PIN is allowed, when the app re-locks.
 */
import {
    ANDROID_BIOMETRIC_RULE_URL,
    APP_LOCK_COPY,
    DISTRESS_TECH_DETAILS,
    distressWarningFor,
    MIN_PROMPT_MS_FOR_DISTRESS,
    appLockBlocker,
    classifyAuthAttempt,
    distressWipeBlocker,
    failsOpen,
    lockMessageFor,
    promptOptionsFor,
    shouldLockOnAppStateChange,
} from '@/lib/appLock';
import {
    DEFAULT_DISTRESS_SCOPE,
    DISTRESS_CATEGORIES,
    DISTRESS_CATEGORY_COPY,
    keptSummary,
} from '@/lib/distressScope';

const SLOW = MIN_PROMPT_MS_FOR_DISTRESS + 1500;
const FAST = 200;

describe('classifyAuthAttempt', () => {
    it('a success always unlocks, distress or not', () => {
        for (const distressEnabled of [true, false]) {
            expect(classifyAuthAttempt({ success: true }, { distressEnabled, elapsedMs: SLOW })).toBe('unlock');
        }
    });

    it('a lockout produced in OUR prompt wipes only when distress is on', () => {
        const lockout = { success: false as const, error: 'lockout' };
        expect(classifyAuthAttempt(lockout, { distressEnabled: true, elapsedMs: SLOW })).toBe('wipe');
        expect(classifyAuthAttempt(lockout, { distressEnabled: false, elapsedMs: SLOW })).toBe('locked_out');
    });

    it('an instant lockout (sensor already locked elsewhere) never wipes', () => {
        const lockout = { success: false as const, error: 'lockout' };
        expect(classifyAuthAttempt(lockout, { distressEnabled: true, elapsedMs: FAST })).toBe('locked_out');
        expect(
            classifyAuthAttempt(lockout, { distressEnabled: true, elapsedMs: MIN_PROMPT_MS_FOR_DISTRESS - 1 })
        ).toBe('locked_out');
        expect(
            classifyAuthAttempt(lockout, { distressEnabled: true, elapsedMs: MIN_PROMPT_MS_FOR_DISTRESS })
        ).toBe('wipe');
    });

    it('ONLY a lockout can wipe: no other error, however slow, destroys data', () => {
        const errors = [
            'user_cancel', 'app_cancel', 'system_cancel', 'user_fallback', 'timeout',
            'authentication_failed', 'unknown', 'not_enrolled', 'not_available',
            'passcode_not_set', 'unable_to_process', 'no_space', 'invalid_context',
        ];
        for (const error of errors) {
            expect(
                classifyAuthAttempt({ success: false, error }, { distressEnabled: true, elapsedMs: 60_000 })
            ).not.toBe('wipe');
        }
    });

    it('a cancel keeps the app locked; a missing sensor reports unavailable', () => {
        expect(classifyAuthAttempt({ success: false, error: 'user_cancel' }, { distressEnabled: false, elapsedMs: 0 }))
            .toBe('dismissed');
        expect(classifyAuthAttempt({ success: false, error: 'not_enrolled' }, { distressEnabled: false, elapsedMs: 0 }))
            .toBe('unavailable');
    });
});

describe('promptOptionsFor', () => {
    it('distress mode is biometric-only (a PIN fallback would hide the lockout)', () => {
        expect(promptOptionsFor({ distressEnabled: true, biometricsEnrolled: true }).disableDeviceFallback).toBe(true);
    });

    it('without distress the device PIN is always allowed', () => {
        expect(promptOptionsFor({ distressEnabled: false, biometricsEnrolled: true }).disableDeviceFallback).toBe(false);
    });

    it('never biometric-only when no biometrics are enrolled (would be unpassable)', () => {
        expect(promptOptionsFor({ distressEnabled: true, biometricsEnrolled: false }).disableDeviceFallback).toBe(false);
    });

    it('a biometric-only prompt has a cancel label (Android requires a negative button)', () => {
        expect(promptOptionsFor({ distressEnabled: true, biometricsEnrolled: true }).cancelLabel).toBeTruthy();
    });
});

describe('failsOpen / enable blockers', () => {
    it('only a device with no security at all opens without a prompt', () => {
        expect(failsOpen(0)).toBe(true);
        expect(failsOpen(1)).toBe(false);
        expect(failsOpen(3)).toBe(false);
    });

    it('the lock needs a screen lock or biometrics; the wipe needs biometrics', () => {
        expect(appLockBlocker({ securityLevel: 0 })).toBe('no_screen_lock');
        expect(appLockBlocker({ securityLevel: 1 })).toBeNull();
        expect(distressWipeBlocker({ enrolled: false, securityLevel: 1 })).toBe('no_biometrics');
        expect(distressWipeBlocker({ enrolled: false, securityLevel: 0 })).toBe('no_screen_lock');
        expect(distressWipeBlocker({ enrolled: true, securityLevel: 3 })).toBeNull();
    });
});

describe('shouldLockOnAppStateChange', () => {
    it('locks on background when enabled', () => {
        expect(shouldLockOnAppStateChange('background', { lockEnabled: true, authInFlight: false })).toBe(true);
    });

    it('never locks when the lock is off', () => {
        expect(shouldLockOnAppStateChange('background', { lockEnabled: false, authInFlight: false })).toBe(false);
    });

    it('ignores the pause caused by our own PIN prompt (would loop forever)', () => {
        expect(shouldLockOnAppStateChange('background', { lockEnabled: true, authInFlight: true })).toBe(false);
    });

    it('inactive / active do not lock', () => {
        for (const s of ['inactive', 'active', 'unknown', 'extension']) {
            expect(shouldLockOnAppStateChange(s, { lockEnabled: true, authInFlight: false })).toBe(false);
        }
    });
});

describe('lockMessageFor', () => {
    it('a distress wipe looks EXACTLY like a plain lockout on screen', () => {
        expect(lockMessageFor('wipe')).toBe(lockMessageFor('locked_out'));
        expect(lockMessageFor('wipe')).toBeTruthy();
    });

    it('no copy anywhere on the lock screen mentions wiping or erasing', () => {
        for (const o of ['wipe', 'locked_out', 'dismissed', 'unavailable', 'unlock', null] as const) {
            expect(lockMessageFor(o) ?? '').not.toMatch(/wip|eras|delet|distress/i);
        }
    });
});

describe('Settings copy', () => {
    const w = distressWarningFor(DEFAULT_DISTRESS_SCOPE);

    it('the default confirmation is short, says it cannot be undone, and asks for a backup', () => {
        expect(w).toMatch(/notes, photos and other private details/);
        expect(w).toMatch(/mood scores stay/);
        expect(w).not.toContain(DISTRESS_CATEGORY_COPY.reminderNames.label);
        expect(w).toMatch(/cannot be undone/);
        expect(w).toMatch(/backup/i);
        expect(w).toMatch(/by accident/);
        expect(w).toMatch(/usually 5/);
        expect(APP_LOCK_COPY.distressActiveHint).toMatch(/backup/i);
    });

    it('a custom selection is listed in full, with what is kept', () => {
        const custom = { ...DEFAULT_DISTRESS_SCOPE, health: false };
        const text = distressWarningFor(custom);
        for (const c of DISTRESS_CATEGORIES) {
            if (custom[c]) expect(text).toContain(DISTRESS_CATEGORY_COPY[c].label);
        }
        expect(text).toContain(keptSummary(custom));
    });

    it('the warning follows the selection: a kept category is not listed', () => {
        const scope = { ...DEFAULT_DISTRESS_SCOPE, health: false };
        expect(distressWarningFor(scope)).not.toContain(DISTRESS_CATEGORY_COPY.health.label);
    });

    it('the description says what triggers it, not just "fails too many times"', () => {
        expect(APP_LOCK_COPY.distressDescription).toMatch(/usually 5/);
        expect(APP_LOCK_COPY.distressDescription).toMatch(/wrong finger until Android blocks biometrics/);
    });

    it('the default is explained: an empty mood tracker can look suspicious', () => {
        expect(APP_LOCK_COPY.distressWhyDefault).toMatch(/empty .*suspicious/);
        expect(APP_LOCK_COPY.eraseEntriesWarning).toMatch(/suspicious/);
    });

    it('technical details state the Android rule and link its source', () => {
        const d = DISTRESS_TECH_DETAILS.join(' ');
        expect(d).toMatch(/30 seconds after 5 wrong attempts/);
        expect(d).toMatch(/at most 20/);
        expect(d).toMatch(/already blocked/);
        expect(d).toMatch(/no PIN option/);
        expect(ANDROID_BIOMETRIC_RULE_URL).toMatch(/^https:\/\/source\.android\.com\/.*cdd#7310_biometric_sensors$/);
    });
});
