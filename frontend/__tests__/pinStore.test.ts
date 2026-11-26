/**
 * The PIN store (lib/pinStore.ts) with REAL Argon2id (the expo-argon2 mock runs
 * @noble/hashes) and the in-memory SecureStore mock.
 *
 * The rule under test: nothing about a check may reveal whether a distress PIN
 * exists. Every check derives exactly two hashes, whatever is stored.
 */
import * as SecureStore from 'expo-secure-store';
import * as Argon2 from 'expo-argon2';
import {
    checkPin,
    clearAllPins,
    clearDistressPin,
    hasAppPin,
    isAppPin,
    PIN_KDF,
    readFailures,
    setAppPin,
    setDistressPin,
    writeFailures,
} from '@/lib/pinStore';

const store = SecureStore as unknown as { __reset: () => void; __dump: () => Record<string, string> };
const argon = Argon2 as unknown as { calls: unknown[] };

beforeEach(() => {
    store.__reset();
    argon.calls.length = 0;
});

describe('pin store', () => {
    it('starts with no PIN; nothing opens', async () => {
        expect(await hasAppPin()).toBe(false);
        expect(await checkPin('1234')).toBe('wrong');
    });

    it('the app PIN opens as "app"; other PINs are wrong', async () => {
        await setAppPin('1234');
        expect(await hasAppPin()).toBe(true);
        expect(await checkPin('1234')).toBe('app');
        expect(await checkPin('4321')).toBe('wrong');
        expect(await isAppPin('1234')).toBe(true);
        expect(await isAppPin('9999')).toBe(false);
    });

    it('the distress PIN opens as "distress"; the app PIN still opens as "app"', async () => {
        await setAppPin('1234');
        await setDistressPin('9999');
        expect(await checkPin('9999')).toBe('distress');
        expect(await checkPin('1234')).toBe('app');
        expect(await checkPin('5555')).toBe('wrong');
    });

    it('a distress PIN needs an app PIN first', async () => {
        await expect(setDistressPin('9999')).rejects.toThrow();
    });

    it('never stores a PIN in the clear', async () => {
        await setAppPin('1234');
        await setDistressPin('987654');
        const raw = JSON.stringify(store.__dump());
        expect(raw).not.toContain('1234');
        expect(raw).not.toContain('987654');
    });

    it('every check costs the same two derivations, with or without a distress PIN', async () => {
        await setAppPin('1234');
        argon.calls.length = 0;
        await checkPin('0000');
        const without = argon.calls.length;

        await setDistressPin('9999');
        argon.calls.length = 0;
        await checkPin('0000');
        const withDistress = argon.calls.length;

        expect(without).toBe(2);
        expect(withDistress).toBe(2);
        expect(argon.calls.every(c => (c as { memoryCost: number }).memoryCost === PIN_KDF.memoryKiB)).toBe(true);
    });

    it('clearing the distress PIN leaves no trace of it; the app PIN keeps working', async () => {
        await setAppPin('1234');
        const before = JSON.parse(Object.values(store.__dump())[0]);
        await setDistressPin('9999');
        await clearDistressPin();
        const after = JSON.parse(Object.values(store.__dump())[0]);
        expect(after.distress).toBeNull();
        expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
        expect(await checkPin('9999')).toBe('wrong');
        expect(await checkPin('1234')).toBe('app');
    });

    it('changing the app PIN keeps the distress PIN', async () => {
        await setAppPin('1234');
        await setDistressPin('9999');
        await setAppPin('2468');
        expect(await checkPin('2468')).toBe('app');
        expect(await checkPin('1234')).toBe('wrong');
        expect(await checkPin('9999')).toBe('distress');
    });

    it('clearAllPins forgets both PINs and the failure count', async () => {
        await setAppPin('1234');
        await setDistressPin('9999');
        await writeFailures({ failures: 3, lastFailureAt: 5 });
        await clearAllPins();
        expect(await hasAppPin()).toBe(false);
        expect(await readFailures()).toEqual({ failures: 0, lastFailureAt: 0 });
        expect(store.__dump()).toEqual({});
    });

    it('failures persist and reset', async () => {
        await writeFailures({ failures: 2, lastFailureAt: 42 });
        expect(await readFailures()).toEqual({ failures: 2, lastFailureAt: 42 });
        await writeFailures({ failures: 0, lastFailureAt: 0 });
        expect(await readFailures()).toEqual({ failures: 0, lastFailureAt: 0 });
    });
});
