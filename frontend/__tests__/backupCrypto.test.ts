/**
 * Encrypted backups: the crypto layer (lib/backupCrypto.ts) and the key store
 * (lib/backupKeyStore.ts).
 *
 * expo-crypto is the hand mock in __mocks__/expo-crypto.ts, backed by REAL
 * node:crypto AES-256-GCM, and Argon2id is the real @noble/hashes code, so
 * wrong-password and tamper tests fail for the genuine cryptographic reason
 * (tag mismatch), not because a stub said so. Tests derive keys with cheap
 * params (FAST_KDF); the production params are calibrated per phone and
 * pinned by backupKdfCalibration.test.ts.
 */
import * as SecureStore from 'expo-secure-store';

import {
  BackupDecryptionError,
  ENCRYPTED_BACKUP_FORMAT,
  EncryptedBackupEnvelope,
  KdfParams,
  MIN_BACKUP_PASSWORD_LENGTH,
  assertSupportedEnvelope,
  createBackupKey,
  decryptBackup,
  deriveBackupKey,
  encryptBackup,
  isEncryptedBackup,
  validateNewBackupPassword,
} from '@/lib/backupCrypto';
import {
  clearBackupPassword,
  getBackupKey,
  isBackupEncryptionEnabled,
  setBackupPassword,
} from '@/lib/backupKeyStore';

const SecureStoreMock = SecureStore as unknown as typeof SecureStore & {
  __reset: () => void;
  __dump: () => Record<string, string>;
};

const FAST_KDF: KdfParams = { name: 'argon2id', memoryKiB: 256, iterations: 1, parallelism: 1 };

const PLAIN = JSON.stringify({
  version: 3,
  data: { entries: [{ id: 1, mood: 8, notes: 'Grüße, café, 日本語 and 🙂 survive', date: '2026-10-01' }] },
});

const encryptWith = async (password: string, plaintext = PLAIN) => {
  const key = await createBackupKey(password, FAST_KDF);
  const envelope = JSON.parse(await encryptBackup(plaintext, key)) as EncryptedBackupEnvelope;
  return { key, envelope };
};

beforeEach(() => {
  SecureStoreMock.__reset();
});

describe('encryptBackup / decryptBackup', () => {
  it('round-trips the exact plaintext, including non-ASCII text', async () => {
    const { key, envelope } = await encryptWith('correct horse battery');
    expect(await decryptBackup(envelope, key)).toBe(PLAIN);
  });

  it('opens with the password alone (re-derived from the salt in the file)', async () => {
    const { envelope } = await encryptWith('correct horse battery');
    const rederived = await deriveBackupKey('correct horse battery', envelope.kdf);
    expect(await decryptBackup(envelope, rederived)).toBe(PLAIN);
  });

  it('writes an envelope that carries no plaintext and no `data` field', async () => {
    const { envelope } = await encryptWith('correct horse battery');
    const raw = JSON.stringify(envelope);
    expect(isEncryptedBackup(envelope)).toBe(true);
    expect(raw).not.toContain('survive');
    expect(raw).not.toContain('entries');
    // An older app validates `version` + `data`; without `data` it rejects the
    // file as invalid instead of importing nothing and reporting success.
    expect(envelope).not.toHaveProperty('data');
    expect(envelope.cipher).toBe('aes-256-gcm');
  });

  it('uses a fresh IV per backup (same key + plaintext => different payload)', async () => {
    const key = await createBackupKey('correct horse battery', FAST_KDF);
    const a = JSON.parse(await encryptBackup(PLAIN, key)).payload;
    const b = JSON.parse(await encryptBackup(PLAIN, key)).payload;
    expect(a).not.toBe(b);
  });

  it('uses a fresh salt per password set', async () => {
    const a = await createBackupKey('same password', FAST_KDF);
    const b = await createBackupKey('same password', FAST_KDF);
    expect(a.kdf.salt).not.toBe(b.kdf.salt);
    expect(Buffer.from(a.key).equals(Buffer.from(b.key))).toBe(false);
  });

  it('rejects a wrong password with BackupDecryptionError', async () => {
    const { envelope } = await encryptWith('correct horse battery');
    const wrong = await deriveBackupKey('correct horse batterz', envelope.kdf);
    await expect(decryptBackup(envelope, wrong)).rejects.toBeInstanceOf(BackupDecryptionError);
  });

  it('rejects a modified ciphertext', async () => {
    const { key, envelope } = await encryptWith('correct horse battery');
    const bytes = Buffer.from(envelope.payload, 'base64');
    bytes[20] ^= 0x01;
    const tampered = { ...envelope, payload: bytes.toString('base64') };
    await expect(decryptBackup(tampered, key)).rejects.toBeInstanceOf(BackupDecryptionError);
  });

  it.each([
    ['salt', { salt: Buffer.alloc(16, 7).toString('base64') }],
    ['iterations', { iterations: 2 }],
    ['memoryKiB', { memoryKiB: 512 }],
  ])('rejects a modified header field (%s): the header is authenticated', async (_name, change) => {
    const { key, envelope } = await encryptWith('correct horse battery');
    const tampered = { ...envelope, kdf: { ...envelope.kdf, ...change } };
    await expect(decryptBackup(tampered, key)).rejects.toBeInstanceOf(BackupDecryptionError);
  });
});

describe('isEncryptedBackup / assertSupportedEnvelope', () => {
  it('does not mistake a plain backup for an encrypted one', () => {
    expect(isEncryptedBackup(JSON.parse(PLAIN))).toBe(false);
    expect(isEncryptedBackup(null)).toBe(false);
    expect(isEncryptedBackup('soulsync-encrypted-backup')).toBe(false);
  });

  const base = (): EncryptedBackupEnvelope => ({
    format: ENCRYPTED_BACKUP_FORMAT,
    version: 1,
    _note: '',
    kdf: { ...FAST_KDF, salt: 'AAAAAAAAAAAAAAAAAAAAAA==' },
    cipher: 'aes-256-gcm',
    payload: 'AAAA',
  });

  it('asks for an app update on a newer envelope version', () => {
    expect(() => assertSupportedEnvelope({ ...base(), version: 2 })).toThrow(/newer version/);
  });

  // A crafted file must not make the app allocate gigabytes or spin for
  // minutes before it has even asked for a password.
  it.each([
    ['huge memory', { memoryKiB: 4 * 1024 * 1024 }],
    ['huge iterations', { iterations: 1000 }],
    ['zero parallelism', { parallelism: 0 }],
    ['huge parallelism', { parallelism: 64 }],
    ['non-integer memory', { memoryKiB: 1.5 }],
    ['another KDF', { name: 'pbkdf2' }],
    ['missing salt', { salt: '' }],
  ])('rejects out-of-range KDF params (%s)', (_name, change) => {
    const envelope = { ...base(), kdf: { ...base().kdf, ...change } } as EncryptedBackupEnvelope;
    expect(() => assertSupportedEnvelope(envelope)).toThrow(/damaged/);
  });

  it('rejects an unknown cipher', () => {
    expect(() => assertSupportedEnvelope({ ...base(), cipher: 'rot13' } as any)).toThrow(/damaged/);
  });
});

describe('validateNewBackupPassword', () => {
  it('requires the minimum length', () => {
    const short = 'x'.repeat(MIN_BACKUP_PASSWORD_LENGTH - 1);
    expect(validateNewBackupPassword(short, short)).toMatch(/at least/);
  });

  it('requires the confirmation to match', () => {
    expect(validateNewBackupPassword('long enough pw', 'long enough pX')).toMatch(/do not match/);
  });

  it('accepts a matching password of sufficient length', () => {
    expect(validateNewBackupPassword('long enough pw', 'long enough pw')).toBeNull();
  });
});

describe('backup key store', () => {
  it('is off by default', async () => {
    expect(await isBackupEncryptionEnabled()).toBe(false);
    expect(await getBackupKey()).toBeNull();
  });

  it('stores a derived key, never the password itself', async () => {
    await setBackupPassword('my secret passphrase', FAST_KDF);
    expect(await isBackupEncryptionEnabled()).toBe(true);
    const everything = JSON.stringify(SecureStoreMock.__dump());
    expect(everything).not.toContain('my secret passphrase');
    expect(everything).not.toContain(Buffer.from('my secret passphrase').toString('base64'));
  });

  it('stores a key that opens backups made with it, and the password re-derives it', async () => {
    await setBackupPassword('my secret passphrase', FAST_KDF);
    const stored = (await getBackupKey())!;
    const envelope = JSON.parse(await encryptBackup(PLAIN, stored));
    expect(await decryptBackup(envelope, stored)).toBe(PLAIN);
    const rederived = await deriveBackupKey('my secret passphrase', stored.kdf);
    expect(Buffer.from(rederived.key).equals(Buffer.from(stored.key))).toBe(true);
  });

  it('changing the password replaces the key under a new salt', async () => {
    await setBackupPassword('first passphrase', FAST_KDF);
    const first = (await getBackupKey())!;
    await setBackupPassword('second passphrase', FAST_KDF);
    const second = (await getBackupKey())!;
    expect(second.kdf.salt).not.toBe(first.kdf.salt);
    const oldBackup = JSON.parse(await encryptBackup(PLAIN, first));
    await expect(decryptBackup(oldBackup, second)).rejects.toBeInstanceOf(BackupDecryptionError);
  });

  it('turning encryption off removes the key', async () => {
    await setBackupPassword('my secret passphrase', FAST_KDF);
    await clearBackupPassword();
    expect(await isBackupEncryptionEnabled()).toBe(false);
    expect(SecureStoreMock.__dump()).toEqual({});
  });

  it('treats an unreadable stored value as off rather than crashing', async () => {
    await SecureStore.setItemAsync('backup_encryption_key_v1', 'not json{');
    expect(await getBackupKey()).toBeNull();
  });
});
