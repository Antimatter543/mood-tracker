import { createMockDatabase } from 'expo-sqlite';

jest.mock('expo-sqlite');
jest.mock('@/components/IconPicker', () => ({ IconFamilyType: {} }));
jest.mock('@/components/types', () => ({}));
jest.mock('@/components/seedData', () => ({
  initialActivities: [],
  initialActivityGroups: [],
}));
jest.mock('@/databases/migrations', () => ({ runMigrations: jest.fn() }));

import {
  addMoodEntry,
  getMoodEntries,
  filterValidActivityIds,
} from '@/databases/entries';

describe('addMoodEntry — additional validation', () => {
  it('uses provided date when supplied', async () => {
    const db = createMockDatabase();
    db.getAllAsync.mockResolvedValue([]);
    db.runAsync.mockResolvedValue({ lastInsertRowId: 1, changes: 1 });

    const customDate = '2025-03-15T10:00:00.000Z';
    await addMoodEntry(db as any, 7, [], 'note', customDate);

    // First runAsync call is the INSERT INTO entries
    const insertCall = db.runAsync.mock.calls.find((c: any[]) =>
      typeof c[0] === 'string' && c[0].includes('INSERT INTO entries')
    );
    expect(insertCall).toBeDefined();
    expect(insertCall![1]).toContain(customDate);
  });

  it('uses getDefaultEntryDate (UTC ISO) when date omitted', async () => {
    const db = createMockDatabase();
    db.getAllAsync.mockResolvedValue([]);
    db.runAsync.mockResolvedValue({ lastInsertRowId: 1, changes: 1 });

    await addMoodEntry(db as any, 5, [], 'note');

    const insertCall = db.runAsync.mock.calls.find((c: any[]) =>
      typeof c[0] === 'string' && c[0].includes('INSERT INTO entries')
    );
    const dateArg = insertCall![1][2];
    // ISO 8601 UTC pattern
    expect(dateArg).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('returns failure on transaction throw', async () => {
    const db = createMockDatabase();
    db.withTransactionAsync.mockRejectedValue(new Error('disk full'));

    const result = await addMoodEntry(db as any, 5, [1], 'note');
    expect(result.success).toBe(false);
    expect(result.message).toContain('Error');
  });

  it('inserts a link row for every valid activity', async () => {
    const db = createMockDatabase();
    db.getAllAsync.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    db.runAsync.mockResolvedValue({ lastInsertRowId: 42, changes: 1 });

    await addMoodEntry(db as any, 6, [1, 2], 'note');

    const linkCalls = db.runAsync.mock.calls.filter((c: any[]) =>
      typeof c[0] === 'string' && c[0].includes('INSERT INTO entry_activities')
    );
    expect(linkCalls.length).toBe(2);
    // Each link should use the entry's lastInsertRowId
    for (const call of linkCalls) {
      expect(call[1][0]).toBe(42);
    }
  });

  it('handles empty activities array without inserting links', async () => {
    const db = createMockDatabase();
    db.getAllAsync.mockResolvedValue([]);
    db.runAsync.mockResolvedValue({ lastInsertRowId: 1, changes: 1 });

    const result = await addMoodEntry(db as any, 5, [], 'note');
    expect(result.success).toBe(true);

    const linkCalls = db.runAsync.mock.calls.filter((c: any[]) =>
      typeof c[0] === 'string' && c[0].includes('INSERT INTO entry_activities')
    );
    expect(linkCalls.length).toBe(0);
  });

  it('mood exactly 0 is accepted', async () => {
    const db = createMockDatabase();
    db.getAllAsync.mockResolvedValue([]);
    db.runAsync.mockResolvedValue({ lastInsertRowId: 1, changes: 1 });

    const result = await addMoodEntry(db as any, 0, [], 'edge');
    expect(result.success).toBe(true);
  });

  it('mood exactly 10 is accepted', async () => {
    const db = createMockDatabase();
    db.getAllAsync.mockResolvedValue([]);
    db.runAsync.mockResolvedValue({ lastInsertRowId: 1, changes: 1 });

    const result = await addMoodEntry(db as any, 10, [], 'edge');
    expect(result.success).toBe(true);
  });

  it('runs validation INSIDE the transaction (not before it)', async () => {
    // We invert the mock so the transaction never executes its callback.
    // If filterValidActivityIds ran *outside* the txn, getAllAsync would
    // still be called. If it runs inside, getAllAsync should NOT be called.
    const db = createMockDatabase();
    db.withTransactionAsync.mockImplementation(async () => {
      // do not run the callback — simulates txn rolling back immediately
    });

    await addMoodEntry(db as any, 5, [1, 2], 'note');
    expect(db.getAllAsync).not.toHaveBeenCalled();
  });
});

describe('filterValidActivityIds', () => {
  it('returns empty array for empty input', async () => {
    const db = createMockDatabase();
    const result = await filterValidActivityIds(db as any, []);
    expect(result).toEqual([]);
    expect(db.getAllAsync).not.toHaveBeenCalled();
  });

  it('filters out non-integer values defensively', async () => {
    const db = createMockDatabase();
    db.getAllAsync.mockResolvedValue([{ id: 1 }, { id: 2 }]);

    // Cast to bypass TS — simulate runtime poisoning.
    const result = await filterValidActivityIds(db as any, [
      1,
      2,
      'evil' as any,
      NaN,
      1.5,
    ]);
    expect(result).toEqual([1, 2]);

    // The SQL should only contain real integers in the IN clause.
    const sql = db.getAllAsync.mock.calls[0][0] as string;
    expect(sql).toContain('1,2');
    expect(sql).not.toContain('evil');
    expect(sql).not.toContain('NaN');
    expect(sql).not.toContain('1.5');
  });

  it('returns empty array when only non-integer values are supplied', async () => {
    const db = createMockDatabase();
    const result = await filterValidActivityIds(db as any, [
      'a' as any,
      NaN,
      Infinity,
    ]);
    expect(result).toEqual([]);
    expect(db.getAllAsync).not.toHaveBeenCalled();
  });

  it('returns empty array on DB error', async () => {
    const db = createMockDatabase();
    db.getAllAsync.mockRejectedValue(new Error('db gone'));

    const result = await filterValidActivityIds(db as any, [1, 2]);
    expect(result).toEqual([]);
  });
});

describe('getMoodEntries — additional', () => {
  it('hydrates each entry with its activities', async () => {
    const db = createMockDatabase();
    db.getAllAsync
      .mockResolvedValueOnce([
        { id: 1, mood: 5, notes: 'a', date: '2025-01-01' },
        { id: 2, mood: 7, notes: 'b', date: '2025-01-02' },
      ])
      .mockResolvedValueOnce([{ id: 10, name: 'Run', group_id: 1, icon_name: 'r' }])
      .mockResolvedValueOnce([
        { id: 11, name: 'Read', group_id: 2, icon_name: 'b' },
        { id: 12, name: 'Walk', group_id: 1, icon_name: 'w' },
      ]);

    const result = await getMoodEntries(db as any);
    expect(result).toHaveLength(2);
    expect(result[0].activities).toHaveLength(1);
    expect(result[1].activities).toHaveLength(2);
  });
});
