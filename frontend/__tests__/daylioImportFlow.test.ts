/**
 * Daylio backups through Restore (importDatabaseData -> databases/daylio-import.ts)
 * end to end against the mocked database: pick -> detect -> convert ->
 * preview -> APPEND. Also how Restore tells formats apart: a ZIP is only
 * Daylio when it really holds Daylio's backup JSON, and anything it cannot
 * read is "not a supported backup" before any question is asked.
 *
 * What this locks (the reasons append mode exists):
 *  - Daylio entries are INSERTED with fresh ids, never `INSERT OR REPLACE` by
 *    the backup's ids (which would overwrite unrelated local entries), and the
 *    autoincrement counter is left alone.
 *  - An entry identical to a live one (instant, mood, note) is skipped, and
 *    its photos are never written.
 *  - Memory: a file over the size cap is refused before it is read, a big one
 *    is read in chunks, and a failed import leaves no photo files behind.
 *  - Activity links only ever use ids mapped by this import.
 *  - Nothing is written when the preview is cancelled, the file is not a
 *    Daylio backup, or it has no entries. Settings are never touched.
 */
import { createMockDatabase } from 'expo-sqlite';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { strToU8 } from 'fflate';

jest.mock('expo-sqlite');
jest.mock('expo-document-picker');
jest.mock('expo-file-system/legacy', () => require('../__mocks__/expo-file-system'));
jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));
jest.mock('@/components/IconPicker', () => ({ IconFamilyType: {} }));
jest.mock('@/components/types', () => ({}));
jest.mock('@/components/seedData', () => ({ initialActivities: [], initialActivityGroups: [] }));
jest.mock('@/databases/migrations', () => ({ runMigrations: jest.fn() }));

import { MAX_DAYLIO_FILE_BYTES, describeDaylioImport, isZipHeader } from '@/databases/daylio-import';
import { importDatabaseData } from '@/databases/data-export';
import { zipSync } from 'fflate';
import { __resetWriteTransactionForTests, __setWriteConnectionForTests } from '@/databases/writeTransaction';
import { JPEG_BYTES, buildDaylioArchive, daylioBackupJson, daylioEntry } from '../__fixtures__/daylioBackup';

type Db = ReturnType<typeof createMockDatabase>;

/** A mock db whose inserts return increasing ids and whose duplicate check finds `existingDates`. */
function makeDb(existingDates: string[] = []) {
  const db = createMockDatabase();
  let nextId = 500;
  db.runAsync.mockImplementation(async () => ({ lastInsertRowId: nextId++, changes: 1 }));
  db.getFirstAsync.mockImplementation(async (sql: string, params: unknown[]) => {
    if (/FROM entries/.test(sql)) return existingDates.includes(params[0] as string) ? { id: 1 } : null;
    if (/MAX\(sort_order\)/.test(sql)) return { maxOrder: 0 };
    return null;
  });
  __setWriteConnectionForTests(db as any);
  return db;
}

const sqlCalls = (db: Db, pattern: RegExp) => db.runAsync.mock.calls.filter((c: any[]) => pattern.test(c[0]));

function pickFile(bytes: Uint8Array, { size = bytes.length }: { size?: number } = {}) {
  (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///cache/backup_2024_03_15.daylio' }],
  });
  (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({ exists: true, size });
  // Like the device: base64 (of the requested byte range) when asked for it
  // (format probe, Daylio read), text otherwise.
  (FileSystem.readAsStringAsync as jest.Mock).mockImplementation(
    async (_uri: string, options?: { encoding?: string; position?: number; length?: number }) => {
      if (options?.encoding !== 'base64') return Buffer.from(bytes).toString('utf8');
      const from = options.position ?? 0;
      const to = options.length === undefined ? bytes.length : from + options.length;
      return Buffer.from(bytes.subarray(from, to)).toString('base64');
    }
  );
}

const confirmYes = jest.fn(async () => true);

beforeEach(() => {
  jest.resetAllMocks();
  __resetWriteTransactionForTests();
  confirmYes.mockImplementation(async () => true);
  (FileSystem.writeAsStringAsync as jest.Mock).mockResolvedValue(undefined);
  (FileSystem.makeDirectoryAsync as jest.Mock).mockResolvedValue(undefined);
  (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({ exists: true });
  (FileSystem.deleteAsync as jest.Mock).mockResolvedValue(undefined);
});

it('appends entries with fresh ids and maps their activities', async () => {
  const db = makeDb();
  pickFile(buildDaylioArchive(daylioBackupJson({
    dayEntries: [daylioEntry({ mood: 1, tags: [14, 16], note: 'A<br>day' }), daylioEntry({ mood: 5, day: 16 })],
  })));

  const result = await importDatabaseData({} as any, { confirmDaylio: confirmYes });

  expect(result).toEqual({ success: true, message: 'Imported 2 entries from Daylio.' });
  const inserts = sqlCalls(db, /^INSERT INTO entries/);
  expect(inserts.map(c => c[0])).toEqual([
    'INSERT INTO entries (mood, notes, date, starred_at) VALUES (?, ?, ?, ?)',
    'INSERT INTO entries (mood, notes, date, starred_at) VALUES (?, ?, ?, ?)',
  ]);
  expect(inserts[0][1]).toEqual([9, 'A\nday', '2024-03-15T20:30:00.000Z', null]);
  expect(sqlCalls(db, /INSERT OR REPLACE INTO entries|sqlite_sequence|user_settings|DELETE FROM/)).toEqual([]);

  // Links point at the NEW entry id and at activity ids returned by this import's inserts.
  const insertedEntryId = 500 + sqlCalls(db, /.*/).findIndex(c => /^INSERT INTO entries/.test(c[0]));
  const activityIds = new Set(
    db.runAsync.mock.calls
      .map((c: any[], i: number) => (/^INSERT INTO activities/.test(c[0].trim()) ? 500 + i : null))
      .filter((id: number | null) => id !== null)
  );
  const links = sqlCalls(db, /INSERT INTO entry_activities/).map(c => c[1]);
  expect(links).toHaveLength(2);
  links.forEach(([entryId, activityId]: number[]) => {
    expect(entryId).toBe(insertedEntryId);
    expect(activityIds.has(activityId)).toBe(true);
  });
});

it('skips entries that already exist without ever writing their photos', async () => {
  const db = makeDb(['2024-03-15T20:30:00.000Z']);
  pickFile(buildDaylioArchive(
    daylioBackupJson({
      assets: [{ id: 1, type: 1, checksum: 'abc', createdAt: 0, createdAtOffset: 0, android_metadata: '{}' }],
      dayEntries: [daylioEntry({ assets: [1] }), daylioEntry({ day: 20 })],
    }),
    { files: { 'assets/photos/2024/3/abc': JPEG_BYTES } }
  ));

  const result = await importDatabaseData({} as any, { confirmDaylio: confirmYes });

  expect(result.message).toBe('Imported 1 entry from Daylio. 1 entry was already here and skipped.');
  expect(sqlCalls(db, /^INSERT INTO entries/)).toHaveLength(1);
  expect(sqlCalls(db, /INSERT INTO entry_media/)).toHaveLength(0);
  expect(FileSystem.writeAsStringAsync).not.toHaveBeenCalled();
  expect(FileSystem.deleteAsync).not.toHaveBeenCalled();
});

const onePhotoBackup = (photo: Uint8Array) =>
  buildDaylioArchive(
    daylioBackupJson({
      assets: [{ id: 1, type: 1, checksum: 'abc', createdAt: 0, createdAtOffset: 0, android_metadata: '{}' }],
      dayEntries: [daylioEntry({ assets: [1] })],
    }),
    { files: { 'assets/photos/2024/3/abc': photo } }
  );

it('an entry repeated within the file is imported once, and the repeat\'s photo file is deleted', async () => {
  const db = makeDb();
  // The pre-check sees neither copy (2 lookups); in the transaction the
  // second copy finds the first one, just inserted (4th lookup).
  let entryLookups = 0;
  db.getFirstAsync.mockImplementation(async (sql: string) => {
    if (/FROM entries/.test(sql)) return ++entryLookups === 4 ? { id: 500 } : null;
    if (/MAX\(sort_order\)/.test(sql)) return { maxOrder: 0 };
    return null;
  });
  pickFile(buildDaylioArchive(
    daylioBackupJson({
      assets: [{ id: 1, type: 1, checksum: 'abc', createdAt: 0, createdAtOffset: 0, android_metadata: '{}' }],
      dayEntries: [daylioEntry({ assets: [1] }), daylioEntry({ assets: [1] })],
    }),
    { files: { 'assets/photos/2024/3/abc': JPEG_BYTES } }
  ));

  const result = await importDatabaseData({} as any, { confirmDaylio: confirmYes });

  expect(result.message).toBe('Imported 1 entry from Daylio. 1 entry was already here and skipped.');
  const written = (FileSystem.writeAsStringAsync as jest.Mock).mock.calls.map(c => c[0]);
  expect(written).toHaveLength(2);
  expect(sqlCalls(db, /INSERT INTO entry_media/).map(c => c[1][1])).toEqual([written[0]]);
  expect(FileSystem.deleteAsync).toHaveBeenCalledTimes(1);
  expect(FileSystem.deleteAsync).toHaveBeenCalledWith(written[1], { idempotent: true });
});

it('deletes the photos it already wrote when the import fails', async () => {
  const db = makeDb();
  db.runAsync.mockImplementation(async (sql: string) => {
    if (/^INSERT INTO entries/.test(sql)) throw new Error('disk full');
    return { lastInsertRowId: 1, changes: 1 };
  });
  pickFile(onePhotoBackup(JPEG_BYTES));

  const result = await importDatabaseData({} as any, { confirmDaylio: confirmYes });

  expect(result.success).toBe(false);
  const written = (FileSystem.writeAsStringAsync as jest.Mock).mock.calls.map(c => c[0]);
  expect(written).toHaveLength(1);
  expect(FileSystem.deleteAsync).toHaveBeenCalledWith(written[0], { idempotent: true });
});

it('leaves out a photo that is not an image, and says so', async () => {
  const db = makeDb();
  pickFile(onePhotoBackup(strToU8('this is not an image file')));

  const result = await importDatabaseData({} as any, { confirmDaylio: confirmYes });

  expect(result).toEqual({
    success: true,
    message: 'Imported 1 entry from Daylio. 1 photo could not be read and was left out.',
  });
  expect(FileSystem.writeAsStringAsync).not.toHaveBeenCalled();
  expect(sqlCalls(db, /INSERT INTO entry_media/)).toHaveLength(0);
});

it('refuses a file over the size cap before reading it', async () => {
  const db = makeDb();
  pickFile(buildDaylioArchive(daylioBackupJson()), { size: MAX_DAYLIO_FILE_BYTES + 1 });

  const result = await importDatabaseData({} as any, { confirmDaylio: confirmYes });

  expect(result).toEqual({ success: false, message: 'This Daylio backup is too large to import (over 300 MB).' });
  // Only the 4-byte format probe was read.
  expect(FileSystem.readAsStringAsync).toHaveBeenCalledTimes(1);
  expect(confirmYes).not.toHaveBeenCalled();
  expect(db.runAsync).not.toHaveBeenCalled();
});

it('reads a big file in chunks, never all at once as one string', async () => {
  makeDb();
  const padding = new Uint8Array(7 * 1024 * 1024).map((_, i) => (i * 2654435761) >>> 24);
  pickFile(buildDaylioArchive(daylioBackupJson(), { files: { 'padding.bin': padding }, compress: false }));

  const result = await importDatabaseData({} as any, { confirmDaylio: confirmYes });

  expect(result).toEqual({ success: true, message: 'Imported 1 entry from Daylio.' });
  const reads = (FileSystem.readAsStringAsync as jest.Mock).mock.calls.slice(1).map(c => c[1]);
  expect(reads.length).toBeGreaterThanOrEqual(3);
  reads.forEach(options => {
    expect(options.encoding).toBe('base64');
    expect(options.length).toBeLessThanOrEqual(3 * 1024 * 1024);
  });
});

it('imports photos for new entries', async () => {
  const db = makeDb();
  pickFile(buildDaylioArchive(
    daylioBackupJson({
      assets: [{ id: 1, type: 1, checksum: 'abc', createdAt: 0, createdAtOffset: 0, android_metadata: '{}' }],
      dayEntries: [daylioEntry({ assets: [1] })],
    }),
    { files: { 'assets/photos/2024/3/abc': JPEG_BYTES } }
  ));

  await importDatabaseData({} as any, { confirmDaylio: confirmYes });

  const media = sqlCalls(db, /INSERT INTO entry_media/);
  expect(media).toHaveLength(1);
  expect(String(media[0][1][1])).toMatch(/\.jpg$/);
});

it('shows the preview first and writes nothing when it is cancelled', async () => {
  const db = makeDb();
  pickFile(buildDaylioArchive(daylioBackupJson()));
  const confirmNo = jest.fn(async () => false);

  const result = await importDatabaseData({} as any, { confirmDaylio: confirmNo });

  expect(confirmNo).toHaveBeenCalledWith(expect.objectContaining({ entries: 1, activities: 4, groups: 3 }));
  expect(result).toEqual({ success: false, message: 'Import cancelled' });
  expect(db.runAsync).not.toHaveBeenCalled();
});

it.each([
  ['a ZIP that is not a Daylio backup', zipSync({ 'other.json': strToU8('{}') }), /^SoulSync can't open this file\./],
  ['a Daylio backup without entries', buildDaylioArchive(daylioBackupJson({ dayEntries: [] })), /no entries/],
])('rejects %s without writing or asking', async (_name, bytes, message) => {
  const db = makeDb();
  pickFile(bytes as Uint8Array);

  const result = await importDatabaseData({} as any, { confirmDaylio: confirmYes });

  expect(result.success).toBe(false);
  expect(result.message).toMatch(message);
  expect(confirmYes).not.toHaveBeenCalled();
  expect(db.runAsync).not.toHaveBeenCalled();
});

it('describes the preview in plain words, including what is left out', () => {
  const text = describeDaylioImport({
    entries: 312,
    activities: 41,
    groups: 6,
    photos: 1,
    firstDate: '2019-04-01T10:00:00.000Z',
    lastDate: '2024-03-15T20:30:00.000Z',
    skipped: { audioNotes: 2, missingPhotos: 0, unreadableEntries: 1 },
  });
  expect(text).toContain('312 entries (2019–2024), 41 activities and 1 photo will be added');
  expect(text).toContain('rad 9, good 7, meh 5, bad 3, awful 1');
  expect(text).toContain("2 voice notes can't be imported.");
  expect(text).toContain('1 entry could not be read');
  expect(text).not.toContain('photo could not be read');
});

it('leaves zero counts out of the preview', () => {
  const text = describeDaylioImport({
    entries: 5,
    activities: 13,
    groups: 1,
    photos: 0,
    firstDate: '2015-05-16T18:00:00.000Z',
    lastDate: '2023-01-24T10:36:00.000Z',
    skipped: { audioNotes: 0, missingPhotos: 0, unreadableEntries: 0 },
  });
  expect(text.split('\n')[0]).toBe('5 entries (2015–2023) and 13 activities will be added to your data.');
});

it('says so when everything was already imported', async () => {
  makeDb(['2024-03-15T20:30:00.000Z']);
  pickFile(buildDaylioArchive(daylioBackupJson()));

  const result = await importDatabaseData({} as any, { confirmDaylio: confirmYes });

  expect(result).toEqual({ success: true, message: 'Nothing new to import: the entry is already here.' });
});

describe('telling formats apart', () => {
  const b64 = (bytes: Uint8Array | string) => Buffer.from(bytes).toString('base64');

  it.each([
    ['exactly 4 bytes read (as on device)', 'UEsDBA==', true],
    ['more bytes read', b64(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00])), true],
    ['JSON', b64('{"version":3}'), false],
    ['a PNG', b64(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])), false],
    ['nothing', '', false],
    ['garbage', '%%%%', false],
  ])('ZIP signature check: %s', (_name, head, expected) => {
    expect(isZipHeader(head)).toBe(expected);
  });

  it.each([
    ['a ZIP whose backup.daylio is other JSON', zipSync({ 'backup.daylio': strToU8(b64('{"foo":1}')) })],
    ['a ZIP of Daylio-named but non-Daylio data', zipSync({ 'backup.daylio': strToU8(b64('{"version":3,"data":{}}')) })],
    ['an image', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])],
    ['JSON that is not a backup', strToU8('{"hello":"world"}')],
  ])('%s is "not a supported backup", before any question', async (_name, bytes) => {
    const db = makeDb();
    pickFile(bytes);
    const confirmRestore = jest.fn(async () => true);

    const result = await importDatabaseData({} as any, { confirmDaylio: confirmYes, confirmRestore });

    expect(result).toEqual({
      success: false,
      message: "SoulSync can't open this file. Pick a backup made with SoulSync or Daylio.",
    });
    expect(confirmYes).not.toHaveBeenCalled();
    expect(confirmRestore).not.toHaveBeenCalled();
    expect(db.runAsync).not.toHaveBeenCalled();
  });

  it('a real Daylio backup that is damaged says so', async () => {
    makeDb();
    pickFile(zipSync({ 'backup.daylio': strToU8('%%% not base64 %%%') }));

    const result = await importDatabaseData({} as any, { confirmDaylio: confirmYes });

    expect(result).toEqual({ success: false, message: 'The Daylio backup inside this file is damaged.' });
  });

  it('a Daylio backup never triggers the "replace your data" question', async () => {
    makeDb();
    pickFile(buildDaylioArchive(daylioBackupJson()));
    const confirmRestore = jest.fn(async () => true);

    await importDatabaseData({} as any, { confirmDaylio: confirmYes, confirmRestore });

    expect(confirmYes).toHaveBeenCalled();
    expect(confirmRestore).not.toHaveBeenCalled();
  });

  it('a SoulSync backup asks the "replace" question (not the Daylio preview), and "no" writes nothing', async () => {
    const db = makeDb();
    pickFile(strToU8(JSON.stringify({ version: 3, data: { activityGroups: [], activities: [], entries: [], settings: [] } })));
    const confirmRestore = jest.fn(async () => false);

    const result = await importDatabaseData({} as any, { confirmDaylio: confirmYes, confirmRestore });

    expect(confirmRestore).toHaveBeenCalledTimes(1);
    expect(confirmYes).not.toHaveBeenCalled();
    expect(result).toEqual({ success: false, message: 'Import cancelled' });
    expect(db.runAsync).not.toHaveBeenCalled();
  });

  it('accepts any file type in the picker (.daylio has no MIME type)', async () => {
    makeDb();
    pickFile(buildDaylioArchive(daylioBackupJson()));
    await importDatabaseData({} as any, { confirmDaylio: confirmYes });
    expect(DocumentPicker.getDocumentAsync).toHaveBeenCalledWith(expect.objectContaining({ type: '*/*' }));
  });
});
