import * as SecureStore from 'expo-secure-store';

/**
 * The app-lock PINs: the app PIN and the optional distress PIN.
 *
 * Stored as they are, in expo-secure-store: encrypted with a key in the Android
 * Keystore, *_THIS_DEVICE_ONLY (never in a device backup), never in SQLite (so
 * never in a SoulSync backup either). Hashing would add nothing: a 4 to 8 digit
 * PIN is brute-forced offline in seconds whatever the hash. What protects it is
 * the Keystore and the wait after wrong PINs (lib/pinLock.ts).
 *
 * Indistinguishability (the whole point, see lib/pinLock.ts): every check
 * compares the typed PIN with BOTH slots, in constant time per slot. Without a
 * distress PIN the second slot is empty and simply never matches.
 */

const PINS_KEY = 'app_lock_pins_v2';
const FAILURES_KEY = 'app_lock_failures_v1';
const OPTIONS: SecureStore.SecureStoreOptions = {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

type Stored = { v: 2; app: string; distress: string | null };

export type PinCheck = 'app' | 'distress' | 'wrong';

/** Longest PIN the pad accepts (lib/pinLock.ts PIN_MAX_LENGTH), the comparison window. */
const COMPARE_LENGTH = 8;

/** Equal, in time that does not depend on where the two first differ. */
export function samePin(a: string, b: string): boolean {
    let diff = a.length ^ b.length;
    for (let i = 0; i < COMPARE_LENGTH; i++) {
        diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
    }
    return diff === 0;
}

async function readStored(): Promise<Stored | null> {
    try {
        const raw = await SecureStore.getItemAsync(PINS_KEY, OPTIONS);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Stored;
        return parsed && parsed.v === 2 && typeof parsed.app === 'string' && parsed.app ? parsed : null;
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

/** Set (or replace) the app PIN. Keeps an existing distress PIN, which it must not equal. */
export async function setAppPin(pin: string): Promise<void> {
    const stored = await readStored();
    if (stored?.distress && samePin(pin, stored.distress)) throw new Error('Same as the distress PIN.');
    await writeStored({ v: 2, app: pin, distress: stored?.distress ?? null });
}

/** Set (or replace) the distress PIN. Needs an app PIN first, which it must not equal. */
export async function setDistressPin(pin: string): Promise<void> {
    const stored = await readStored();
    if (!stored) throw new Error('Set an app PIN first.');
    if (samePin(pin, stored.app)) throw new Error('Same as the app PIN.');
    await writeStored({ ...stored, distress: pin });
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

/** Which slot `pin` opens. Both slots are always compared. */
export async function checkPin(pin: string): Promise<PinCheck> {
    const stored = await readStored();
    const isApp = samePin(pin, stored?.app ?? '');
    const isDistress = samePin(pin, stored?.distress ?? '');
    if (stored && isApp) return 'app';
    if (stored?.distress && isDistress) return 'distress';
    return 'wrong';
}

/**
 * Whether `pin` is already taken by the OTHER slot (Settings: the two PINs
 * must always differ, whichever one is being chosen or changed).
 */
export async function isOtherPin(pin: string, slot: 'app' | 'distress'): Promise<boolean> {
    const stored = await readStored();
    if (!stored) return false;
    const other = slot === 'app' ? stored.distress : stored.app;
    return !!other && samePin(pin, other);
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
