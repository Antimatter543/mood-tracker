/**
 * Encrypted backups people already hold, and files that must not open, through
 * the REAL restore path (databases/data-export.ts importDatabaseData).
 *
 * Layer: the restore path with real crypto (node:crypto AES-GCM via
 * __mocks__/expo-crypto.ts, @noble Argon2id), because "an old backup still
 * imports" and "a bad file restores nothing" are claims about that whole path.
 * backupCrypto.test.ts covers the functions under it. Only the spy around
 * Argon2 is added, and it calls the real thing unless a test says otherwise.
 *
 * What this locks:
 *  - A file and a stored key written by the released 2.16.0 code keep working.
 *  - Wrong password, tampered and truncated files restore nothing.
 *  - The strength warning comes before any key is derived, and a strong file
 *    still restores once it is accepted.
 *  - The hard limits on what a file may ask for, as literal numbers.
 *  - A derivation failure is a readable message, never a wrong-password loop.
 */
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';

jest.mock('expo-document-picker');
jest.mock('expo-file-system/legacy', () => require('../__mocks__/expo-file-system'));
jest.mock('expo-sharing');
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('@/components/IconPicker', () => ({ IconFamilyType: {} }));
jest.mock('@/components/types', () => ({}));
jest.mock('@/components/seedData', () => ({ initialActivities: [], initialActivityGroups: [] }));
jest.mock('@/databases/migrations', () => ({ runMigrations: jest.fn() }));
jest.mock('@/lib/argon2', () => {
  const actual = jest.requireActual('@/lib/argon2');
  return { ...actual, argon2id: jest.fn(actual.argon2id) };
});

import {
  ENCRYPTED_BACKUP_V1_FIXTURE,
  FIXTURE_PASSWORD,
} from '@/__fixtures__/encryptedBackupV1';
import {
  RELEASED_2_16_0_FILE,
  RELEASED_2_16_0_NOTE,
  RELEASED_2_16_0_PASSWORD,
  RELEASED_2_16_0_STORED_KEY,
} from '@/__fixtures__/encryptedBackupV2_16_0';
import { importDatabaseData } from '@/databases/data-export';
import { argon2id } from '@/lib/argon2';
import { createBackupKey, encryptBackup, isValidKdfHeader, KdfParams } from '@/lib/backupCrypto';
import { MAX_CALIBRATED_ITERATIONS, MAX_CALIBRATED_MEMORY_KIB } from '@/lib/backupKdfCalibration';
import { readBackupKeyState } from '@/lib/backupKeyStore';
import { makeDb, resetWriteLayer, sqlCalls, type MockDb } from '@/testing/fakeDb';

const realArgon2 = jest.requireActual('@/lib/argon2').argon2id;
const argon2Spy = argon2id as jest.Mock;

const STORED_KEY_ITEM = 'backup_encryption_key_v1';
const SALT = 'AAECAwQFBgcICQoLDA0ODw==';

beforeEach(() => {
  jest.restoreAllMocks();
  jest.resetAllMocks();
  resetWriteLayer();
  (SecureStore as any).__reset();
  argon2Spy.mockImplementation(realArgon2);
  (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({ exists: true });
  (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///mock/import.json' }],
  });
  // A rejected restore logs the reason; that is expected noise here.
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

/** Restore reads the file's first bytes (format probe), then the whole file. */
const pickFileWithContents = (contents: string) =>
  (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValueOnce('eyJk').mockResolvedValueOnce(contents);

const restoringDb = () => {
  const db = makeDb();
  db.runAsync.mockResolvedValue({ lastInsertRowId: 1, changes: 1 });
  return db;
};

const entryInserts = (db: MockDb) => sqlCalls(db, /INSERT OR REPLACE INTO entries/i);

/**
 * Answers with the password once, then gives up. Restore re-asks after a
 * failed decrypt until it gets null, so a prompt that always answers would turn
 * broken crypto into an endless loop (a hung run) instead of a failed test.
 */
const answersOnce = (password: string) =>
  jest.fn<Promise<string | null>, unknown[]>().mockResolvedValueOnce(password).mockResolvedValue(null);

/** Nothing reached the database, on either connection. */
const expectNoWrites = (db: MockDb) => {
  expect(db.runAsync).not.toHaveBeenCalled();
  expect(db.execAsync).not.toHaveBeenCalled();
};

/** Flip one bit of a base64 field's first byte, leaving it valid base64 of the same length. */
const flipFirstByte = (base64: string) => {
  const bytes = Buffer.from(base64, 'base64');
  bytes[0] ^= 1;
  return bytes.toString('base64');
};

/** The frozen v1 file (cheap to derive) with an edit to its parsed JSON. */
const editedV1 = (edit: (envelope: any) => void) => {
  const envelope = JSON.parse(ENCRYPTED_BACKUP_V1_FIXTURE);
  edit(envelope);
  return JSON.stringify(envelope);
};

describe('a backup written by the released 2.16.0', () => {
  it('restores with its password typed, with no strength warning', async () => {
    pickFileWithContents(RELEASED_2_16_0_FILE);
    const requestPassword = answersOnce(RELEASED_2_16_0_PASSWORD);
    const confirmStrongKdf = jest.fn(async () => true);
    const db = restoringDb();

    const result = await importDatabaseData(db as any, { requestPassword, confirmStrongKdf });

    expect(result.success).toBe(true);
    expect(requestPassword).toHaveBeenCalledTimes(1);
    expect(confirmStrongKdf).not.toHaveBeenCalled();
    expect(entryInserts(db)[0][1]).toEqual(expect.arrayContaining([1, 7, RELEASED_2_16_0_NOTE]));
  }, 60000); // A real derive at 2.16.0's floor params, about 4 s on the JS path.

  it('restores silently with the key 2.16.0 left in secure storage: no password, no derive', async () => {
    await SecureStore.setItemAsync(STORED_KEY_ITEM, RELEASED_2_16_0_STORED_KEY);
    pickFileWithContents(RELEASED_2_16_0_FILE);
    const requestPassword = jest.fn();
    const confirmStrongKdf = jest.fn();
    const db = restoringDb();

    const result = await importDatabaseData(db as any, { requestPassword, confirmStrongKdf });

    expect(result.success).toBe(true);
    expect(requestPassword).not.toHaveBeenCalled();
    expect(confirmStrongKdf).not.toHaveBeenCalled();
    expect(argon2Spy).not.toHaveBeenCalled();
    expect(entryInserts(db)[0][1]).toEqual(expect.arrayContaining([1, 7, RELEASED_2_16_0_NOTE]));
  });

  it('reads a stored key with no strength mode as encryption on, in the default mode', async () => {
    await SecureStore.setItemAsync(STORED_KEY_ITEM, RELEASED_2_16_0_STORED_KEY);

    const state = await readBackupKeyState();

    expect(state.status).toBe('on');
    expect(state).toEqual(expect.objectContaining({ profile: 'compatibility' }));
  });
});

describe('files that must restore nothing', () => {
  it('a wrong password re-asks and never writes', async () => {
    pickFileWithContents(ENCRYPTED_BACKUP_V1_FIXTURE);
    const requestPassword = jest.fn().mockResolvedValueOnce('not the password').mockResolvedValueOnce(null);
    const db = restoringDb();

    const result = await importDatabaseData(db as any, { requestPassword });

    expect(requestPassword.mock.calls).toEqual([[{ wrongPassword: false }], [{ wrongPassword: true }]]);
    expect(result).toEqual({ success: false, message: 'Import cancelled' });
    expectNoWrites(db);
  });

  // Right password, altered file. AES-GCM cannot say which of the two is off,
  // so these read as "wrong password": what matters is that nothing restores.
  it.each<[string, (envelope: any) => void]>([
    ['a changed ciphertext byte', e => { e.payload = flipFirstByte(e.payload); }],
    ['a payload cut short (tag gone)', e => { e.payload = Buffer.from(e.payload, 'base64').subarray(0, -16).toString('base64'); }],
    ['a payload cut to half', e => { const b = Buffer.from(e.payload, 'base64'); e.payload = b.subarray(0, b.length >> 1).toString('base64'); }],
    ['an empty payload', e => { e.payload = ''; }],
    ['a changed IV', e => { e.iv = flipFirstByte(e.iv); }],
    ['a changed salt', e => { e.kdf.salt = flipFirstByte(e.kdf.salt); }],
    ['a changed pass count', e => { e.kdf.iterations = 3; }],
  ])('%s with the right password opens nothing', async (_name, edit) => {
    pickFileWithContents(editedV1(edit));
    const requestPassword = jest.fn().mockResolvedValueOnce(FIXTURE_PASSWORD).mockResolvedValueOnce(null);
    const db = restoringDb();

    const result = await importDatabaseData(db as any, { requestPassword });

    expect(requestPassword.mock.calls).toEqual([[{ wrongPassword: false }], [{ wrongPassword: true }]]);
    expect(result).toEqual({ success: false, message: 'Import cancelled' });
    expectNoWrites(db);
  });

  it('the untouched file opens with that password, so the failures above are the edits', async () => {
    pickFileWithContents(ENCRYPTED_BACKUP_V1_FIXTURE);
    const db = restoringDb();

    const result = await importDatabaseData(db as any, { requestPassword: answersOnce(FIXTURE_PASSWORD) });

    expect(result.success).toBe(true);
    expect(entryInserts(db)).toHaveLength(1);
  });

  it('a file cut off mid-way (no longer JSON) stops before asking anything', async () => {
    pickFileWithContents(ENCRYPTED_BACKUP_V1_FIXTURE.slice(0, ENCRYPTED_BACKUP_V1_FIXTURE.length >> 1));
    const requestPassword = jest.fn();
    const db = restoringDb();

    const result = await importDatabaseData(db as any, { requestPassword });

    expect(result.success).toBe(false);
    expect(requestPassword).not.toHaveBeenCalled();
    expect(argon2Spy).not.toHaveBeenCalled();
    expectNoWrites(db);
  });
});

describe('what a file may ask for', () => {
  const header = (over: Partial<KdfParams>) => ({
    name: 'argon2id',
    memoryKiB: 64,
    iterations: 2,
    parallelism: 1,
    salt: SALT,
    ...over,
  });

  // Literal numbers on purpose: these are the worst a crafted file can make a
  // phone do, so raising one has to show up here. (Relative to the constant,
  // a test would follow any change silently.)
  it('accepts exactly the hard limits', () => {
    expect(isValidKdfHeader(header({ memoryKiB: 1024 * 1024 }))).toBe(true);
    expect(isValidKdfHeader(header({ iterations: 20 }))).toBe(true);
    expect(isValidKdfHeader(header({ parallelism: 8 }))).toBe(true);
  });

  it.each<[string, Partial<KdfParams>]>([
    ['1 KiB over the memory limit', { memoryKiB: 1024 * 1024 + 1 }],
    ['21 passes', { iterations: 21 }],
    // Enough memory for 9 lanes, so only the lane limit can refuse this one.
    ['9 lanes', { memoryKiB: 1024, parallelism: 9 }],
    ['zero passes', { iterations: 0 }],
    ['fractional memory', { memoryKiB: 64.5 }],
    ['less memory than Argon2 allows for the lanes', { memoryKiB: 15, parallelism: 2 }],
  ])('refuses %s before asking anything or deriving', async (_name, over) => {
    pickFileWithContents(editedV1(e => { e.kdf = { ...e.kdf, ...over }; }));
    const requestPassword = jest.fn();
    const confirmStrongKdf = jest.fn();
    const db = restoringDb();

    const result = await importDatabaseData(db as any, { requestPassword, confirmStrongKdf });

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/damaged or not a SoulSync backup/);
    expect(requestPassword).not.toHaveBeenCalled();
    expect(confirmStrongKdf).not.toHaveBeenCalled();
    expect(argon2Spy).not.toHaveBeenCalled();
    expectNoWrites(db);
  });

  it('refuses a newer format version with a message that says so', async () => {
    pickFileWithContents(editedV1(e => { e.version = 2; }));
    const requestPassword = jest.fn();
    const db = restoringDb();

    const result = await importDatabaseData(db as any, { requestPassword });

    expect(result.message).toMatch(/newer version of SoulSync/);
    expect(requestPassword).not.toHaveBeenCalled();
    expectNoWrites(db);
  });

  // Everything 2.16.0 could write or read must stay inside the new limits.
  it.each<[string, Partial<KdfParams>]>([
    ['the floor 2.16.0 writes', { memoryKiB: 19 * 1024, iterations: 2, parallelism: 4 }],
    ['the most 2.16.0 calibration writes', { memoryKiB: 128 * 1024, iterations: 6, parallelism: 4 }],
    ['the most a 2.16.0 file could ask for', { memoryKiB: 128 * 1024, iterations: 10, parallelism: 8 }],
  ])('still accepts %s', (_name, over) => {
    expect(isValidKdfHeader(header(over))).toBe(true);
  });

  it('keeps the Compatibility ceilings 2.16.0 wrote', () => {
    expect(MAX_CALIBRATED_MEMORY_KIB).toBe(128 * 1024);
    expect(MAX_CALIBRATED_ITERATIONS).toBe(6);
  });
});

describe('a backup stronger than Compatibility', () => {
  // Above Compatibility by passes, so it is cheap to derive for real here.
  const STRONG_KDF: KdfParams = { name: 'argon2id', memoryKiB: 64, iterations: 7, parallelism: 1 };
  const PLAIN = JSON.stringify({
    version: 3,
    exportDate: '2026-11-01T00:00:00.000Z',
    data: {
      entries: [{ id: 1, mood: 7, notes: 'strong one', date: '2026-11-01', photos: [] }],
      activities: [],
      activityGroups: [],
      settings: [],
    },
  });

  const strongFile = async () => encryptBackup(PLAIN, await createBackupKey('strong pass', STRONG_KDF));

  it('warns before asking for the password or deriving, then restores when accepted', async () => {
    pickFileWithContents(await strongFile());
    argon2Spy.mockClear();
    const steps: string[] = [];
    const confirmStrongKdf = jest.fn(async () => { steps.push('warn'); return true; });
    const answer = answersOnce('strong pass');
    const requestPassword = jest.fn(async () => { steps.push('password'); return answer(); });
    argon2Spy.mockImplementation((...args: unknown[]) => { steps.push('derive'); return realArgon2(...args); });
    const db = restoringDb();

    const result = await importDatabaseData(db as any, { requestPassword, confirmStrongKdf });

    expect(steps).toEqual(['warn', 'password', 'derive']);
    expect(result.success).toBe(true);
    expect(entryInserts(db)[0][1]).toEqual(expect.arrayContaining([1, 7, 'strong one']));
  });

  it('declining the warning derives nothing and writes nothing', async () => {
    pickFileWithContents(await strongFile());
    argon2Spy.mockClear();
    const requestPassword = jest.fn();
    const db = restoringDb();

    const result = await importDatabaseData(db as any, { requestPassword, confirmStrongKdf: async () => false });

    expect(result).toEqual({ success: false, message: 'Import cancelled' });
    expect(requestPassword).not.toHaveBeenCalled();
    expect(argon2Spy).not.toHaveBeenCalled();
    expectNoWrites(db);
  });
});

describe('when the key cannot be derived', () => {
  it('says so plainly, does not blame the password, and writes nothing', async () => {
    pickFileWithContents(ENCRYPTED_BACKUP_V1_FIXTURE);
    argon2Spy.mockRejectedValueOnce(new Error('ARGON2_MEMORY_ALLOCATION_ERROR'));
    const requestPassword = answersOnce(FIXTURE_PASSWORD);
    const db = restoringDb();

    const result = await importDatabaseData(db as any, { requestPassword });

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/more memory than this phone has/);
    expect(result.message).not.toMatch(/ARGON2|Error importing/);
    expect(requestPassword).toHaveBeenCalledTimes(1); // no wrong-password loop
    expectNoWrites(db);
  });
});
