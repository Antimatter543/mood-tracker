/**
 * expo-crypto for jest, backed by REAL crypto (node:crypto AES-256-GCM and
 * CSPRNG) rather than stubs, so the encrypted-backup tests exercise genuine
 * encryption, authentication-tag checks and additional-data binding. Mirrors
 * the subset of the native API lib/backupCrypto.ts uses: base64 strings or
 * Uint8Arrays in, `combined` = iv || ciphertext || tag (12-byte IV, 16-byte tag).
 * Plain functions, not jest.fn, so jest.resetAllMocks() cannot wipe them.
 */
import { CipherGCMTypes, createCipheriv, createDecipheriv, randomBytes } from 'crypto';

type BinaryInput = string | Uint8Array | ArrayBuffer;

const toBuffer = (input: BinaryInput): Buffer =>
  typeof input === 'string'
    ? Buffer.from(input, 'base64')
    : Buffer.from(input instanceof ArrayBuffer ? new Uint8Array(input) : input);

export const getRandomBytes = (n: number) => new Uint8Array(randomBytes(n));

export class AESEncryptionKey {
  constructor(readonly bytes: Buffer) {}
  get size() {
    return this.bytes.length * 8;
  }
  static async import(bytes: Uint8Array): Promise<AESEncryptionKey> {
    if (![16, 24, 32].includes(bytes.length)) throw new Error('Invalid AES key size');
    return new AESEncryptionKey(Buffer.from(bytes));
  }
}

export class AESSealedData {
  constructor(readonly iv: Buffer, readonly ct: Buffer, readonly tagBytes: Buffer) {}
  /**
   * Faithful to ANDROID, not to the docs: the native fromCombined takes a
   * ByteArray, so a string argument arrives as its text bytes and is never
   * base64-decoded. Mirroring that keeps the suite from passing code that
   * only works off-device (it once did).
   */
  static fromCombined(combined: BinaryInput): AESSealedData {
    const buf = typeof combined === 'string' ? Buffer.from(combined, 'utf8') : toBuffer(combined);
    return new AESSealedData(buf.subarray(0, 12), buf.subarray(12, buf.length - 16), buf.subarray(buf.length - 16));
  }
  /** fromParts(iv, ciphertextWithTag, tagLength): strings ARE base64-decoded natively. */
  static fromParts(iv: BinaryInput, ciphertextWithTag: BinaryInput, tagLength = 16): AESSealedData {
    const ct = toBuffer(ciphertextWithTag);
    return new AESSealedData(toBuffer(iv), ct.subarray(0, ct.length - tagLength), ct.subarray(ct.length - tagLength));
  }
  async combined(encoding: 'bytes' | 'base64' = 'bytes'): Promise<string | Uint8Array> {
    const buf = Buffer.concat([this.iv, this.ct, this.tagBytes]);
    return encoding === 'base64' ? buf.toString('base64') : new Uint8Array(buf);
  }
}

export async function aesEncryptAsync(
  plaintext: BinaryInput,
  key: AESEncryptionKey,
  options: { additionalData?: BinaryInput } = {}
): Promise<AESSealedData> {
  const iv = randomBytes(12);
  const cipher = createCipheriv(`aes-${key.size}-gcm` as CipherGCMTypes, key.bytes, iv);
  if (options.additionalData) cipher.setAAD(toBuffer(options.additionalData));
  const ct = Buffer.concat([cipher.update(toBuffer(plaintext)), cipher.final()]);
  return new AESSealedData(iv, ct, cipher.getAuthTag());
}

export async function aesDecryptAsync(
  sealed: AESSealedData,
  key: AESEncryptionKey,
  options: { additionalData?: BinaryInput; output?: 'bytes' | 'base64' } = {}
): Promise<Uint8Array | string> {
  const decipher = createDecipheriv(`aes-${key.size}-gcm` as CipherGCMTypes, key.bytes, sealed.iv);
  if (options.additionalData) decipher.setAAD(toBuffer(options.additionalData));
  decipher.setAuthTag(sealed.tagBytes);
  const pt = Buffer.concat([decipher.update(sealed.ct), decipher.final()]);
  return options.output === 'base64' ? pt.toString('base64') : new Uint8Array(pt);
}
