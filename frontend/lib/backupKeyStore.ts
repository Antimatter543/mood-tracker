import * as SecureStore from 'expo-secure-store';

import {
  BackupKey,
  KdfHeader,
  KdfParams,
  base64ToBytes,
  bytesToBase64,
  createBackupKey,
} from '@/lib/backupCrypto';
import { calibrateKdfParams } from '@/lib/backupKdfCalibration';

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
 */

const STORE_KEY = 'backup_encryption_key_v1';
const STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

interface StoredBackupKey {
  kdf: KdfHeader;
  key: string;
}

/** The stored backup key, or `null` when backup encryption is off. */
export async function getBackupKey(): Promise<BackupKey | null> {
  const raw = await SecureStore.getItemAsync(STORE_KEY, STORE_OPTIONS);
  if (!raw) return null;
  try {
    const stored = JSON.parse(raw) as StoredBackupKey;
    if (!stored?.kdf || typeof stored.key !== 'string') return null;
    return { kdf: stored.kdf, key: base64ToBytes(stored.key) };
  } catch {
    return null;
  }
}

export async function isBackupEncryptionEnabled(): Promise<boolean> {
  return (await getBackupKey()) !== null;
}

/**
 * Turn encryption on, or change the password: measure this phone for the
 * Argon2id cost (unless `params` are given, as tests do), derive a key under a
 * FRESH salt and replace whatever was stored. Backups made with the previous
 * password still open, by entering that password on restore.
 */
export async function setBackupPassword(password: string, params?: KdfParams): Promise<void> {
  const kdfParams = params ?? (await calibrateKdfParams()).params;
  const backupKey = await createBackupKey(password, kdfParams);
  const stored: StoredBackupKey = { kdf: backupKey.kdf, key: bytesToBase64(backupKey.key) };
  await SecureStore.setItemAsync(STORE_KEY, JSON.stringify(stored), STORE_OPTIONS);
}

/** Turn encryption off: future backups are plain JSON again. */
export async function clearBackupPassword(): Promise<void> {
  await SecureStore.deleteItemAsync(STORE_KEY, STORE_OPTIONS);
}
