/**
 * The PIN store (lib/pinStore.ts) against the in-memory SecureStore mock.
 * The PINs live only in SecureStore (Keystore-encrypted, this device only);
 * every check compares the typed PIN with BOTH slots.
 */
import * as SecureStore from 'expo-secure-store';
import {
    checkPin,
    clearAllPins,
    clearDistressPin,
    hasAppPin,
    isAppPin,
    readFailures,
    samePin,
    setAppPin,
    setDistressPin,
    writeFailures,
} from '@/lib/pinStore';

const store = SecureStore as unknown as { __reset: () => void; __dump: () => Record<string, string> };

beforeEach(() => store.__reset());

describe('samePin', () => {
    it('is true only for the same PIN', () => {
        expect(samePin('1234', '1234')).toBe(true);
        expect(samePin('1234', '1235')).toBe(false);
        expect(samePin('1234', '12345')).toBe(false);
        expect(samePin('12345678', '12345678')).toBe(true);
        expect(samePin('', '')).toBe(true);
        expect(samePin('1234', '')).toBe(false);
    });
});

describe('pin store', () => {
    it('starts with no PIN; nothing opens', async () => {
        expect(await hasAppPin()).toBe(false);
        expect(await checkPin('1234')).toBe('wrong');
        expect(await checkPin('')).toBe('wrong');
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

    it('an empty distress slot never matches (not even an empty input)', async () => {
        await setAppPin('1234');
        expect(await checkPin('')).toBe('wrong');
    });

    it('a distress PIN needs an app PIN first', async () => {
        await expect(setDistressPin('9999')).rejects.toThrow();
    });

    it('the PINs live only in SecureStore, under one key, this device only', async () => {
        const setItem = jest.spyOn(SecureStore, 'setItemAsync');
        await setAppPin('1234');
        await setDistressPin('9999');
        expect(Object.keys(store.__dump())).toEqual(['app_lock_pins_v2']);
        for (const call of setItem.mock.calls) {
            expect(call[2]).toEqual({ keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
        }
        setItem.mockRestore();
    });

    it('clearing the distress PIN leaves no trace of it; the app PIN keeps working', async () => {
        await setAppPin('1234');
        const before = store.__dump().app_lock_pins_v2;
        await setDistressPin('9999');
        await clearDistressPin();
        expect(store.__dump().app_lock_pins_v2).toBe(before);
        expect(store.__dump().app_lock_pins_v2).not.toContain('9999');
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
