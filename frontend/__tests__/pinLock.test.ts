/**
 * The app-lock PIN rules (lib/pinLock.ts): what a valid PIN is, and how long
 * the lock screen makes you wait after wrong PINs.
 */
import {
    BASE_COOLDOWN_MS,
    FREE_ATTEMPTS,
    MAX_COOLDOWN_MS,
    PIN_MAX_LENGTH,
    PIN_MIN_LENGTH,
    PIN_PROBLEM_COPY,
    cooldownMs,
    pinProblem,
    remainingWaitMs,
    shouldLockOnAppStateChange,
    waitMessage,
} from '@/lib/pinLock';

describe('pinProblem', () => {
    it('accepts 4 to 8 digits', () => {
        expect(pinProblem('1234')).toBeNull();
        expect(pinProblem('12345678')).toBeNull();
    });

    it('rejects too short, too long and non-digits', () => {
        expect(pinProblem('123')).toBe('too_short');
        expect(pinProblem('123456789')).toBe('too_long');
        expect(pinProblem('12a4')).toBe('not_digits');
        expect(pinProblem(' 1234')).toBe('not_digits');
    });

    it('the confirmation must match, and the distress PIN must differ from the app PIN', () => {
        expect(pinProblem('1234', { confirm: '1235' })).toBe('mismatch');
        expect(pinProblem('1234', { confirm: '1234' })).toBeNull();
        expect(pinProblem('1234', { mustDifferFrom: '1234' })).toBe('same_as_app_pin');
    });

    it('every problem has copy', () => {
        for (const text of Object.values(PIN_PROBLEM_COPY)) expect(text.length).toBeGreaterThan(0);
        expect(PIN_PROBLEM_COPY.too_short).toContain(String(PIN_MIN_LENGTH));
        expect(PIN_PROBLEM_COPY.too_long).toContain(String(PIN_MAX_LENGTH));
    });
});

describe('wrong-PIN wait', () => {
    it(`no wait for the first ${FREE_ATTEMPTS - 1} wrong PINs`, () => {
        for (let f = 0; f < FREE_ATTEMPTS; f++) expect(cooldownMs(f)).toBe(0);
    });

    it('then 30 s, doubling, capped', () => {
        expect(cooldownMs(FREE_ATTEMPTS)).toBe(BASE_COOLDOWN_MS);
        expect(cooldownMs(FREE_ATTEMPTS + 1)).toBe(BASE_COOLDOWN_MS * 2);
        expect(cooldownMs(FREE_ATTEMPTS + 30)).toBe(MAX_COOLDOWN_MS);
    });

    it('counts down from the last wrong PIN', () => {
        const state = { failures: FREE_ATTEMPTS, lastFailureAt: 1_000 };
        expect(remainingWaitMs(state, 1_000)).toBe(BASE_COOLDOWN_MS);
        expect(remainingWaitMs(state, 1_000 + BASE_COOLDOWN_MS)).toBe(0);
        expect(remainingWaitMs({ failures: 2, lastFailureAt: 1_000 }, 1_000)).toBe(0);
    });

    it('says how long to wait, and never mentions anything but the PIN', () => {
        expect(waitMessage(25_000)).toMatch(/25 s/);
        expect(waitMessage(120_000)).toMatch(/2 min/);
        expect(waitMessage(25_000)).not.toMatch(/distress|wipe|eras/i);
    });
});

describe('shouldLockOnAppStateChange', () => {
    it('locks on background when enabled', () => {
        expect(shouldLockOnAppStateChange('background', { lockEnabled: true })).toBe(true);
        expect(shouldLockOnAppStateChange('background', { lockEnabled: false })).toBe(false);
        for (const s of ['inactive', 'active', 'unknown']) {
            expect(shouldLockOnAppStateChange(s, { lockEnabled: true })).toBe(false);
        }
    });
});
