import { createMockDatabase } from 'expo-sqlite';

jest.mock('expo-sqlite');
jest.mock('@/components/IconPicker', () => ({ IconFamilyType: {} }));
jest.mock('@/components/types', () => ({}));

import {
  getActivities,
  addActivity,
  updateActivity,
  deleteActivity,
  updateActivityPositions,
} from '@/databases/activities';

describe('getActivities', () => {
  it('returns empty array on error', async () => {
    const db = createMockDatabase();
    db.getAllAsync.mockRejectedValue(new Error('disk gone'));

    const result = await getActivities(db as any);
    expect(result).toEqual([]);
  });

  it('orders by group_id then position', async () => {
    const db = createMockDatabase();
    await getActivities(db as any);
    const sql = db.getAllAsync.mock.calls[0][0] as string;
    expect(sql).toContain('ORDER BY group_id, position');
  });
});

describe('addActivity — additional', () => {
  it('rejects empty name', async () => {
    const db = createMockDatabase();
    const result = await addActivity(db as any, '', 1);
    expect(result.success).toBe(false);
    expect(result.message).toContain('empty');
  });

  it('rejects whitespace-only name', async () => {
    const db = createMockDatabase();
    const result = await addActivity(db as any, '   ', 1);
    expect(result.success).toBe(false);
    expect(result.message).toContain('empty');
  });

  it('trims name before insert', async () => {
    const db = createMockDatabase();
    db.getFirstAsync.mockResolvedValue({ maxPosition: 0 });
    db.runAsync.mockResolvedValue({ lastInsertRowId: 1, changes: 1 });

    await addActivity(db as any, '  Yoga  ', 1);
    const insertCall = db.runAsync.mock.calls[0];
    expect(insertCall[1]).toContain('Yoga');
    expect(insertCall[1]).not.toContain('  Yoga  ');
  });

  it('returns failure result on DB throw', async () => {
    const db = createMockDatabase();
    db.getFirstAsync.mockRejectedValue(new Error('boom'));

    const result = await addActivity(db as any, 'New', 1);
    expect(result.success).toBe(false);
    expect(result.message).toContain('Error');
  });

  it('handles null maxPosition (empty group) by starting at 1', async () => {
    const db = createMockDatabase();
    db.getFirstAsync.mockResolvedValue(null);
    db.runAsync.mockResolvedValue({ lastInsertRowId: 1, changes: 1 });

    await addActivity(db as any, 'First', 1);
    const insertCall = db.runAsync.mock.calls[0];
    expect(insertCall[1]).toContain(1);
  });

  it('uses provided icon family and name', async () => {
    const db = createMockDatabase();
    db.getFirstAsync.mockResolvedValue({ maxPosition: 0 });
    db.runAsync.mockResolvedValue({ lastInsertRowId: 1, changes: 1 });

    await addActivity(db as any, 'Test', 1, 'MaterialIcons', 'star');
    const args = db.runAsync.mock.calls[0][1];
    expect(args).toContain('MaterialIcons');
    expect(args).toContain('star');
  });
});

describe('updateActivity — additional', () => {
  it('trims new name before update', async () => {
    const db = createMockDatabase();
    db.getFirstAsync
      .mockResolvedValueOnce({ group_id: 1 })
      .mockResolvedValueOnce(null);
    db.runAsync.mockResolvedValue({ lastInsertRowId: 1, changes: 1 });

    await updateActivity(db as any, 1, '  Renamed  ', 'Feather', 'check');
    // Two getFirstAsync calls; then UPDATE
    const updateCall = db.runAsync.mock.calls.find((c: any[]) =>
      typeof c[0] === 'string' && c[0].includes('UPDATE activities')
    );
    expect(updateCall![1]).toContain('Renamed');
    expect(updateCall![1]).not.toContain('  Renamed  ');
  });

  it('allows updating an activity to a name that exists in a DIFFERENT group', async () => {
    const db = createMockDatabase();
    // Current activity is in group 1; duplicate check is scoped to group 1,
    // so we return null for the duplicate query.
    db.getFirstAsync
      .mockResolvedValueOnce({ group_id: 1 })
      .mockResolvedValueOnce(null);
    db.runAsync.mockResolvedValue({ lastInsertRowId: 1, changes: 1 });

    const result = await updateActivity(db as any, 1, 'SameName', 'Feather', 'check');
    expect(result.success).toBe(true);
  });

  it('returns failure on DB throw', async () => {
    const db = createMockDatabase();
    db.getFirstAsync.mockRejectedValue(new Error('disk gone'));

    const result = await updateActivity(db as any, 1, 'X', 'Feather', 'circle');
    expect(result.success).toBe(false);
  });

  it('rejects whitespace-only name', async () => {
    const db = createMockDatabase();
    const result = await updateActivity(db as any, 1, '   ', 'Feather', 'circle');
    expect(result.success).toBe(false);
    expect(result.message).toContain('empty');
  });
});

describe('deleteActivity — additional', () => {
  it('compacts positions of activities after the deleted one', async () => {
    const db = createMockDatabase();
    // Activity at position 2 in group 1
    db.getFirstAsync.mockResolvedValue({ group_id: 1, position: 2 });
    db.runAsync.mockResolvedValue({ lastInsertRowId: 1, changes: 1 });

    await deleteActivity(db as any, 5);

    // Find the UPDATE that compacts positions
    const compactCall = db.runAsync.mock.calls.find((c: any[]) =>
      typeof c[0] === 'string' && c[0].includes('position = position - 1')
    );
    expect(compactCall).toBeDefined();
    // The WHERE clause should target the same group and positions > 2
    expect(compactCall![1]).toEqual([1, 2]);
  });

  it('returns failure on DB throw during initial lookup', async () => {
    const db = createMockDatabase();
    db.getFirstAsync.mockRejectedValue(new Error('disk gone'));

    const result = await deleteActivity(db as any, 1);
    expect(result.success).toBe(false);
  });

  it('returns failure on DB throw inside transaction', async () => {
    const db = createMockDatabase();
    db.getFirstAsync.mockResolvedValue({ group_id: 1, position: 1 });
    db.withExclusiveTransactionAsync.mockRejectedValue(new Error('txn failed'));

    const result = await deleteActivity(db as any, 1);
    expect(result.success).toBe(false);
  });
});

describe('updateActivityPositions', () => {
  it('updates positions 1..N in supplied order', async () => {
    const db = createMockDatabase();
    db.runAsync.mockResolvedValue({ lastInsertRowId: 1, changes: 1 });

    await updateActivityPositions(db as any, [
      { id: 100, name: '', group_id: 1, position: 0 } as any,
      { id: 200, name: '', group_id: 1, position: 0 } as any,
      { id: 300, name: '', group_id: 1, position: 0 } as any,
    ]);

    const updateCalls = db.runAsync.mock.calls.filter((c: any[]) =>
      typeof c[0] === 'string' && c[0].includes('UPDATE activities SET position')
    );
    expect(updateCalls.length).toBe(3);
    expect(updateCalls[0][1]).toEqual([1, 100]);
    expect(updateCalls[1][1]).toEqual([2, 200]);
    expect(updateCalls[2][1]).toEqual([3, 300]);
  });

  it('returns failure when the transaction throws', async () => {
    const db = createMockDatabase();
    db.withExclusiveTransactionAsync.mockRejectedValue(new Error('txn boom'));

    const result = await updateActivityPositions(db as any, []);
    expect(result.success).toBe(false);
  });
});
