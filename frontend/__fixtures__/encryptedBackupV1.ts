/**
 * Golden fixture for the encrypted-backup format v1 (lib/backupCrypto.ts).
 *
 * `ENCRYPTED_BACKUP_V1_FIXTURE` is a FROZEN file: once committed it must keep
 * opening with `FIXTURE_PASSWORD` in every future version of the app, because
 * users hold real backups in this format. If a change to backupCrypto.ts makes
 * the fixture test fail, the change broke old backups: add a new format
 * `version` instead of editing this literal.
 *
 * `buildFixtureEnvelope()` regenerates it from the format's description alone,
 * deliberately NOT through lib/backupCrypto.ts: Argon2id from @noble/hashes
 * (the JS path) and AES-256-GCM from node:crypto, with a fixed salt and IV.
 * A test requires it to reproduce the literal byte for byte, so the frozen
 * bytes are explained by the spec, not just by whatever the app once wrote.
 * The derived key was also cross-checked once, offline, against Node 24's
 * independent `crypto.argon2Sync` (2026-11-02).
 *
 * Kept outside __tests__/ so jest does not run it as a test file.
 */
import { argon2id } from '@noble/hashes/argon2.js';
import { createCipheriv } from 'crypto';

/** "correct horse café", with the é as ONE code point (U+00E9, NFC). */
export const FIXTURE_PASSWORD = 'correct horse caf' + String.fromCharCode(0xe9);

/** The same visible password with é as "e" + U+0301 (combining acute, NFD). */
export const FIXTURE_PASSWORD_DECOMPOSED = 'correct horse cafe' + String.fromCharCode(0x301);

export const FIXTURE_PLAINTEXT = JSON.stringify({
  version: 3,
  exportDate: '2026-11-01T00:00:00.000Z',
  data: {
    entries: [{ id: 1, mood: 7, notes: 'golden fixture', date: '2026-11-01T09:00:00.000Z', photos: [] }],
    activities: [],
    activityGroups: [],
    settings: [],
  },
});

const FIXTURE_KDF = { name: 'argon2id', memoryKiB: 64, iterations: 2, parallelism: 1 } as const;
/** Salt 00 01 .. 0f, IV a0 a1 .. ab. */
const FIXTURE_SALT = Uint8Array.from({ length: 16 }, (_, i) => i);
const FIXTURE_IV = Uint8Array.from({ length: 12 }, (_, i) => 0xa0 + i);

const NOTE =
  'This SoulSync backup is encrypted with your backup password. Restore it in SoulSync and enter the password to open it. Without the password it cannot be opened.';

/** Rebuild the v1 envelope from the format description (see the header). */
export function buildFixtureEnvelope(): string {
  const salt = Buffer.from(FIXTURE_SALT).toString('base64');
  const kdf = { ...FIXTURE_KDF, salt };
  // Key: Argon2id v1.3 over the UTF-8 bytes of the NFC password, 32 bytes.
  const key = argon2id(new TextEncoder().encode(FIXTURE_PASSWORD.normalize('NFC')), FIXTURE_SALT, {
    m: kdf.memoryKiB,
    t: kdf.iterations,
    p: kdf.parallelism,
    dkLen: 32,
  });
  // Additional data: format|version|name|memoryKiB|iterations|parallelism|salt|cipher.
  const aad = ['soulsync-encrypted-backup', 1, kdf.name, kdf.memoryKiB, kdf.iterations, kdf.parallelism, salt, 'aes-256-gcm'].join('|');
  const cipher = createCipheriv('aes-256-gcm', key, FIXTURE_IV);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(FIXTURE_PLAINTEXT, 'utf8'), cipher.final()]);
  return JSON.stringify({
    format: 'soulsync-encrypted-backup',
    version: 1,
    _note: NOTE,
    kdf,
    cipher: 'aes-256-gcm',
    iv: Buffer.from(FIXTURE_IV).toString('base64'),
    payload: Buffer.concat([ciphertext, cipher.getAuthTag()]).toString('base64'),
  });
}

/** FROZEN. Never edit; see the header. */
export const ENCRYPTED_BACKUP_V1_FIXTURE =
  '{"format":"soulsync-encrypted-backup","version":1,"_note":"This SoulSync backup is encrypted with your backup password. Restore it in SoulSync and enter the password to open it. Without the password it cannot be opened.","kdf":{"name":"argon2id","memoryKiB":64,"iterations":2,"parallelism":1,"salt":"AAECAwQFBgcICQoLDA0ODw=="},"cipher":"aes-256-gcm","iv":"oKGio6Slpqeoqaqr","payload":"s6ikxtRk42JQIhcWA/WXfWNBmulmQAFTvMeeKU1+lsL6EGgZ1CM/7PV/C56D8BhpwYoWSDN3BbndNiLnDUMc6DZ574Z7Q46Gv9ts1aYCZ4O12WmGmKmzCS6Lhti8zQA/eTTSXzPeMQCdIb1wKqGs4iXeBr55vwJCIjjicZ1a95Avxnb6ZTG8A9JCGf/be2BcJ/a/8Uh3FVhXGdamTW2qjEMshG457II0qekejCOakpAIt5tIy040/CMMgJALEIAzjTw9ZyEcW1mYM/Pu+J6lqhu08hYASG8hN9XJ9FE3b5XGWx9pIQ=="}';
