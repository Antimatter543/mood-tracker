import { createMockDatabase } from 'expo-sqlite';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { MEDIA_DIR } from '@/databases/mediaHelpers';

jest.mock('expo-sqlite');
jest.mock('expo-document-picker');
// Use the hand-written FileSystem mock (it defines documentDirectory +
// EncodingType.Base64, which the auto-mock omits — the export reads photo bytes
// with `EncodingType.Base64`, so that constant must exist).
jest.mock('expo-file-system/legacy', () => require('../__mocks__/expo-file-system'));
jest.mock('expo-sharing');
jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

// Mock IconPicker
jest.mock('@/components/IconPicker', () => ({
  IconFamilyType: {},
}));

// Mock types
jest.mock('@/components/types', () => ({}));

// Mock seedData
jest.mock('@/components/seedData', () => ({
  initialActivities: [],
  initialActivityGroups: [],
}));

// Mock migrations
jest.mock('@/databases/migrations', () => ({
  runMigrations: jest.fn(),
}));

import { importDatabaseData, exportDatabaseData } from '@/databases/data-export';

// Re-establish a clean, predictable set of mock defaults before every test so
// queued `*Once` implementations never leak across tests. The DB mock is fresh
// per test (createMockDatabase) so it is unaffected.
beforeEach(() => {
  jest.resetAllMocks();
  (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({ exists: true });
  (FileSystem.makeDirectoryAsync as jest.Mock).mockResolvedValue(undefined);
  (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValue('');
  (FileSystem.writeAsStringAsync as jest.Mock).mockResolvedValue(undefined);
  (FileSystem.copyAsync as jest.Mock).mockResolvedValue(undefined);
  (FileSystem.deleteAsync as jest.Mock).mockResolvedValue(undefined);
  (Sharing.isAvailableAsync as jest.Mock).mockResolvedValue(true);
  (Sharing.shareAsync as jest.Mock).mockResolvedValue(undefined);
  (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///mock/import.json' }],
  });
});

/** Parse the JSON blob that exportDatabaseData wrote to the temp `.json` file. */
function getExportedJson() {
  const calls = (FileSystem.writeAsStringAsync as jest.Mock).mock.calls;
  const jsonCall = [...calls].reverse().find(c => String(c[0]).endsWith('.json'));
  if (!jsonCall) throw new Error('no export JSON write was recorded');
  return JSON.parse(jsonCall[1]);
}

/** entry_media INSERT calls issued against a mock DB during import. */
function mediaInserts(db: ReturnType<typeof createMockDatabase>) {
  return db.runAsync.mock.calls.filter((c: any[]) => /INSERT INTO entry_media/i.test(c[0]));
}

describe('importDatabaseData', () => {
  it('returns failure when picker is cancelled', async () => {
    const db = createMockDatabase();
    (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValueOnce({
      canceled: true,
    });

    const result = await importDatabaseData(db as any);
    expect(result.success).toBe(false);
    expect(result.message).toBe('Import cancelled');
  });

  it('returns failure for invalid JSON', async () => {
    const db = createMockDatabase();
    (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///mock/bad.json' }],
    });
    (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValueOnce('not valid json{{{');

    const result = await importDatabaseData(db as any);
    expect(result.success).toBe(false);
  });

  it('does NOT delete all existing entries (non-destructive import)', async () => {
    const db = createMockDatabase();

    const importPayload = {
      version: 1,
      exportDate: '2025-01-01',
      data: {
        activityGroups: [{ id: 1, name: 'Sports' }],
        activities: [{ id: 1, name: 'Running', group_id: 1 }],
        entries: [
          { id: 1, mood: 7, notes: 'good day', date: '2025-01-01', activity_ids: '1' },
        ],
        settings: [],
      },
    };

    (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///mock/data.json' }],
    });
    (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValueOnce(
      JSON.stringify(importPayload)
    );

    // Mock existing groups/activities queries
    db.getAllAsync
      .mockResolvedValueOnce([]) // existing groups
      .mockResolvedValueOnce([]); // existing activities

    db.runAsync.mockResolvedValue({ lastInsertRowId: 1, changes: 1 });

    await importDatabaseData(db as any);

    // Check that no blanket DELETE FROM entries (without WHERE) was issued
    const deleteCalls = db.runAsync.mock.calls.filter((call: any[]) => {
      const sql = (call[0] as string).trim().toUpperCase();
      return sql === 'DELETE FROM ENTRY_ACTIVITIES' || sql === 'DELETE FROM ENTRIES';
    });
    expect(deleteCalls).toHaveLength(0);
  });

  it('is robust to one embedded photo whose write fails — skips it, completes the rest', async () => {
    const db = createMockDatabase();
    const payload = {
      version: 3,
      exportDate: '2026-06-28',
      data: {
        activityGroups: [{ id: 1, name: 'Sports' }],
        activities: [],
        entries: [
          {
            id: 1, mood: 5, notes: 'a', date: '2025-01-01', activity_ids: '',
            photos: [
              { media_type: 'image', file_path: '/old/a.jpg', ext: 'jpg', data_base64: 'QUJD' },
              { media_type: 'image', file_path: '/old/b.jpg', ext: 'jpg', data_base64: 'REVG' },
            ],
          },
        ],
        settings: [{ key: 'theme', value: 'dark' }],
      },
    };

    (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///mock/v3.json' }],
    });
    (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValueOnce(JSON.stringify(payload));
    // First embedded photo writes fine; second one's write throws.
    (FileSystem.writeAsStringAsync as jest.Mock)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('disk full'));

    db.getAllAsync
      .mockResolvedValueOnce([]) // existing groups
      .mockResolvedValueOnce([]); // existing activities

    const result = await importDatabaseData(db as any);

    // The whole import still completes despite the one corrupt photo.
    expect(result.success).toBe(true);
    // Only the photo that wrote successfully got an entry_media row.
    expect(mediaInserts(db)).toHaveLength(1);
    // The rest of the import (settings) still ran.
    const settingInserts = db.runAsync.mock.calls.filter((c: any[]) =>
      /INSERT OR REPLACE INTO user_settings/i.test(c[0])
    );
    expect(settingInserts).toHaveLength(1);
  });

  it('imports a legacy v2 (path-only) backup without crashing', async () => {
    const db = createMockDatabase();
    const payload = {
      version: 2,
      exportDate: '2026-01-01',
      data: {
        activityGroups: [{ id: 1, name: 'Sports' }],
        activities: [],
        entries: [
          {
            id: 1, mood: 6, notes: 'legacy', date: '2025-01-01', activity_ids: '',
            photos: [{ file_path: '/old/device/p.jpg', media_type: 'image' }],
          },
        ],
        settings: [],
      },
    };

    (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///mock/v2.json' }],
    });
    (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValueOnce(JSON.stringify(payload));

    db.getAllAsync
      .mockResolvedValueOnce([]) // existing groups
      .mockResolvedValueOnce([]); // existing activities

    const result = await importDatabaseData(db as any);

    expect(result.success).toBe(true);
    // v2 keeps the legacy "re-add manually" message (photos don't travel).
    expect(result.message).toMatch(/re-added manually/i);
    // The path reference is inserted verbatim (best-effort, unchanged behaviour).
    const inserts = mediaInserts(db);
    expect(inserts).toHaveLength(1);
    expect(inserts[0][1][1]).toBe('/old/device/p.jpg');
    // No base64 bytes were materialised for a legacy backup.
    const mediaWrites = (FileSystem.writeAsStringAsync as jest.Mock).mock.calls.filter(
      (c: any[]) => String(c[0]).startsWith(MEDIA_DIR)
    );
    expect(mediaWrites).toHaveLength(0);
  });
});

describe('exportDatabaseData', () => {
  it('exported JSON includes version 3 and exportDate fields', async () => {
    const db = createMockDatabase();
    db.getAllAsync
      .mockResolvedValueOnce([]) // entries
      .mockResolvedValueOnce([]) // entry_media (photos)
      .mockResolvedValueOnce([]) // activities
      .mockResolvedValueOnce([]) // activity groups
      .mockResolvedValueOnce([]); // settings

    const result = await exportDatabaseData(db as any);
    expect(result.success).toBe(true);

    const json = getExportedJson();
    expect(json).toHaveProperty('version', 3);
    expect(json).toHaveProperty('exportDate');
  });

  it('embeds each photo as base64 image bytes on the exported entry (v3)', async () => {
    const db = createMockDatabase();
    db.getAllAsync
      .mockResolvedValueOnce([
        { id: 1, mood: 5, notes: 'a', date: '2025-01-01' },
        { id: 2, mood: 7, notes: 'b', date: '2025-01-02' },
      ]) // entries
      .mockResolvedValueOnce([
        { entry_id: 1, file_path: '/media/x.JPG', media_type: 'image' },
        { entry_id: 1, file_path: '/media/y.png', media_type: 'image' },
      ]) // entry_media (photos)
      .mockResolvedValueOnce([]) // activities
      .mockResolvedValueOnce([]) // activity groups
      .mockResolvedValueOnce([]); // settings
    (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValue('SU1HQllURVM=');

    const result = await exportDatabaseData(db as any);
    expect(result.success).toBe(true);

    const json = getExportedJson();
    expect(json.version).toBe(3);
    const entry1 = json.data.entries.find((e: any) => e.id === 1);
    const entry2 = json.data.entries.find((e: any) => e.id === 2);
    expect(entry1.photos).toHaveLength(2);
    // Actual image bytes travel, not just a path reference.
    expect(entry1.photos[0].data_base64).toBe('SU1HQllURVM=');
    // ext derived from the original path, lowercased.
    expect(entry1.photos[0].ext).toBe('jpg');
    expect(entry1.photos[1].ext).toBe('png');
    expect(entry2.photos).toEqual([]);
    // Files are read with Base64 encoding.
    expect(FileSystem.readAsStringAsync).toHaveBeenCalledWith('/media/x.JPG', {
      encoding: 'base64',
    });
  });

  it('skips a missing source file without failing the export', async () => {
    const db = createMockDatabase();
    db.getAllAsync
      .mockResolvedValueOnce([{ id: 1, mood: 5, notes: 'a', date: '2025-01-01' }]) // entries
      .mockResolvedValueOnce([
        { entry_id: 1, file_path: '/media/present.jpg', media_type: 'image' },
        { entry_id: 1, file_path: '/media/gone.jpg', media_type: 'image' },
      ]) // entry_media
      .mockResolvedValueOnce([]) // activities
      .mockResolvedValueOnce([]) // activity groups
      .mockResolvedValueOnce([]); // settings
    (FileSystem.getInfoAsync as jest.Mock)
      .mockResolvedValueOnce({ exists: true }) // present.jpg
      .mockResolvedValueOnce({ exists: false }); // gone.jpg -> skipped
    (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValue('QUJD');

    const result = await exportDatabaseData(db as any);
    expect(result.success).toBe(true);

    const json = getExportedJson();
    const entry1 = json.data.entries[0];
    expect(entry1.photos).toHaveLength(1);
    expect(entry1.photos[0].file_path).toBe('/media/present.jpg');
  });

  it('skips a source whose read throws, keeping the readable ones', async () => {
    const db = createMockDatabase();
    db.getAllAsync
      .mockResolvedValueOnce([{ id: 1, mood: 5, notes: 'a', date: '2025-01-01' }]) // entries
      .mockResolvedValueOnce([
        { entry_id: 1, file_path: '/media/a.jpg', media_type: 'image' },
        { entry_id: 1, file_path: '/media/b.jpg', media_type: 'image' },
      ]) // entry_media
      .mockResolvedValueOnce([]) // activities
      .mockResolvedValueOnce([]) // activity groups
      .mockResolvedValueOnce([]); // settings
    (FileSystem.readAsStringAsync as jest.Mock)
      .mockRejectedValueOnce(new Error('io error')) // a.jpg unreadable -> skipped
      .mockResolvedValueOnce('QUJD'); // b.jpg ok

    const result = await exportDatabaseData(db as any);
    expect(result.success).toBe(true);

    const json = getExportedJson();
    expect(json.data.entries[0].photos).toHaveLength(1);
    expect(json.data.entries[0].photos[0].file_path).toBe('/media/b.jpg');
  });

  it('handles sharing unavailable gracefully', async () => {
    const db = createMockDatabase();
    db.getAllAsync.mockResolvedValue([]);
    (Sharing.isAvailableAsync as jest.Mock).mockResolvedValueOnce(false);

    const result = await exportDatabaseData(db as any, 'share');
    expect(result.success).toBe(false);
    expect(result.message).toContain('not available');
  });
});

describe('round-trip: export then import carries photos across installs', () => {
  it('embeds photo bytes on export and restores them to NEW local paths on import', async () => {
    // --- EXPORT (originating device) ---
    const exportDb = createMockDatabase();
    exportDb.getAllAsync
      .mockResolvedValueOnce([{ id: 1, mood: 5, notes: 'a', date: '2025-01-01' }]) // entries
      .mockResolvedValueOnce([
        { entry_id: 1, file_path: '/old/sandbox/entry_media/p.jpg', media_type: 'image' },
      ]) // entry_media
      .mockResolvedValueOnce([]) // activities
      // activity groups MUST be non-empty: the importer only reaches entries
      // (and their photos) inside the activityGroups block.
      .mockResolvedValueOnce([{ id: 1, name: 'Sports' }]) // activity groups
      .mockResolvedValueOnce([]); // settings
    (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValue('QUJDREVG'); // source bytes

    const exportResult = await exportDatabaseData(exportDb as any);
    expect(exportResult.success).toBe(true);

    const backup = getExportedJson();
    expect(backup.version).toBe(3);
    const exportedPhoto = backup.data.entries[0].photos[0];
    expect(exportedPhoto.data_base64).toBe('QUJDREVG');

    // --- IMPORT (fresh install / new sandbox) ---
    jest.clearAllMocks();
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({ exists: true });
    (FileSystem.writeAsStringAsync as jest.Mock).mockResolvedValue(undefined);
    (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///fresh/backup.json' }],
    });
    (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValue(JSON.stringify(backup));

    const importDb = createMockDatabase();
    importDb.getAllAsync
      .mockResolvedValueOnce([]) // existing groups
      .mockResolvedValueOnce([]); // existing activities

    const importResult = await importDatabaseData(importDb as any);
    expect(importResult.success).toBe(true);
    expect(importResult.message).toMatch(/photos were restored/i);

    // The bytes were written into the NEW app's media dir, with Base64 encoding.
    const mediaWrite = (FileSystem.writeAsStringAsync as jest.Mock).mock.calls.find(
      (c: any[]) => String(c[0]).startsWith(MEDIA_DIR)
    );
    expect(mediaWrite).toBeDefined();
    expect(mediaWrite![1]).toBe('QUJDREVG');
    expect(mediaWrite![2]).toEqual({ encoding: 'base64' });

    // entry_media row points at the rewritten NEW local path, NOT the old one.
    const inserts = mediaInserts(importDb);
    expect(inserts).toHaveLength(1);
    const insertedPath = inserts[0][1][1] as string;
    expect(insertedPath.startsWith(MEDIA_DIR)).toBe(true);
    expect(insertedPath).not.toBe('/old/sandbox/entry_media/p.jpg');
  });
});
