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
  IV_BYTES,
  KdfParams,
  MIN_BACKUP_PASSWORD_LENGTH,
  assertSupportedEnvelope,
  createBackupKey,
  decryptBackup,
  deriveBackupKey,
  encryptBackup,
  isEncryptedBackup,
  passwordBytes,
  validateNewBackupPassword,
} from '@/lib/backupCrypto';
import {
  BackupKeyUnreadableError,
  PASSWORD_CONFIRM_INTERVAL_MS,
  clearBackupPassword,
  getBackupKey,
  getPasswordConfirmedAt,
  isBackupEncryptionEnabled,
  isPasswordConfirmationDue,
  markPasswordConfirmed,
  readBackupKeyState,
  setBackupPassword,
  verifyBackupPassword,
} from '@/lib/backupKeyStore';
import {
  ENCRYPTED_BACKUP_V1_FIXTURE,
  FIXTURE_PASSWORD,
  FIXTURE_PASSWORD_DECOMPOSED,
  FIXTURE_PLAINTEXT,
  buildFixtureEnvelope,
} from '@/__fixtures__/encryptedBackupV1';
import { freezeNow } from '@/testing/clock';

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

  it('uses a fresh IV per backup (same key + plaintext => different IV and payload)', async () => {
    const key = await createBackupKey('correct horse battery', FAST_KDF);
    const a = JSON.parse(await encryptBackup(PLAIN, key));
    const b = JSON.parse(await encryptBackup(PLAIN, key));
    expect(a.iv).not.toBe(b.iv);
    expect(a.payload).not.toBe(b.payload);
  });

  it('stores the 12-byte IV in its own field and only ciphertext + 16-byte tag in payload', async () => {
    const { envelope } = await encryptWith('correct horse battery');
    expect(Buffer.from(envelope.iv, 'base64')).toHaveLength(IV_BYTES);
    expect(Buffer.from(envelope.payload, 'base64')).toHaveLength(Buffer.byteLength(PLAIN, 'utf8') + 16);
  });

  it('rejects a modified IV', async () => {
    const { key, envelope } = await encryptWith('correct horse battery');
    const iv = Buffer.from(envelope.iv, 'base64');
    iv[0] ^= 0x01;
    await expect(decryptBackup({ ...envelope, iv: iv.toString('base64') }, key)).rejects.toBeInstanceOf(
      BackupDecryptionError
    );
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

describe('password normalization (NFC)', () => {
  // Built from code points, never typed: the two strings LOOK identical.
  const precomposed = 'caf' + String.fromCharCode(0xe9) + ' passphrase';
  const decomposed = 'cafe' + String.fromCharCode(0x301) + ' passphrase';

  it('the two spellings differ as strings but hash as the same bytes', () => {
    expect(precomposed).not.toBe(decomposed);
    expect(Buffer.from(passwordBytes(decomposed)).equals(Buffer.from(passwordBytes(precomposed)))).toBe(true);
  });

  it('a backup made with one spelling opens with the other', async () => {
    const { envelope } = await encryptWith(decomposed);
    const key = await deriveBackupKey(precomposed, envelope.kdf);
    expect(await decryptBackup(envelope, key)).toBe(PLAIN);
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
    iv: 'AAAAAAAAAAAAAAAA',
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

  it.each([
    ['missing', undefined],
    ['8 bytes', 'AAAAAAAAAAA='],
    ['16 bytes', 'AAAAAAAAAAAAAAAAAAAAAA=='],
    ['not base64', '!!!!'],
  ])('rejects a bad IV (%s)', (_name, iv) => {
    expect(() => assertSupportedEnvelope({ ...base(), iv } as EncryptedBackupEnvelope)).toThrow(/damaged/);
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

  it('stores the strength mode next to the key; default Compatibility', async () => {
    await setBackupPassword('my secret passphrase', FAST_KDF);
    expect(await readBackupKeyState()).toMatchObject({ status: 'on', profile: 'compatibility' });
    await setBackupPassword('my secret passphrase', FAST_KDF, 'manual');
    expect(await readBackupKeyState()).toMatchObject({ status: 'on', profile: 'manual' });
  });

  it('a key stored before modes existed reads as Compatibility', async () => {
    await setBackupPassword('my secret passphrase', FAST_KDF);
    const raw = JSON.parse(SecureStoreMock.__dump().backup_encryption_key_v1);
    delete raw.profile;
    await SecureStore.setItemAsync('backup_encryption_key_v1', JSON.stringify(raw));
    expect(await readBackupKeyState()).toMatchObject({ status: 'on', profile: 'compatibility' });
  });

  it('Manual without params is refused (there is nothing to calibrate)', async () => {
    await expect(setBackupPassword('my secret passphrase', undefined, 'manual')).rejects.toThrow(/explicit parameters/);
    expect(await isBackupEncryptionEnabled()).toBe(false);
  });

  it('turning encryption off removes the key', async () => {
    await setBackupPassword('my secret passphrase', FAST_KDF);
    await clearBackupPassword();
    expect(await isBackupEncryptionEnabled()).toBe(false);
    expect(SecureStoreMock.__dump()).toEqual({});
  });

  // "Stored but unreadable" must never look like "off": export would then
  // write a PLAIN backup for someone who turned encryption on.
  it.each([
    ['not JSON', 'not json{'],
    ['no kdf', JSON.stringify({ key: Buffer.alloc(32).toString('base64') })],
    ['kdf out of range', JSON.stringify({ kdf: { ...FAST_KDF, memoryKiB: 1e9, salt: 'AAAA' }, key: Buffer.alloc(32).toString('base64') })],
    ['key of the wrong length', JSON.stringify({ kdf: { ...FAST_KDF, salt: 'AAAA' }, key: Buffer.alloc(16).toString('base64') })],
  ])('a corrupt stored key (%s) is unreadable, not off', async (_name, raw) => {
    await SecureStore.setItemAsync('backup_encryption_key_v1', raw);
    const state = await readBackupKeyState();
    expect(state.status).toBe('unreadable');
    expect(await isBackupEncryptionEnabled()).toBe(true);
    await expect(getBackupKey()).rejects.toBeInstanceOf(BackupKeyUnreadableError);
  });

  it('a secure-storage failure is unreadable with a clear message, never a crash', async () => {
    await setBackupPassword('my secret passphrase', FAST_KDF);
    const spy = jest.spyOn(SecureStore, 'getItemAsync').mockRejectedValueOnce(new Error('KeyStore exploded'));
    const state = await readBackupKeyState();
    spy.mockRestore();
    expect(state).toEqual({ status: 'unreadable', message: expect.stringMatching(/couldn't be read.*Enter your backup password again/) });
    expect(JSON.stringify(state)).not.toContain('KeyStore exploded');
  });

  it('verifies the current password against the stored key', async () => {
    await setBackupPassword('my secret passphrase', FAST_KDF);
    expect(await verifyBackupPassword('my secret passphrase')).toBe(true);
    expect(await verifyBackupPassword('my secret passphrasE')).toBe(false);
    await clearBackupPassword();
    expect(await verifyBackupPassword('my secret passphrase')).toBe(false);
  });
});

describe('password confirmation timer', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.UTC(2026, 10, 2);

  it('is due when never confirmed, after the interval, or with a future timestamp', () => {
    expect(PASSWORD_CONFIRM_INTERVAL_MS).toBe(14 * DAY);
    expect(isPasswordConfirmationDue(null, now)).toBe(true);
    expect(isPasswordConfirmationDue(now - 13 * DAY, now)).toBe(false);
    expect(isPasswordConfirmationDue(now - 14 * DAY, now)).toBe(false);
    expect(isPasswordConfirmationDue(now - 14 * DAY - 1, now)).toBe(true);
    expect(isPasswordConfirmationDue(now + DAY, now)).toBe(true);
  });

  it('setting a password counts as a confirmation; turning off clears it', async () => {
    expect(await getPasswordConfirmedAt()).toBeNull();
    const now = freezeNow();
    await setBackupPassword('my secret passphrase', FAST_KDF);
    expect(await getPasswordConfirmedAt()).toBe(now.getTime());
    await clearBackupPassword();
    expect(await getPasswordConfirmedAt()).toBeNull();
    expect(SecureStoreMock.__dump()).toEqual({});
  });

  it('markPasswordConfirmed records the given time', async () => {
    await markPasswordConfirmed(now);
    expect(await getPasswordConfirmedAt()).toBe(now);
  });
});

describe('golden vectors', () => {
  // RFC 9106 section 5.3 (Argon2id test vector), against the JS implementation
  // that jest, Expo Go and the fixture below use. The native module produced
  // byte-identical keys on a real phone (see lib/argon2.ts).
  it('@noble/hashes Argon2id matches the RFC 9106 test vector', () => {
    const { argon2id } = jest.requireActual('@noble/hashes/argon2.js');
    const tag = argon2id(new Uint8Array(32).fill(1), new Uint8Array(16).fill(2), {
      m: 32,
      t: 3,
      p: 4,
      dkLen: 32,
      key: new Uint8Array(8).fill(3),
      personalization: new Uint8Array(12).fill(4),
    });
    expect(Buffer.from(tag).toString('hex')).toBe('0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659');
  });

  it('the frozen v1 fixture still opens, with either spelling of the password', async () => {
    const envelope = JSON.parse(ENCRYPTED_BACKUP_V1_FIXTURE);
    expect(isEncryptedBackup(envelope)).toBe(true);
    for (const password of [FIXTURE_PASSWORD, FIXTURE_PASSWORD_DECOMPOSED]) {
      const key = await deriveBackupKey(password, envelope.kdf);
      expect(await decryptBackup(envelope, key)).toBe(FIXTURE_PLAINTEXT);
    }
  });

  it('the fixture is reproduced byte for byte from the format description', () => {
    expect(buildFixtureEnvelope()).toBe(ENCRYPTED_BACKUP_V1_FIXTURE);
  });

  it('the app writes the same fields as the fixture', async () => {
    const { envelope } = await encryptWith('correct horse battery');
    expect(Object.keys(envelope).sort()).toEqual(Object.keys(JSON.parse(ENCRYPTED_BACKUP_V1_FIXTURE)).sort());
  });
});
