import { createMockDatabase } from 'expo-sqlite';

jest.mock('expo-sqlite');
jest.mock('@/components/IconPicker', () => ({ IconFamilyType: {} }));
jest.mock('@/components/types', () => ({}));

import {
  GROUP_ORDER_BY,
  getActivityGroups,
  addActivityGroup,
  renameActivityGroup,
  reorderActivityGroups,
  getGroupDeletionImpact,
} from '@/databases/groups';
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

describe('GROUP_ORDER_BY', () => {
  it('is the canonical sort_order, id ordering clause', () => {
    expect(GROUP_ORDER_BY).toBe('ORDER BY sort_order, id');
  });
});

describe('getActivityGroups', () => {
  it('reads through GROUP_ORDER_BY (sort_order, id) — never a bare ORDER BY id', async () => {
    const db = makeDb();
    const rows = [{ id: 2, name: 'Health', sort_order: 1 }];
    db.getAllAsync.mockResolvedValue(rows);

    const result = await getActivityGroups(db as any);

    expect(result).toEqual(rows);
    expect(db.getAllAsync).toHaveBeenCalledWith(
      expect.stringContaining('ORDER BY sort_order, id')
    );
    expect(db.getAllAsync).toHaveBeenCalledWith(
      expect.stringMatching(/SELECT \* FROM activity_groups/)
    );
  });

  it('returns [] on DB error rather than throwing', async () => {
    const db = makeDb();
    db.getAllAsync.mockRejectedValue(new Error('disk gone'));

    const result = await getActivityGroups(db as any);
    expect(result).toEqual([]);
  });
});

describe('addActivityGroup — append-to-end ordering', () => {
  it('appends past the current MAX(sort_order): inserts with sort_order = maxOrder + 1', async () => {
    const db = makeDb();
    db.getFirstAsync
      .mockResolvedValueOnce(null) // duplicate-name check: no clash
      .mockResolvedValueOnce({ maxOrder: 5 }); // COALESCE(MAX(sort_order), 0)
    db.runAsync.mockResolvedValue({ lastInsertRowId: 9, changes: 1 });

    const result = await addActivityGroup(db as any, 'NewGroup');

    expect(result.success).toBe(true);
    expect(db.runAsync).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO activity_groups'),
      ['NewGroup', 6]
    );
  });

  it('a brand-new table (COALESCE fallback to 0) inserts the first group at sort_order 1', async () => {
    const db = makeDb();
    db.getFirstAsync
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ maxOrder: 0 });
    db.runAsync.mockResolvedValue({ lastInsertRowId: 1, changes: 1 });

    await addActivityGroup(db as any, 'FirstGroup');

    expect(db.runAsync).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO activity_groups'),
      ['FirstGroup', 1]
    );
  });

  it('trims the name before checking for a duplicate and before insert', async () => {
    const db = makeDb();
    db.getFirstAsync
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ maxOrder: 2 });
    db.runAsync.mockResolvedValue({ lastInsertRowId: 3, changes: 1 });

    await addActivityGroup(db as any, '  Padded  ');

    expect(db.getFirstAsync).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('WHERE name = ?'),
      ['Padded']
    );
    expect(db.runAsync).toHaveBeenCalledWith(expect.any(String), ['Padded', 3]);
  });

  it('rejects an empty/whitespace-only name without touching the DB', async () => {
    const db = makeDb();

    const result = await addActivityGroup(db as any, '   ');

    expect(result).toEqual({ success: false, message: 'Group name cannot be empty' });
    expect(db.getFirstAsync).not.toHaveBeenCalled();
    expect(db.runAsync).not.toHaveBeenCalled();
  });

  it('rejects a name that already exists (case-sensitive match)', async () => {
    const db = makeDb();
    db.getFirstAsync.mockResolvedValueOnce({ id: 1 });

    const result = await addActivityGroup(db as any, 'Sports');

    expect(result).toEqual({
      success: false,
      message: 'A group with this name already exists',
    });
    expect(db.runAsync).not.toHaveBeenCalled();
  });
});

describe('renameActivityGroup', () => {
  it('rejects an empty name without querying the DB', async () => {
    const db = makeDb();

    const result = await renameActivityGroup(db as any, 1, '');

    expect(result).toEqual({ success: false, message: 'Group name cannot be empty' });
    expect(db.getFirstAsync).not.toHaveBeenCalled();
  });

  it('rejects a whitespace-only name without querying the DB', async () => {
    const db = makeDb();

    const result = await renameActivityGroup(db as any, 1, '   \t  ');

    expect(result).toEqual({ success: false, message: 'Group name cannot be empty' });
    expect(db.getFirstAsync).not.toHaveBeenCalled();
  });

  it('trims the new name before the duplicate check and the UPDATE', async () => {
    const db = makeDb();
    db.getFirstAsync
      .mockResolvedValueOnce({ id: 1 }) // group exists
      .mockResolvedValueOnce(null); // no duplicate
    db.runAsync.mockResolvedValue({ lastInsertRowId: 0, changes: 1 });

    const result = await renameActivityGroup(db as any, 1, '  Fitness  ');

    expect(result.success).toBe(true);
    expect(db.getFirstAsync).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('WHERE name = ? AND id != ?'),
      ['Fitness', 1]
    );
    expect(db.runAsync).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE activity_groups SET name = ?'),
      ['Fitness', 1]
    );
  });

  it('returns "not found" when the group id does not exist', async () => {
    const db = makeDb();
    db.getFirstAsync.mockResolvedValueOnce(null);

    const result = await renameActivityGroup(db as any, 999, 'Anything');

    expect(result).toEqual({ success: false, message: 'Activity group not found' });
    expect(db.runAsync).not.toHaveBeenCalled();
  });

  it('rejects a name already taken by ANOTHER group', async () => {
    const db = makeDb();
    db.getFirstAsync
      .mockResolvedValueOnce({ id: 1 }) // group exists
      .mockResolvedValueOnce({ id: 2 }); // duplicate owned by a different group

    const result = await renameActivityGroup(db as any, 1, 'Health');

    expect(result).toEqual({
      success: false,
      message: 'A group with this name already exists',
    });
    expect(db.runAsync).not.toHaveBeenCalled();
  });

  it('renaming a group to its OWN current name is a legal no-op (duplicate check excludes self)', async () => {
    const db = makeDb();
    // The duplicate query is `WHERE name = ? AND id != ?` — with id=1 excluded,
    // no OTHER row shares the name, so it resolves null even though group 1
    // itself already has this name.
    db.getFirstAsync
      .mockResolvedValueOnce({ id: 1 })
      .mockResolvedValueOnce(null);
    db.runAsync.mockResolvedValue({ lastInsertRowId: 0, changes: 1 });

    const result = await renameActivityGroup(db as any, 1, 'Sports');

    expect(result.success).toBe(true);
    expect(db.runAsync).toHaveBeenCalledWith(expect.any(String), ['Sports', 1]);
  });

  it('returns failure (never throws) when the DB throws', async () => {
    const db = makeDb();
    db.getFirstAsync.mockRejectedValue(new Error('boom'));

    const result = await renameActivityGroup(db as any, 1, 'Whatever');

    expect(result).toEqual({ success: false, message: 'Failed to rename group' });
  });
});

describe('reorderActivityGroups', () => {
  it('reassigns contiguous sort_order = index + 1 IN THE SUPPLIED ORDER, all inside the write transaction', async () => {
    const db = makeDb();
    db.runAsync.mockResolvedValue({ lastInsertRowId: 0, changes: 1 });

    // Deliberately out-of-id-order input — the function must not re-sort it.
    const result = await reorderActivityGroups(db as any, [{ id: 5 }, { id: 2 }, { id: 8 }]);

    expect(result.success).toBe(true);
    expect(db.runAsync).toHaveBeenCalledTimes(3);
    // Every call landed on the injected write connection (txn === db).
    expect(db.runAsync).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('UPDATE activity_groups SET sort_order = ? WHERE id = ?'),
      [1, 5]
    );
    expect(db.runAsync).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('UPDATE activity_groups SET sort_order = ? WHERE id = ?'),
      [2, 2]
    );
    expect(db.runAsync).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('UPDATE activity_groups SET sort_order = ? WHERE id = ?'),
      [3, 8]
    );
  });

  it('an empty list is a legal no-op — no writes issued', async () => {
    const db = makeDb();

    const result = await reorderActivityGroups(db as any, []);

    expect(result.success).toBe(true);
    expect(db.runAsync).not.toHaveBeenCalled();
  });

  it('returns failure when the transaction throws (no partial success reported)', async () => {
    const db = makeDb();
    db.runAsync.mockRejectedValue(new Error('locked'));

    const result = await reorderActivityGroups(db as any, [{ id: 1 }, { id: 2 }]);

    expect(result.success).toBe(false);
    expect(result.message).toContain('Failed');
  });
});

describe('getGroupDeletionImpact', () => {
  it('returns zeros with exists:false when the group does not exist', async () => {
    const db = makeDb();
    db.getFirstAsync.mockResolvedValueOnce(null);

    const result = await getGroupDeletionImpact(db as any, 999);

    expect(result).toEqual({ exists: false, activityCount: 0, entryCount: 0 });
  });

  it('zero counts for a group that exists with no activities/entries', async () => {
    const db = makeDb();
    db.getFirstAsync
      .mockResolvedValueOnce({ id: 1 }) // existence
      .mockResolvedValueOnce({ count: 0 }) // entry count (queried first)
      .mockResolvedValueOnce({ count: 0 }); // activity count (queried second)

    const result = await getGroupDeletionImpact(db as any, 1);

    expect(result).toEqual({ exists: true, activityCount: 0, entryCount: 0 });
  });

  it('non-zero counts round-trip correctly, and entry count is queried BEFORE activity count', async () => {
    const db = makeDb();
    db.getFirstAsync
      .mockResolvedValueOnce({ id: 1 })
      .mockResolvedValueOnce({ count: 3 }) // entries
      .mockResolvedValueOnce({ count: 5 }); // activities

    const result = await getGroupDeletionImpact(db as any, 1);

    expect(result).toEqual({ exists: true, activityCount: 5, entryCount: 3 });
    // Assert call ORDER: the 2nd getFirstAsync call is the entry_activities
    // JOIN (entries), the 3rd is the plain activities COUNT.
    expect(db.getFirstAsync.mock.calls[1][0]).toMatch(/entry_activities/i);
    expect(db.getFirstAsync.mock.calls[2][0]).toMatch(/FROM activities/i);
  });

  it('returns the "not found" shape on DB error (never throws)', async () => {
    const db = makeDb();
    db.getFirstAsync.mockRejectedValue(new Error('disk gone'));

    const result = await getGroupDeletionImpact(db as any, 1);

    expect(result).toEqual({ exists: false, activityCount: 0, entryCount: 0 });
  });
});
