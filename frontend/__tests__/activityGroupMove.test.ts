import { createMockDatabase } from 'expo-sqlite';

jest.mock('expo-sqlite');
jest.mock('@/components/IconPicker', () => ({ IconFamilyType: {} }));
jest.mock('@/components/types', () => ({}));

import { moveActivityToGroup, moveActivitiesToGroup } from '@/databases/activities';
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

describe('moveActivityToGroup', () => {
  it('fails when the activity does not exist, issuing no write', async () => {
    const db = makeDb();
    db.getFirstAsync.mockResolvedValueOnce(null);

    const result = await moveActivityToGroup(db as any, 999, 2);

    expect(result).toEqual({ success: false, message: 'Activity not found' });
    expect(db.runAsync).not.toHaveBeenCalled();
  });

  it('same-group move is a SUCCESS no-op that issues NO write at all', async () => {
    const db = makeDb();
    db.getFirstAsync.mockResolvedValueOnce({ name: 'Running', group_id: 1, position: 2 });

    const result = await moveActivityToGroup(db as any, 1, 1);

    expect(result).toEqual({ success: true, message: 'Activity is already in this group' });
    // The invariant: NOT a single runAsync call — no transaction, no writes.
    expect(db.runAsync).not.toHaveBeenCalled();
    // Only the activity lookup ran; target-group/name-clash/position queries
    // never fired because the function short-circuited before them.
    expect(db.getFirstAsync).toHaveBeenCalledTimes(1);
  });

  it('fails when the target group does not exist', async () => {
    const db = makeDb();
    db.getFirstAsync
      .mockResolvedValueOnce({ name: 'Running', group_id: 1, position: 2 }) // activity
      .mockResolvedValueOnce(null); // target group lookup

    const result = await moveActivityToGroup(db as any, 1, 999);

    expect(result).toEqual({ success: false, message: 'Target group not found' });
    expect(db.runAsync).not.toHaveBeenCalled();
  });

  it('fails on a name clash in the target group, issuing no write', async () => {
    const db = makeDb();
    db.getFirstAsync
      .mockResolvedValueOnce({ name: 'Running', group_id: 1, position: 2 }) // activity
      .mockResolvedValueOnce({ id: 2 }) // target group exists
      .mockResolvedValueOnce({ id: 7 }); // name clash in target

    const result = await moveActivityToGroup(db as any, 1, 2);

    expect(result).toEqual({
      success: false,
      message: 'An activity with this name already exists in that group',
    });
    expect(db.runAsync).not.toHaveBeenCalled();
  });

  it('happy path: re-files the activity, appends past MAX(position) in target, and compacts the source group', async () => {
    const db = makeDb();
    db.getFirstAsync
      .mockResolvedValueOnce({ name: 'Running', group_id: 1, position: 2 }) // activity
      .mockResolvedValueOnce({ id: 2 }) // target group exists
      .mockResolvedValueOnce(null) // no name clash
      .mockResolvedValueOnce({ maxPosition: 3 }); // target's current max position
    db.runAsync.mockResolvedValue({ lastInsertRowId: 0, changes: 1 });

    const result = await moveActivityToGroup(db as any, 1, 2);

    expect(result).toEqual({ success: true, message: 'Activity moved successfully' });
    expect(db.runAsync).toHaveBeenCalledTimes(2);
    // (a) re-file into target at maxPosition + 1 = 4
    expect(db.runAsync).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('UPDATE activities SET group_id = ?, position = ?'),
      [2, 4, 1]
    );
    // (b) compact the SOURCE group's positions after the vacated slot (position 2)
    expect(db.runAsync).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('position = position - 1'),
      [1, 2]
    );
  });

  it('an empty target group appends at position 1 (COALESCE fallback)', async () => {
    const db = makeDb();
    db.getFirstAsync
      .mockResolvedValueOnce({ name: 'Running', group_id: 1, position: 1 })
      .mockResolvedValueOnce({ id: 2 })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ maxPosition: 0 });
    db.runAsync.mockResolvedValue({ lastInsertRowId: 0, changes: 1 });

    await moveActivityToGroup(db as any, 1, 2);

    expect(db.runAsync).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      [2, 1, 1]
    );
  });

  it('returns failure (never throws) when the transaction fails', async () => {
    const db = makeDb();
    db.getFirstAsync
      .mockResolvedValueOnce({ name: 'Running', group_id: 1, position: 2 })
      .mockResolvedValueOnce({ id: 2 })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ maxPosition: 3 });
    db.runAsync.mockRejectedValue(new Error('locked'));

    const result = await moveActivityToGroup(db as any, 1, 2);

    expect(result).toEqual({ success: false, message: 'Failed to move activity' });
  });
});

describe('moveActivitiesToGroup', () => {
  it('rejects moving a group into itself, with the moved/skipped shape intact', async () => {
    const db = makeDb();

    const result = await moveActivitiesToGroup(db as any, 1, 1);

    expect(result).toEqual({
      success: false,
      message: 'Pick a different group to move these activities into',
      moved: 0,
      skipped: [],
    });
    expect(db.getFirstAsync).not.toHaveBeenCalled();
  });

  it('fails when the target group does not exist', async () => {
    const db = makeDb();
    db.getFirstAsync.mockResolvedValueOnce(null);

    const result = await moveActivitiesToGroup(db as any, 1, 999);

    expect(result).toEqual({
      success: false,
      message: 'Target group not found',
      moved: 0,
      skipped: [],
    });
    expect(db.runAsync).not.toHaveBeenCalled();
  });

  it('every source activity name clashes in the target: nothing moves, all skipped, no write', async () => {
    const db = makeDb();
    db.getFirstAsync.mockResolvedValueOnce({ id: 2 }); // target exists
    db.getAllAsync
      .mockResolvedValueOnce([{ id: 1, name: 'A' }, { id: 2, name: 'B' }]) // source activities
      .mockResolvedValueOnce([{ name: 'A' }, { name: 'B' }]); // target's existing names

    const result = await moveActivitiesToGroup(db as any, 1, 2);

    expect(result.success).toBe(false);
    expect(result.moved).toBe(0);
    expect(result.skipped.sort()).toEqual(['A', 'B']);
    expect(result.message).toBe('Every activity in this group shares a name with one in the target group');
    expect(db.runAsync).not.toHaveBeenCalled();
  });

  it('source group has no activities at all: distinct failure message from the all-skipped case', async () => {
    const db = makeDb();
    db.getFirstAsync.mockResolvedValueOnce({ id: 2 });
    db.getAllAsync
      .mockResolvedValueOnce([]) // no source activities
      .mockResolvedValueOnce([]);

    const result = await moveActivitiesToGroup(db as any, 1, 2);

    expect(result).toEqual({
      success: false,
      message: 'This group has no activities to move',
      moved: 0,
      skipped: [],
    });
  });

  it('happy path: movable activities are appended after the target tail; clashing names are skipped, not fatal', async () => {
    const db = makeDb();
    db.getFirstAsync
      .mockResolvedValueOnce({ id: 2 }) // target exists
      .mockResolvedValueOnce({ maxPosition: 2 }); // target's current max position
    db.getAllAsync
      .mockResolvedValueOnce([
        { id: 1, name: 'A' },
        { id: 2, name: 'B' },
        { id: 3, name: 'C' },
      ]) // source, ordered by position
      .mockResolvedValueOnce([{ name: 'B' }]); // target already has 'B'
    db.runAsync.mockResolvedValue({ lastInsertRowId: 0, changes: 1 });

    const result = await moveActivitiesToGroup(db as any, 1, 2);

    expect(result.success).toBe(true);
    expect(result.moved).toBe(2);
    expect(result.skipped).toEqual(['B']);
    expect(result.message).toBe('Moved 2 activities');

    expect(db.runAsync).toHaveBeenCalledTimes(2);
    // A (id 1) appended at basePosition(2) + 0 + 1 = 3
    expect(db.runAsync).toHaveBeenNthCalledWith(1, expect.any(String), [2, 3, 1]);
    // C (id 3) appended at basePosition(2) + 1 + 1 = 4
    expect(db.runAsync).toHaveBeenNthCalledWith(2, expect.any(String), [2, 4, 3]);
  });

  it('singular message when exactly one activity moves', async () => {
    const db = makeDb();
    db.getFirstAsync
      .mockResolvedValueOnce({ id: 2 })
      .mockResolvedValueOnce({ maxPosition: 0 });
    db.getAllAsync
      .mockResolvedValueOnce([{ id: 1, name: 'A' }])
      .mockResolvedValueOnce([]);
    db.runAsync.mockResolvedValue({ lastInsertRowId: 0, changes: 1 });

    const result = await moveActivitiesToGroup(db as any, 1, 2);

    expect(result.moved).toBe(1);
    expect(result.message).toBe('Moved 1 activity');
  });

  it('returns failure (never throws) when the transaction fails, with moved:0/skipped:[]', async () => {
    const db = makeDb();
    db.getFirstAsync
      .mockResolvedValueOnce({ id: 2 })
      .mockResolvedValueOnce({ maxPosition: 0 });
    db.getAllAsync
      .mockResolvedValueOnce([{ id: 1, name: 'A' }])
      .mockResolvedValueOnce([]);
    db.runAsync.mockRejectedValue(new Error('locked'));

    const result = await moveActivitiesToGroup(db as any, 1, 2);

    expect(result).toEqual({
      success: false,
      message: 'Failed to move activities',
      moved: 0,
      skipped: [],
    });
  });
});
