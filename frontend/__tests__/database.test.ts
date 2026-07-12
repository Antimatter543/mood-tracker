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
import {
  __setWriteConnectionForTests,
  __resetWriteTransactionForTests,
} from '@/databases/writeTransaction';

// Route the write transaction onto the same mock we assert on (`txn === db`).
const makeDb = () => {
  const db = createMockDatabase();
  __setWriteConnectionForTests(db as any);
  return db;
};

beforeEach(() => {
  __resetWriteTransactionForTests();
});

describe('addMoodEntry', () => {
  it('rejects mood < 0', async () => {
    const db = makeDb();
    const result = await addMoodEntry(db as any, -1, [], 'test');
    expect(result.success).toBe(false);
    expect(result.message).toContain('valid mood score');
  });

  it('rejects mood > 10', async () => {
    const db = makeDb();
    const result = await addMoodEntry(db as any, 11, [], 'test');
    expect(result.success).toBe(false);
    expect(result.message).toContain('valid mood score');
  });

  it('rejects NaN mood', async () => {
    const db = makeDb();
    const result = await addMoodEntry(db as any, NaN, [], 'test');
    expect(result.success).toBe(false);
  });

  it('uses a real write transaction for a valid entry', async () => {
    const db = makeDb();
    // getAllAsync is used by filterValidActivityIds
    db.getAllAsync.mockResolvedValue([]);
    db.runAsync.mockResolvedValue({ lastInsertRowId: 1, changes: 1 });

    const result = await addMoodEntry(db as any, 5, [], 'test note');
    expect(result.success).toBe(true);
    // Real transaction on the write connection (BEGIN IMMEDIATE), not expo's
    // transaction API (whose statements this codebase used to run outside any
    // transaction — see databases/writeTransaction.ts).
    const beganImmediate = db.execAsync.mock.calls.some(
      (c: any[]) => typeof c[0] === 'string' && c[0].toUpperCase().includes('BEGIN IMMEDIATE')
    );
    expect(beganImmediate).toBe(true);
    expect(db.withExclusiveTransactionAsync).not.toHaveBeenCalled();
    expect(db.withTransactionAsync).not.toHaveBeenCalled();
  });

  it('filters invalid activity IDs', async () => {
    const db = makeDb();
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
    const db = makeDb();
    // getMoodEntries is a READ with NO transaction wrapper, so the error must
    // come from the query itself, not from a (now-absent) transaction.
    db.getAllAsync.mockRejectedValue(new Error('DB error'));

    const result = await getMoodEntries(db as any);
    expect(result).toEqual([]);
  });
});

describe('addActivity', () => {
  it('calculates next position from max', async () => {
    const db = makeDb();
    db.getFirstAsync.mockResolvedValue({ maxPosition: 3 });
    db.runAsync.mockResolvedValue({ lastInsertRowId: 1, changes: 1 });

    await addActivity(db as any, 'New Activity', 1);

    // Should insert with position 4 (maxPosition + 1)
    const runCall = db.runAsync.mock.calls[0];
    expect(runCall[1]).toContain(4); // position arg
  });

  it('uses default icons when not specified', async () => {
    const db = makeDb();
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
    const db = makeDb();
    db.getFirstAsync.mockResolvedValue(null);

    const result = await deleteActivity(db as any, 999);
    expect(result.success).toBe(false);
    expect(result.message).toContain('not found');
  });

  it('uses a real write transaction for deletion', async () => {
    const db = makeDb();
    db.getFirstAsync.mockResolvedValue({ group_id: 1, position: 2 });

    await deleteActivity(db as any, 1);
    const beganImmediate = db.execAsync.mock.calls.some(
      (c: any[]) => typeof c[0] === 'string' && c[0].toUpperCase().includes('BEGIN IMMEDIATE')
    );
    expect(beganImmediate).toBe(true);
    expect(db.withExclusiveTransactionAsync).not.toHaveBeenCalled();
    expect(db.withTransactionAsync).not.toHaveBeenCalled();
  });
});

describe('addActivityGroup', () => {
  it('rejects empty name', async () => {
    const db = makeDb();
    const result = await addActivityGroup(db as any, '  ');
    expect(result.success).toBe(false);
    expect(result.message).toContain('empty');
  });

  it('rejects duplicate name', async () => {
    const db = makeDb();
    db.getFirstAsync.mockResolvedValue({ id: 1 });

    const result = await addActivityGroup(db as any, 'Existing Group');
    expect(result.success).toBe(false);
    expect(result.message).toContain('already exists');
  });

  it('trims whitespace from name', async () => {
    const db = makeDb();
    db.getFirstAsync.mockResolvedValue(null); // no duplicate
    db.runAsync.mockResolvedValue({ lastInsertRowId: 1, changes: 1 });

    await addActivityGroup(db as any, '  My Group  ');

    const runCall = db.runAsync.mock.calls[0];
    expect(runCall[1]).toContain('My Group');
  });
});

describe('updateActivity', () => {
  it('rejects empty name', async () => {
    const db = makeDb();
    const result = await updateActivity(db as any, 1, '', 'Feather', 'circle');
    expect(result.success).toBe(false);
    expect(result.message).toContain('empty');
  });

  it('checks duplicate within same group', async () => {
    const db = makeDb();
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
    const db = makeDb();
    db.getFirstAsync.mockResolvedValue(null);

    const result = await updateActivity(db as any, 999, 'Test', 'Feather', 'circle');
    expect(result.success).toBe(false);
    expect(result.message).toContain('not found');
  });
});
