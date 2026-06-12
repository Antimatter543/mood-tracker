import { createMockDatabase } from 'expo-sqlite';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

jest.mock('expo-sqlite');
jest.mock('expo-document-picker');
jest.mock('expo-file-system/legacy');
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
});

describe('exportDatabaseData', () => {
  it('exported JSON includes version and exportDate fields', async () => {
    const db = createMockDatabase();
    db.getAllAsync
      .mockResolvedValueOnce([]) // entries
      .mockResolvedValueOnce([]) // entry_media (photos)
      .mockResolvedValueOnce([]) // activities
      .mockResolvedValueOnce([]) // activity groups
      .mockResolvedValueOnce([]); // settings

    const result = await exportDatabaseData(db as any);
    expect(result.success).toBe(true);

    // Verify the written JSON contains version and exportDate
    const writeCall = (FileSystem.writeAsStringAsync as jest.Mock).mock.calls[0];
    const writtenJson = JSON.parse(writeCall[1]);
    expect(writtenJson).toHaveProperty('version', 2);
    expect(writtenJson).toHaveProperty('exportDate');
  });

  it('embeds a photos array (file refs) on each exported entry', async () => {
    const db = createMockDatabase();
    db.getAllAsync
      .mockResolvedValueOnce([
        { id: 1, mood: 5, notes: 'a', date: '2025-01-01' },
        { id: 2, mood: 7, notes: 'b', date: '2025-01-02' },
      ]) // entries
      .mockResolvedValueOnce([
        { entry_id: 1, file_path: '/media/x.jpg', media_type: 'image' },
        { entry_id: 1, file_path: '/media/y.jpg', media_type: 'image' },
      ]) // entry_media (photos)
      .mockResolvedValueOnce([]) // activities
      .mockResolvedValueOnce([]) // activity groups
      .mockResolvedValueOnce([]); // settings

    const result = await exportDatabaseData(db as any);
    expect(result.success).toBe(true);

    // Mocks aren't cleared between tests in this suite, so use the most recent
    // write call (this test's own export), not calls[0].
    const writeCalls = (FileSystem.writeAsStringAsync as jest.Mock).mock.calls;
    const writeCall = writeCalls[writeCalls.length - 1];
    const writtenJson = JSON.parse(writeCall[1]);
    const entries = writtenJson.data.entries;
    const entry1 = entries.find((e: any) => e.id === 1);
    const entry2 = entries.find((e: any) => e.id === 2);
    expect(entry1.photos).toHaveLength(2);
    expect(entry1.photos[0].file_path).toBe('/media/x.jpg');
    expect(entry2.photos).toEqual([]);
    // File refs only — no embedded base64 blob.
    expect(JSON.stringify(entry1.photos)).not.toMatch(/base64|data:image/);
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
