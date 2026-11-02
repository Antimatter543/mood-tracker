import * as SecureStore from 'expo-secure-store';

import {
  BackupKey,
  KdfHeader,
  KdfParams,
  base64ToBytes,
  bytesEqual,
  bytesToBase64,
  createBackupKey,
  deriveBackupKey,
  isValidKdfHeader,
} from '@/lib/backupCrypto';
import { KDF_TARGET_MS, calibrateKdfParams } from '@/lib/backupKdfCalibration';
import {
  DEFAULT_KDF_PROFILE,
  KdfProfile,
  ceilingsForProfile,
  deviceTotalMemory,
  isKdfProfile,
} from '@/lib/backupKdfProfiles';

/**
 * Where the backup-encryption key lives: expo-secure-store, i.e. a value
 * encrypted by a key held in the Android Keystore (iOS: the Keychain), and
 * NEVER in SQLite. That keeps it out of `user_settings`, which every backup
 * exports, and its presence is the single source of truth for "Encrypt
 * backups" being on (no separate setting that could disagree with it).
 *
 * The PASSWORD is never stored, only the Argon2id-derived key plus the salt
 * and params it came from. So the password cannot be read back out of the
 * app (it can only be replaced), and making a backup does not re-run the
 * slow KDF. `*_THIS_DEVICE_ONLY` keeps the item out of device backups and
 * migrations.
 *
 * Three states, kept apart on purpose: "off" (nothing stored), "on", and
 * "unreadable" (something IS stored but it cannot be read, or the Keystore
 * itself failed). Unreadable must never be treated as off: export would then
 * silently write a PLAIN backup for someone who asked for encryption.
 *
 * Next to the key: the strength mode it was made in (lib/backupKdfProfiles.ts),
 * so a password change keeps the mode. Keys stored before modes existed have
 * none and read as the default, "Compatibility", which is what made them.
 */

const STORE_KEY = 'backup_encryption_key_v1';
/** When the user last proved they still know the password (ms since epoch). */
const CONFIRMED_AT_KEY = 'backup_password_confirmed_at_v1';
const STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
const KEY_BYTES = 32;

/** How often export asks the user to type the password again (skippable). */
export const PASSWORD_CONFIRM_INTERVAL_MS = 14 * 24 * 60 * 60 * 1000;

interface StoredBackupKey {
  kdf: KdfHeader;
  key: string;
  profile?: KdfProfile;
}

export type BackupKeyState =
  | { status: 'off' }
  | { status: 'on'; key: BackupKey; profile: KdfProfile }
  | { status: 'unreadable'; message: string };

const UNREADABLE_MESSAGE =
  "Your backup password couldn't be read from this phone's secure storage. Enter your backup password again to keep encrypting backups.";

export class BackupKeyUnreadableError extends Error {
  constructor(message = UNREADABLE_MESSAGE) {
    super(message);
    this.name = 'BackupKeyUnreadableError';
  }
}

/** Pure: parse what was stored. `null` = present but not a usable key. */
export function parseStoredBackupKey(raw: string): BackupKey | null {
  return parseStoredEntry(raw)?.key ?? null;
}

function parseStoredEntry(raw: string): { key: BackupKey; profile: KdfProfile } | null {
  try {
    const stored = JSON.parse(raw) as Partial<StoredBackupKey> | null;
    if (!stored || !isValidKdfHeader(stored.kdf) || typeof stored.key !== 'string') return null;
    const key = base64ToBytes(stored.key);
    if (key.length !== KEY_BYTES) return null;
    const profile = isKdfProfile(stored.profile) ? stored.profile : DEFAULT_KDF_PROFILE;
    return { key: { kdf: stored.kdf, key }, profile };
  } catch {
    return null;
  }
}

/** Read the stored key and say which of the three states it is in. Never throws. */
export async function readBackupKeyState(): Promise<BackupKeyState> {
  let raw: string | null;
  try {
    raw = await SecureStore.getItemAsync(STORE_KEY, STORE_OPTIONS);
  } catch {
    return { status: 'unreadable', message: UNREADABLE_MESSAGE };
  }
  if (!raw) return { status: 'off' };
  const entry = parseStoredEntry(raw);
  return entry
    ? { status: 'on', key: entry.key, profile: entry.profile }
    : { status: 'unreadable', message: UNREADABLE_MESSAGE };
}

/**
 * The stored backup key, or `null` when backup encryption is off. Throws
 * `BackupKeyUnreadableError` when a key is stored but cannot be read.
 */
export async function getBackupKey(): Promise<BackupKey | null> {
  const state = await readBackupKeyState();
  if (state.status === 'unreadable') throw new BackupKeyUnreadableError(state.message);
  return state.status === 'on' ? state.key : null;
}

export async function isBackupEncryptionEnabled(): Promise<boolean> {
  return (await readBackupKeyState()).status !== 'off';
}

/**
 * Is `password` the current backup password? Derives under the stored salt
 * and params and compares in constant time. False when encryption is off or
 * the stored key is unreadable (there is nothing to check against).
 */
export async function verifyBackupPassword(password: string): Promise<boolean> {
  const state = await readBackupKeyState();
  if (state.status !== 'on') return false;
  const candidate = await deriveBackupKey(password, state.key.kdf);
  return bytesEqual(candidate.key, state.key.key);
}

/**
 * The params a new key gets in `profile`: the on-device calibration within
 * the mode's ceilings. "Manual" has no calibration; its params are passed in.
 */
export async function calibrateForProfile(profile: Exclude<KdfProfile, 'manual'>): Promise<KdfParams> {
  const ceilings = ceilingsForProfile(profile, deviceTotalMemory());
  return (await calibrateKdfParams(KDF_TARGET_MS, undefined, ceilings)).params;
}

/**
 * Turn encryption on, change the password or change the strength mode:
 * measure this phone for the Argon2id cost (unless `params` are given: the
 * background calibration, manual params, or tests), derive a key under a
 * FRESH salt and replace whatever was stored. Backups made before still open,
 * by entering the password they were made with on restore. Counts as a
 * confirmation: the user just typed the password.
 */
export async function setBackupPassword(
  password: string,
  params?: KdfParams,
  profile: KdfProfile = DEFAULT_KDF_PROFILE
): Promise<void> {
  if (!params && profile === 'manual') throw new Error('Manual mode needs explicit parameters.');
  const kdfParams = params ?? (await calibrateForProfile(profile as Exclude<KdfProfile, 'manual'>));
  const backupKey = await createBackupKey(password, kdfParams);
  const stored: StoredBackupKey = { kdf: backupKey.kdf, key: bytesToBase64(backupKey.key), profile };
  await SecureStore.setItemAsync(STORE_KEY, JSON.stringify(stored), STORE_OPTIONS);
  await markPasswordConfirmed();
}

/** Turn encryption off: future backups are plain JSON again. */
export async function clearBackupPassword(): Promise<void> {
  await SecureStore.deleteItemAsync(STORE_KEY, STORE_OPTIONS);
  await SecureStore.deleteItemAsync(CONFIRMED_AT_KEY, STORE_OPTIONS);
}

/** When the password was last set or confirmed, or `null` if never recorded. */
export async function getPasswordConfirmedAt(): Promise<number | null> {
  try {
    const raw = await SecureStore.getItemAsync(CONFIRMED_AT_KEY, STORE_OPTIONS);
    const value = raw === null ? NaN : Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export async function markPasswordConfirmed(now: number = Date.now()): Promise<void> {
  await SecureStore.setItemAsync(CONFIRMED_AT_KEY, String(now), STORE_OPTIONS);
}

/**
 * Pure: should export ask the user to confirm the password? Yes when it was
 * never recorded or the last confirmation is older than the interval. A
 * timestamp in the future (clock moved back) counts as due, not as "fresh
 * forever".
 */
export function isPasswordConfirmationDue(
  confirmedAt: number | null,
  now: number,
  intervalMs: number = PASSWORD_CONFIRM_INTERVAL_MS
): boolean {
  if (confirmedAt === null || confirmedAt > now) return true;
  return now - confirmedAt > intervalMs;
}
