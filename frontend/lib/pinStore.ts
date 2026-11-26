import * as SecureStore from 'expo-secure-store';
import { getRandomBytes } from 'expo-crypto';

import { argon2id } from '@/lib/argon2';
import { base64ToBytes, bytesEqual, bytesToBase64, KdfParams } from '@/lib/backupCrypto';

/**
 * The app-lock PINs: the app PIN and the optional distress PIN.
 *
 * Neither PIN is stored, only an Argon2id hash with its own random salt, in
 * expo-secure-store (Android Keystore, *_THIS_DEVICE_ONLY: never in a device
 * backup, never in SQLite, so never in a SoulSync backup either).
 *
 * Indistinguishability (the whole point, see lib/pinLock.ts): every check
 * derives TWO hashes, one per slot. Without a distress PIN the second slot is a
 * random dummy that nothing can match. So a check costs the same with or
 * without a distress PIN, and the answer only says which slot matched.
 */

const PINS_KEY = 'app_lock_pins_v1';
const FAILURES_KEY = 'app_lock_failures_v1';
const OPTIONS: SecureStore.SecureStoreOptions = {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

/**
 * OWASP's Argon2id minimum (19 MiB, 2 passes, 1 lane): a short PIN can never be
 * strong, so the hash is about not storing it in the clear, and the wait after
 * wrong PINs (lib/pinLock.ts) is what limits guessing in the app.
 */
export const PIN_KDF: KdfParams = { name: 'argon2id', memoryKiB: 19 * 1024, iterations: 2, parallelism: 1 };
let kdf: KdfParams = PIN_KDF;

/**
 * TEST ONLY: cheaper Argon2 params. Jest runs Argon2 in pure JS (about 1.5 s per
 * hash at PIN_KDF), so UI tests that type PINs lower it; pinStore.test.ts keeps
 * the real params and asserts them.
 */
export function __setPinKdfForTests(params: KdfParams | null): void {
    kdf = params ?? PIN_KDF;
}
const SALT_BYTES = 16;

type Slot = { salt: string; hash: string };
type Stored = { v: 1; app: Slot; distress: Slot | null };

export type PinCheck = 'app' | 'distress' | 'wrong';

const pinBytes = (pin: string) => new TextEncoder().encode(pin);

async function hashPin(pin: string, salt: Uint8Array): Promise<Uint8Array> {
    return argon2id(pinBytes(pin), salt, kdf);
}

async function makeSlot(pin: string): Promise<Slot> {
    const salt = getRandomBytes(SALT_BYTES);
    return { salt: bytesToBase64(salt), hash: bytesToBase64(await hashPin(pin, salt)) };
}

async function readStored(): Promise<Stored | null> {
    try {
        const raw = await SecureStore.getItemAsync(PINS_KEY, OPTIONS);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Stored;
        return parsed && parsed.v === 1 && parsed.app ? parsed : null;
    } catch {
        return null;
    }
}

async function writeStored(stored: Stored): Promise<void> {
    await SecureStore.setItemAsync(PINS_KEY, JSON.stringify(stored), OPTIONS);
}

export async function hasAppPin(): Promise<boolean> {
    return (await readStored()) !== null;
}

/** Set (or replace) the app PIN. Keeps an existing distress PIN. */
export async function setAppPin(pin: string): Promise<void> {
    const stored = await readStored();
    await writeStored({ v: 1, app: await makeSlot(pin), distress: stored?.distress ?? null });
}

/** Set the distress PIN. Needs an app PIN first. */
export async function setDistressPin(pin: string): Promise<void> {
    const stored = await readStored();
    if (!stored) throw new Error('Set an app PIN first.');
    await writeStored({ ...stored, distress: await makeSlot(pin) });
}

/** Forget the distress PIN, leaving no trace that there was one. */
export async function clearDistressPin(): Promise<void> {
    const stored = await readStored();
    if (stored) await writeStored({ ...stored, distress: null });
}

/** Forget both PINs and the failure count (app lock off). */
export async function clearAllPins(): Promise<void> {
    await SecureStore.deleteItemAsync(PINS_KEY, OPTIONS);
    await SecureStore.deleteItemAsync(FAILURES_KEY, OPTIONS);
}

/** Which slot `pin` opens. Always the same work, whatever is stored. */
export async function checkPin(pin: string): Promise<PinCheck> {
    const stored = await readStored();
    const dummy: Slot = { salt: bytesToBase64(getRandomBytes(SALT_BYTES)), hash: bytesToBase64(getRandomBytes(32)) };
    const app = stored?.app ?? dummy;
    const distress = stored?.distress ?? dummy;
    // Both derivations always run, in a fixed order, before either is compared.
    const appHash = await hashPin(pin, base64ToBytes(app.salt));
    const distressHash = await hashPin(pin, base64ToBytes(distress.salt));
    const isApp = stored !== null && bytesEqual(appHash, base64ToBytes(app.hash));
    const isDistress = stored?.distress != null && bytesEqual(distressHash, base64ToBytes(distress.hash));
    if (isApp) return 'app';
    if (isDistress) return 'distress';
    return 'wrong';
}

/** Whether `pin` is the current app PIN (Settings: the distress PIN must differ). */
export async function isAppPin(pin: string): Promise<boolean> {
    const stored = await readStored();
    if (!stored) return false;
    return bytesEqual(await hashPin(pin, base64ToBytes(stored.app.salt)), base64ToBytes(stored.app.hash));
}

/** Wrong PINs in a row, persisted so a restart cannot skip the wait. */
export type FailureState = { failures: number; lastFailureAt: number };

export async function readFailures(): Promise<FailureState> {
    try {
        const raw = await SecureStore.getItemAsync(FAILURES_KEY, OPTIONS);
        const parsed = raw ? (JSON.parse(raw) as FailureState) : null;
        if (parsed && Number.isFinite(parsed.failures) && Number.isFinite(parsed.lastFailureAt)) return parsed;
    } catch {
        // fall through
    }
    return { failures: 0, lastFailureAt: 0 };
}

export async function writeFailures(state: FailureState): Promise<void> {
    try {
        if (state.failures === 0) await SecureStore.deleteItemAsync(FAILURES_KEY, OPTIONS);
        else await SecureStore.setItemAsync(FAILURES_KEY, JSON.stringify(state), OPTIONS);
    } catch {
        // a failed write must never block unlocking
    }
}
