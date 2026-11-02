/**
 * Encrypted backups through the REAL export/import paths (databases/data-export.ts).
 *
 * What this locks:
 *  - Encryption off (the default): the export is the plain v3 JSON, unchanged.
 *  - Encryption on: the ONLY file written is the encrypted envelope (no plain
 *    JSON ever touches disk) and it is named `_encrypted.json`.
 *  - Import of a backup made with this device's stored key opens with NO
 *    prompt (the "transparent" path) and then imports exactly like a plain one.
 *  - A backup from another device / an older password prompts; a wrong answer
 *    re-prompts with `wrongPassword: true`; cancelling aborts with no writes.
 *  - Round trip: export with encryption on, import that very file.
 *
 * Crypto is real (node:crypto AES-GCM via __mocks__/expo-crypto.ts, @noble
 * Argon2id) with cheap KDF params; see backupCrypto.test.ts.
 */
import { createMockDatabase } from 'expo-sqlite';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';
import * as Sharing from 'expo-sharing';

jest.mock('expo-sqlite');
jest.mock('expo-document-picker');
jest.mock('expo-file-system/legacy', () => require('../__mocks__/expo-file-system'));
jest.mock('expo-sharing');
jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));
jest.mock('@/components/IconPicker', () => ({ IconFamilyType: {} }));
jest.mock('@/components/types', () => ({}));
jest.mock('@/components/seedData', () => ({ initialActivities: [], initialActivityGroups: [] }));
jest.mock('@/databases/migrations', () => ({ runMigrations: jest.fn() }));

import { BACKUP_KEY_UNREADABLE, exportDatabaseData, importDatabaseData } from '@/databases/data-export';
import { createBackupKey, encryptBackup, KdfParams } from '@/lib/backupCrypto';
import { setBackupPassword } from '@/lib/backupKeyStore';
import {
  __setWriteConnectionForTests,
  __resetWriteTransactionForTests,
} from '@/databases/writeTransaction';

const FAST_KDF: KdfParams = { name: 'argon2id', memoryKiB: 256, iterations: 1, parallelism: 1 };

const makeDb = () => {
  const db = createMockDatabase();
  __setWriteConnectionForTests(db as any);
  return db;
};

const PLAIN_BACKUP = {
  version: 3,
  exportDate: '2026-10-01T00:00:00.000Z',
  data: {
    activityGroups: [],
    activities: [],
    entries: [{ id: 1, mood: 7, notes: 'secret diary line', date: '2026-10-01', photos: [] }],
    settings: [],
  },
};

beforeEach(() => {
  // restoreAllMocks first: a spy (e.g. on SecureStore) would otherwise stay
  // attached after resetAllMocks, answering undefined in later tests.
  jest.restoreAllMocks();
  jest.resetAllMocks();
  __resetWriteTransactionForTests();
  (SecureStore as any).__reset();
  (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({ exists: true });
  (FileSystem.writeAsStringAsync as jest.Mock).mockResolvedValue(undefined);
  (Sharing.isAvailableAsync as jest.Mock).mockResolvedValue(true);
  (Sharing.shareAsync as jest.Mock).mockResolvedValue(undefined);
  (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///mock/import.json' }],
  });
});

/** Every file the export wrote, as [path, contents]. */
const writtenFiles = (): [string, string][] =>
  (FileSystem.writeAsStringAsync as jest.Mock).mock.calls.map(c => [String(c[0]), String(c[1])]);

/** Restore reads the file's first bytes (format probe), then the whole file. */
const pickFileWithContents = (contents: string) =>
  (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValueOnce('eyJk').mockResolvedValueOnce(contents);

const entryInserts = (db: ReturnType<typeof createMockDatabase>) =>
  db.runAsync.mock.calls.filter((c: any[]) => /INSERT OR REPLACE INTO entries/i.test(c[0]));

/** A db whose export queries return one entry with a private note. */
const exportingDb = () => {
  const db = makeDb();
  db.getAllAsync.mockImplementation(async (sql: string) =>
    /FROM entries e/.test(sql)
      ? [{ id: 1, mood: 7, notes: 'secret diary line', date: '2026-10-01', starred_at: null }]
      : []
  );
  return db;
};

describe('export', () => {
  it('writes the plain v3 JSON when encryption is off (the default)', async () => {
    const result = await exportDatabaseData(exportingDb() as any);
    expect(result.success).toBe(true);
    const [[path, contents]] = writtenFiles();
    expect(path).toMatch(/mood_tracker_export_\d{4}-\d{2}-\d{2}\.json$/);
    expect(JSON.parse(contents).version).toBe(3);
    expect(contents).toContain('secret diary line');
  });

  it('writes ONLY the encrypted envelope when encryption is on', async () => {
    await setBackupPassword('my secret passphrase', FAST_KDF);
    const result = await exportDatabaseData(exportingDb() as any);
    expect(result.success).toBe(true);

    const files = writtenFiles();
    expect(files).toHaveLength(1);
    const [path, contents] = files[0];
    expect(path).toMatch(/_encrypted\.json$/);
    expect(result.filePath).toBe(path);
    expect(contents).not.toContain('secret diary line');
    expect(JSON.parse(contents).format).toBe('soulsync-encrypted-backup');
    expect(Sharing.shareAsync).toHaveBeenCalledWith(path, expect.objectContaining({ mimeType: 'application/json' }));
  });
  // Unreadable must never fall back to a PLAIN backup for someone who turned
  // encryption on.
  it.each([
    ['a corrupt stored key', async () => { await SecureStore.setItemAsync('backup_encryption_key_v1', 'not json{'); }],
    ['secure storage failing', async () => {
      await setBackupPassword('my secret passphrase', FAST_KDF);
      jest.spyOn(SecureStore, 'getItemAsync').mockRejectedValueOnce(new Error('KeyStore unavailable'));
    }],
  ])('stops and writes nothing on %s', async (_name, arrange) => {
    await arrange();
    const db = exportingDb();
    const result = await exportDatabaseData(db as any);

    expect(result).toEqual({ success: false, code: BACKUP_KEY_UNREADABLE, message: expect.stringMatching(/Enter your backup password again/) });
    expect(writtenFiles()).toEqual([]);
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
    expect(db.getAllAsync).not.toHaveBeenCalled(); // checked before any data is read
  });
});

describe('import of an encrypted backup', () => {
  it('opens a backup made with this device\'s key without asking', async () => {
    await setBackupPassword('my secret passphrase', FAST_KDF);
    const { getBackupKey } = require('@/lib/backupKeyStore');
    pickFileWithContents(await encryptBackup(JSON.stringify(PLAIN_BACKUP), await getBackupKey()));
    const requestPassword = jest.fn();
    const db = makeDb();
    db.runAsync.mockResolvedValue({ lastInsertRowId: 1, changes: 1 });

    const result = await importDatabaseData(db as any, { requestPassword });

    expect(result.success).toBe(true);
    expect(requestPassword).not.toHaveBeenCalled();
    expect(entryInserts(db)[0][1]).toEqual([1, 7, 'secret diary line', '2026-10-01', null]);
  });

  it('asks for the password of a backup from elsewhere, re-asking after a wrong one', async () => {
    const otherDeviceKey = await createBackupKey('other device pass', FAST_KDF);
    pickFileWithContents(await encryptBackup(JSON.stringify(PLAIN_BACKUP), otherDeviceKey));
    const requestPassword = jest
      .fn()
      .mockResolvedValueOnce('a wrong guess')
      .mockResolvedValueOnce('other device pass');
    const db = makeDb();
    db.runAsync.mockResolvedValue({ lastInsertRowId: 1, changes: 1 });

    const result = await importDatabaseData(db as any, { requestPassword });

    expect(result.success).toBe(true);
    expect(requestPassword.mock.calls).toEqual([[{ wrongPassword: false }], [{ wrongPassword: true }]]);
    expect(entryInserts(db)).toHaveLength(1);
  });

  it('asks (instead of failing) when this device has a DIFFERENT key, e.g. after a password change', async () => {
    const oldKey = await createBackupKey('old passphrase', FAST_KDF);
    pickFileWithContents(await encryptBackup(JSON.stringify(PLAIN_BACKUP), oldKey));
    await setBackupPassword('new passphrase', FAST_KDF);
    const requestPassword = jest.fn().mockResolvedValueOnce('old passphrase');
    const db = makeDb();
    db.runAsync.mockResolvedValue({ lastInsertRowId: 1, changes: 1 });

    const result = await importDatabaseData(db as any, { requestPassword });

    expect(result.success).toBe(true);
    expect(requestPassword).toHaveBeenCalledTimes(1);
  });

  it('reports a TYPED password through onPasswordAccepted, so the app can offer to keep it', async () => {
    const key = await createBackupKey('other device pass', FAST_KDF);
    pickFileWithContents(await encryptBackup(JSON.stringify(PLAIN_BACKUP), key));
    const onPasswordAccepted = jest.fn();
    const requestPassword = jest.fn().mockResolvedValueOnce('a wrong guess').mockResolvedValueOnce('other device pass');
    const db = makeDb();
    db.runAsync.mockResolvedValue({ lastInsertRowId: 1, changes: 1 });

    await importDatabaseData(db as any, { requestPassword, onPasswordAccepted });

    expect(onPasswordAccepted.mock.calls).toEqual([['other device pass']]);
  });

  it('does not call onPasswordAccepted when the backup opened with the key stored on this phone', async () => {
    await setBackupPassword('my secret passphrase', FAST_KDF);
    const { getBackupKey } = require('@/lib/backupKeyStore');
    pickFileWithContents(await encryptBackup(JSON.stringify(PLAIN_BACKUP), await getBackupKey()));
    const onPasswordAccepted = jest.fn();
    const db = makeDb();
    db.runAsync.mockResolvedValue({ lastInsertRowId: 1, changes: 1 });

    await importDatabaseData(db as any, { requestPassword: jest.fn(), onPasswordAccepted });

    expect(onPasswordAccepted).not.toHaveBeenCalled();
  });

  it('asks for the password when the stored key is unreadable (restore still works)', async () => {
    const key = await createBackupKey('other device pass', FAST_KDF);
    pickFileWithContents(await encryptBackup(JSON.stringify(PLAIN_BACKUP), key));
    await SecureStore.setItemAsync('backup_encryption_key_v1', 'not json{');
    const requestPassword = jest.fn().mockResolvedValueOnce('other device pass');
    const db = makeDb();
    db.runAsync.mockResolvedValue({ lastInsertRowId: 1, changes: 1 });

    const result = await importDatabaseData(db as any, { requestPassword });

    expect(result.success).toBe(true);
    expect(requestPassword).toHaveBeenCalledTimes(1);
  });

  it('cancelling the password prompt aborts with no database writes', async () => {
    const key = await createBackupKey('other device pass', FAST_KDF);
    pickFileWithContents(await encryptBackup(JSON.stringify(PLAIN_BACKUP), key));
    const db = makeDb();

    const result = await importDatabaseData(db as any, { requestPassword: async () => null });

    expect(result).toEqual({ success: false, message: 'Import cancelled' });
    expect(db.runAsync).not.toHaveBeenCalled();
  });

  it('fails cleanly when a password is needed but no prompt is available', async () => {
    const key = await createBackupKey('other device pass', FAST_KDF);
    pickFileWithContents(await encryptBackup(JSON.stringify(PLAIN_BACKUP), key));
    const db = makeDb();

    const result = await importDatabaseData(db as any);

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/needs its password/);
    expect(db.runAsync).not.toHaveBeenCalled();
  });

  it('still imports plain (unencrypted) backups while encryption is on, without asking', async () => {
    await setBackupPassword('my secret passphrase', FAST_KDF);
    pickFileWithContents(JSON.stringify(PLAIN_BACKUP));
    const requestPassword = jest.fn();
    const db = makeDb();
    db.runAsync.mockResolvedValue({ lastInsertRowId: 1, changes: 1 });

    const result = await importDatabaseData(db as any, { requestPassword });

    expect(result.success).toBe(true);
    expect(requestPassword).not.toHaveBeenCalled();
  });
});

describe('round trip', () => {
  it('imports the very file an encrypted export wrote', async () => {
    await setBackupPassword('my secret passphrase', FAST_KDF);
    await exportDatabaseData(exportingDb() as any);
    const [[, contents]] = writtenFiles();

    pickFileWithContents(contents);
    const db = makeDb();
    db.runAsync.mockResolvedValue({ lastInsertRowId: 1, changes: 1 });
    const result = await importDatabaseData(db as any, { requestPassword: jest.fn() });

    expect(result.success).toBe(true);
    expect(entryInserts(db)[0][1]).toEqual([1, 7, 'secret diary line', '2026-10-01', null]);
  });
});
