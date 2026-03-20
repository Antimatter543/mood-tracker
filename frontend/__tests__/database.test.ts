import { createMockDatabase } from 'expo-sqlite';

jest.mock('expo-sqlite');

// Mock the IconPicker to avoid native module issues
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

// Import after mocks are set up
import {
  addMoodEntry,
  getMoodEntries,
  addActivity,
  deleteActivity,
  addActivityGroup,
  updateActivity,
} from '@/databases/database';

describe('addMoodEntry', () => {
  it('rejects mood < 0', async () => {
    const db = createMockDatabase();
    const result = await addMoodEntry(db as any, -1, [], 'test');
    expect(result.success).toBe(false);
    expect(result.message).toContain('valid mood score');
  });

  it('rejects mood > 10', async () => {
    const db = createMockDatabase();
    const result = await addMoodEntry(db as any, 11, [], 'test');
    expect(result.success).toBe(false);
    expect(result.message).toContain('valid mood score');
  });

  it('rejects NaN mood', async () => {
    const db = createMockDatabase();
    const result = await addMoodEntry(db as any, NaN, [], 'test');
    expect(result.success).toBe(false);
  });

  it('uses transaction for valid entry', async () => {
    const db = createMockDatabase();
    // getAllAsync is used by filterValidActivityIds
    db.getAllAsync.mockResolvedValue([]);
    db.runAsync.mockResolvedValue({ lastInsertRowId: 1, changes: 1 });

    const result = await addMoodEntry(db as any, 5, [], 'test note');
    expect(result.success).toBe(true);
    expect(db.withTransactionAsync).toHaveBeenCalled();
  });

  it('filters invalid activity IDs', async () => {
    const db = createMockDatabase();
    // Only ID 1 exists in the mock DB
    db.getAllAsync.mockResolvedValue([{ id: 1 }]);
    db.runAsync.mockResolvedValue({ lastInsertRowId: 1, changes: 1 });

    await addMoodEntry(db as any, 5, [1, 999], 'test');
    // The function should have called getAllAsync to filter activity IDs
    expect(db.getAllAsync).toHaveBeenCalled();
  });
});

describe('getMoodEntries', () => {
  it('returns empty array on error', async () => {
    const db = createMockDatabase();
    db.withTransactionAsync.mockRejectedValue(new Error('DB error'));

    const result = await getMoodEntries(db as any);
    expect(result).toEqual([]);
  });
});

describe('addActivity', () => {
  it('calculates next position from max', async () => {
    const db = createMockDatabase();
    db.getFirstAsync.mockResolvedValue({ maxPosition: 3 });
    db.runAsync.mockResolvedValue({ lastInsertRowId: 1, changes: 1 });

    await addActivity(db as any, 'New Activity', 1);

    // Should insert with position 4 (maxPosition + 1)
    const runCall = db.runAsync.mock.calls[0];
    expect(runCall[1]).toContain(4); // position arg
  });

  it('uses default icons when not specified', async () => {
    const db = createMockDatabase();
    db.getFirstAsync.mockResolvedValue({ maxPosition: 0 });
    db.runAsync.mockResolvedValue({ lastInsertRowId: 1, changes: 1 });

    await addActivity(db as any, 'Test', 1);

    const runCall = db.runAsync.mock.calls[0];
    expect(runCall[1]).toContain('Feather');
    expect(runCall[1]).toContain('circle');
  });
});

describe('deleteActivity', () => {
  it('returns not found for missing ID', async () => {
    const db = createMockDatabase();
    db.getFirstAsync.mockResolvedValue(null);

    const result = await deleteActivity(db as any, 999);
    expect(result.success).toBe(false);
    expect(result.message).toContain('not found');
  });

  it('uses transaction for deletion', async () => {
    const db = createMockDatabase();
    db.getFirstAsync.mockResolvedValue({ group_id: 1, position: 2 });

    await deleteActivity(db as any, 1);
    expect(db.withTransactionAsync).toHaveBeenCalled();
  });
});

describe('addActivityGroup', () => {
  it('rejects empty name', async () => {
    const db = createMockDatabase();
    const result = await addActivityGroup(db as any, '  ');
    expect(result.success).toBe(false);
    expect(result.message).toContain('empty');
  });

  it('rejects duplicate name', async () => {
    const db = createMockDatabase();
    db.getFirstAsync.mockResolvedValue({ id: 1 });

    const result = await addActivityGroup(db as any, 'Existing Group');
    expect(result.success).toBe(false);
    expect(result.message).toContain('already exists');
  });

  it('trims whitespace from name', async () => {
    const db = createMockDatabase();
    db.getFirstAsync.mockResolvedValue(null); // no duplicate
    db.runAsync.mockResolvedValue({ lastInsertRowId: 1, changes: 1 });

    await addActivityGroup(db as any, '  My Group  ');

    const runCall = db.runAsync.mock.calls[0];
    expect(runCall[1]).toContain('My Group');
  });
});

describe('updateActivity', () => {
  it('rejects empty name', async () => {
    const db = createMockDatabase();
    const result = await updateActivity(db as any, 1, '', 'Feather', 'circle');
    expect(result.success).toBe(false);
    expect(result.message).toContain('empty');
  });

  it('checks duplicate within same group', async () => {
    const db = createMockDatabase();
    // First call: get current activity's group_id
    db.getFirstAsync
      .mockResolvedValueOnce({ group_id: 1 })
      // Second call: find existing activity with same name
      .mockResolvedValueOnce({ id: 2 });

    const result = await updateActivity(db as any, 1, 'Duplicate', 'Feather', 'circle');
    expect(result.success).toBe(false);
    expect(result.message).toContain('already exists');
  });

  it('returns not found for missing ID', async () => {
    const db = createMockDatabase();
    db.getFirstAsync.mockResolvedValue(null);

    const result = await updateActivity(db as any, 999, 'Test', 'Feather', 'circle');
    expect(result.success).toBe(false);
    expect(result.message).toContain('not found');
  });
});
