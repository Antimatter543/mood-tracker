import {
  AESEncryptionKey,
  AESSealedData,
  aesDecryptAsync,
  aesEncryptAsync,
  getRandomBytes,
} from 'expo-crypto';

import { argon2id } from '@/lib/argon2';

/**
 * Password-encrypted backups (opt-in, off by default).
 *
 * THE FORMAT. An encrypted backup is still a `.json` file, so the share sheet,
 * the document picker's `application/json` filter and every "Save to Drive /
 * Files" target keep working unchanged. Its top-level shape is an ENVELOPE:
 *
 *   { format: 'soulsync-encrypted-backup', version: 1, _note,
 *     kdf: { name: 'argon2id', memoryKiB, iterations, parallelism, salt },
 *     cipher: 'aes-256-gcm', iv: base64(12 bytes), payload: base64(ciphertext || tag) }
 *
 * The v1 format is FROZEN: __fixtures__/encryptedBackupV1.ts holds a file
 * built independently from this description, and a test requires it to keep
 * opening. Any change to the layout needs a new `version`.
 *
 * The plaintext inside `payload` is the exact JSON a plain export writes, so
 * decrypting yields a normal v3 backup and the import path below it is shared.
 * The envelope deliberately has NO `data` field: an older app version (which
 * validates `version` + `data`) rejects it as "Invalid data format" instead of
 * "importing" an empty object.
 *
 * THE CRYPTO.
 *  - Key: Argon2id (RFC 9106) over the UTF-8 bytes of the NFC-normalized
 *    password, with a random 16-byte salt. NFC, because the same visible
 *    password ("é") can be typed as one code point or as "e" plus a combining
 *    accent depending on the keyboard; without it a backup made on one phone
 *    would not open with the "same" password typed on another.
 *    Memory-hard, so guessing passwords on GPUs/ASICs is expensive. Native
 *    (expo-argon2) with a JS fallback for Expo Go, see lib/argon2.ts. The
 *    params are calibrated on the phone itself to ~500 ms
 *    (lib/backupKdfCalibration.ts) and written into each file, so any phone
 *    can re-derive them. The cost is paid when the password is set (and when
 *    a backup from another device or an older password is opened), never per
 *    backup: the derived key is stored, see lib/backupKeyStore.ts.
 *  - Cipher: AES-256-GCM through expo-crypto, i.e. the platform's native
 *    implementation (fast on multi-MB photo backups), fresh random 96-bit IV
 *    per backup (its length passed explicitly, stored in its own field),
 *    128-bit tag. The header (format, version, KDF params, salt,
 *    cipher) is the GCM additional data, so editing any of it fails decryption.
 *
 * What protects a backup is the password. There is no recovery and no
 * backdoor: a forgotten password means the backup cannot be opened, by anyone.
 */

export const ENCRYPTED_BACKUP_FORMAT = 'soulsync-encrypted-backup';
export const ENCRYPTED_BACKUP_VERSION = 1;
export const BACKUP_CIPHER = 'aes-256-gcm';
export const MIN_BACKUP_PASSWORD_LENGTH = 8;

export interface KdfParams {
  name: 'argon2id';
  /** Argon2 memory cost in KiB. */
  memoryKiB: number;
  /** Argon2 time cost (passes over memory). */
  iterations: number;
  parallelism: number;
}

/** KDF params plus the base64 salt they were used with. */
export interface KdfHeader extends KdfParams {
  salt: string;
}


/**
 * Upper bounds for params read from a FILE. A crafted backup must not be able
 * to make the app allocate gigabytes or spin for minutes before it even asks
 * for a password. They must ALSO accept everything the writer can produce
 * (calibration ceiling and OWASP floor in lib/backupKdfCalibration.ts; pinned
 * by a test), or a phone would write backups it cannot read back.
 *
 * 128 MiB: a backup made on a flagship has to open on a 2-3 GB phone, where
 * a 256 MiB allocation on top of the app can be killed by the OS.
 */
export const KDF_FILE_LIMITS = {
  maxMemoryKiB: 128 * 1024,
  maxIterations: 10,
  maxParallelism: 8,
} as const;

const SALT_BYTES = 16;
/** AES-GCM nonce length, passed explicitly to expo-crypto (never its default). */
export const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export interface EncryptedBackupEnvelope {
  format: typeof ENCRYPTED_BACKUP_FORMAT;
  version: number;
  _note: string;
  kdf: KdfHeader;
  cipher: typeof BACKUP_CIPHER;
  /** base64 of the 12-byte AES-GCM IV. */
  iv: string;
  /** base64 of ciphertext || 16-byte tag. */
  payload: string;
}

/** A derived key together with the header needed to re-derive it from the password. */
export interface BackupKey {
  kdf: KdfHeader;
  /** The 32-byte AES key. */
  key: Uint8Array;
}

/** Thrown when a password (or stored key) does not open a backup. */
export class BackupDecryptionError extends Error {
  constructor(message = 'Wrong password, or the backup file is damaged.') {
    super(message);
    this.name = 'BackupDecryptionError';
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** True when the parsed JSON of a picked file is an encrypted-backup envelope. */
export function isEncryptedBackup(parsed: unknown): parsed is EncryptedBackupEnvelope {
  return (
    !!parsed &&
    typeof parsed === 'object' &&
    (parsed as { format?: unknown }).format === ENCRYPTED_BACKUP_FORMAT
  );
}

/**
 * Validate an envelope's header before spending any work on it. Throws a
 * user-readable error for a file from a newer app version or with out-of-range
 * KDF params.
 */
export function assertSupportedEnvelope(envelope: EncryptedBackupEnvelope): void {
  if (envelope.version !== ENCRYPTED_BACKUP_VERSION) {
    throw new Error('This encrypted backup was made by a newer version of SoulSync. Update the app to restore it.');
  }
  const valid =
    envelope.cipher === BACKUP_CIPHER &&
    typeof envelope.payload === 'string' &&
    isValidIv(envelope.iv) &&
    isValidKdfHeader(envelope.kdf);
  if (!valid) {
    throw new Error('This encrypted backup is damaged or not a SoulSync backup.');
  }
}

/**
 * Is this a KDF header the app will run? Shared by the file check above and
 * the stored-key check in lib/backupKeyStore.ts.
 */
export function isValidKdfHeader(kdf: unknown): kdf is KdfHeader {
  const k = kdf as Partial<KdfHeader> | null | undefined;
  return (
    !!k &&
    typeof k === 'object' &&
    k.name === 'argon2id' &&
    Number.isInteger(k.parallelism) && k.parallelism! >= 1 && k.parallelism! <= KDF_FILE_LIMITS.maxParallelism &&
    Number.isInteger(k.memoryKiB) && k.memoryKiB! >= 8 * k.parallelism! && k.memoryKiB! <= KDF_FILE_LIMITS.maxMemoryKiB &&
    Number.isInteger(k.iterations) && k.iterations! >= 1 && k.iterations! <= KDF_FILE_LIMITS.maxIterations &&
    typeof k.salt === 'string' && k.salt.length > 0
  );
}

function isValidIv(iv: unknown): iv is string {
  if (typeof iv !== 'string') return false;
  try {
    return base64ToBytes(iv).length === IV_BYTES;
  } catch {
    return false;
  }
}

/** Do two KDF headers describe the same derivation (same salt and params)? */
export function sameKdf(a: KdfHeader, b: KdfHeader): boolean {
  return (
    a.name === b.name &&
    a.memoryKiB === b.memoryKiB &&
    a.iterations === b.iterations &&
    a.parallelism === b.parallelism &&
    a.salt === b.salt
  );
}

/**
 * The bytes a password is hashed as: UTF-8 of its NFC form, so "é" typed as
 * one code point and "e" + U+0301 (combining acute) derive the same key.
 */
export function passwordBytes(password: string): Uint8Array {
  return new TextEncoder().encode(password.normalize('NFC'));
}

/** Derive the AES key for `password` under an existing header (salt + params). */
export async function deriveBackupKey(password: string, kdf: KdfHeader): Promise<BackupKey> {
  const key = await argon2id(passwordBytes(password), base64ToBytes(kdf.salt), kdf, KEY_BYTES);
  return { kdf: { ...kdf }, key };
}

/** Constant-time equality of two byte arrays (for comparing derived keys). */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Derive a key for a NEW password under a fresh random salt. `params` come
 * from the on-device calibration (lib/backupKdfCalibration.ts).
 */
export async function createBackupKey(password: string, params: KdfParams): Promise<BackupKey> {
  const salt = bytesToBase64(getRandomBytes(SALT_BYTES));
  return deriveBackupKey(password, { ...params, salt });
}

/**
 * The GCM additional data: every header field, in a fixed order, so the
 * header cannot be altered (for example a swapped salt) without failing
 * authentication.
 */
function headerAad(version: number, kdf: KdfHeader, cipher: string): Uint8Array {
  return new TextEncoder().encode(
    [ENCRYPTED_BACKUP_FORMAT, version, kdf.name, kdf.memoryKiB, kdf.iterations, kdf.parallelism, kdf.salt, cipher].join('|')
  );
}

/** Encrypt a plain backup JSON string into the envelope JSON string. */
export async function encryptBackup(plaintextJson: string, backupKey: BackupKey): Promise<string> {
  const aesKey = await AESEncryptionKey.import(backupKey.key);
  const sealed = await aesEncryptAsync(new TextEncoder().encode(plaintextJson), aesKey, {
    nonce: { length: IV_BYTES },
    additionalData: headerAad(ENCRYPTED_BACKUP_VERSION, backupKey.kdf, BACKUP_CIPHER),
  });
  // The IV through its own accessor. The ciphertext comes off the native
  // base64 `combined` (iv || ciphertext || tag) rather than
  // `ciphertext({ encoding })`: expo-crypto 56's native side reads that
  // option as `outputFormat`, so `encoding: 'base64'` is silently ignored and
  // bytes come back. A 12-byte IV is exactly 16 base64 chars with no
  // padding, so `combined` starts with the IV's own base64 - asserted, never
  // assumed, so a different IV length fails here instead of writing a file
  // that cannot be opened.
  const iv = await sealed.iv('base64');
  const combined = await sealed.combined('base64');
  if (base64ToBytes(iv).length !== IV_BYTES || !combined.startsWith(iv)) {
    throw new Error('Unexpected AES-GCM output layout.');
  }
  const envelope: EncryptedBackupEnvelope = {
    format: ENCRYPTED_BACKUP_FORMAT,
    version: ENCRYPTED_BACKUP_VERSION,
    _note: 'This SoulSync backup is encrypted with your backup password. Restore it in SoulSync and enter the password to open it. Without the password it cannot be opened.',
    kdf: { ...backupKey.kdf },
    cipher: BACKUP_CIPHER,
    iv,
    payload: combined.slice(iv.length),
  };
  return JSON.stringify(envelope);
}

/**
 * Decrypt an envelope with a derived key. Throws `BackupDecryptionError` when
 * the key is wrong or the file was modified (GCM authentication failure).
 */
export async function decryptBackup(
  envelope: EncryptedBackupEnvelope,
  backupKey: BackupKey
): Promise<string> {
  assertSupportedEnvelope(envelope);
  let plaintext: Uint8Array;
  try {
    const aesKey = await AESEncryptionKey.import(backupKey.key);
    // NOT `fromCombined(...)`: on Android, expo-crypto's native fromCombined
    // takes a raw ByteArray and turns a string argument into its text bytes
    // instead of base64-decoding it, so every on-device decrypt failed (found
    // in emulator QA). `fromParts` takes BinaryInput, which IS base64-decoded
    // natively.
    const sealed = AESSealedData.fromParts(envelope.iv, envelope.payload, TAG_BYTES);
    plaintext = await aesDecryptAsync(sealed, aesKey, {
      additionalData: headerAad(envelope.version, envelope.kdf, envelope.cipher),
    });
  } catch {
    throw new BackupDecryptionError();
  }
  return new TextDecoder().decode(plaintext);
}

/** Validation message for a new password, or `null` when it is acceptable. */
export function validateNewBackupPassword(password: string, confirmation: string): string | null {
  if (password.length < MIN_BACKUP_PASSWORD_LENGTH) {
    return `Use at least ${MIN_BACKUP_PASSWORD_LENGTH} characters. A long passphrase is much stronger.`;
  }
  if (password !== confirmation) {
    return 'The passwords do not match.';
  }
  return null;
}
