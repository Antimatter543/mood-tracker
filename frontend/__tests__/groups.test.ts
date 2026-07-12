import { createMockDatabase } from 'expo-sqlite';

jest.mock('expo-sqlite');
jest.mock('@/components/IconPicker', () => ({ IconFamilyType: {} }));
jest.mock('@/components/types', () => ({}));

import {
  addActivityGroup,
  deleteActivityGroup,
  checkGroupHasEntries,
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

describe('addActivityGroup — error paths', () => {
  it('returns failure when DB throws on duplicate check', async () => {
    const db = makeDb();
    db.getFirstAsync.mockRejectedValue(new Error('boom'));

    const result = await addActivityGroup(db as any, 'NewGroup');
    expect(result.success).toBe(false);
    expect(result.message).toContain('Failed');
  });

  it('returns failure when DB throws on insert', async () => {
    const db = makeDb();
    db.getFirstAsync.mockResolvedValue(null);
    db.runAsync.mockRejectedValue(new Error('boom'));

    const result = await addActivityGroup(db as any, 'NewGroup');
    expect(result.success).toBe(false);
  });

  it('returns success and message on happy path', async () => {
    const db = makeDb();
    db.getFirstAsync.mockResolvedValue(null);
    db.runAsync.mockResolvedValue({ lastInsertRowId: 1, changes: 1 });

    const result = await addActivityGroup(db as any, 'NewGroup');
    expect(result.success).toBe(true);
    expect(result.message).toContain('successfully');
  });
});

describe('deleteActivityGroup', () => {
  it('returns not found when group does not exist', async () => {
    const db = makeDb();
    db.getFirstAsync.mockResolvedValue(null);

    const result = await deleteActivityGroup(db as any, 999);
    expect(result.success).toBe(false);
    expect(result.message).toContain('not found');
  });

  it('returns failure when transaction throws', async () => {
    const db = makeDb();
    db.getFirstAsync.mockResolvedValue({ id: 1 });
    // The DELETE inside the write transaction fails → rollback + rethrow.
    db.runAsync.mockRejectedValue(new Error('cascade failed'));

    const result = await deleteActivityGroup(db as any, 1);
    expect(result.success).toBe(false);
  });

  it('relies on ON DELETE CASCADE — only issues a single DELETE on activity_groups', async () => {
    const db = makeDb();
    db.getFirstAsync.mockResolvedValue({ id: 1 });
    db.runAsync.mockResolvedValue({ lastInsertRowId: 1, changes: 1 });

    await deleteActivityGroup(db as any, 1);

    // Only one delete should be issued; CASCADE handles the rest.
    const deleteCalls = db.runAsync.mock.calls.filter((c: any[]) =>
      typeof c[0] === 'string' && c[0].toUpperCase().includes('DELETE FROM')
    );
    expect(deleteCalls.length).toBe(1);
    expect(deleteCalls[0][0]).toContain('activity_groups');
  });
});

describe('checkGroupHasEntries — exists/hasEntries matrix', () => {
  it('case A: group does not exist -> {exists:false, hasEntries:false}', async () => {
    const db = makeDb();
    db.getFirstAsync.mockResolvedValueOnce(null);

    const result = await checkGroupHasEntries(db as any, 999);
    expect(result).toEqual({ exists: false, hasEntries: false });
  });

  it('case B: group exists, no entries -> {exists:true, hasEntries:false}', async () => {
    const db = makeDb();
    db.getFirstAsync
      .mockResolvedValueOnce({ id: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const result = await checkGroupHasEntries(db as any, 1);
    expect(result).toEqual({ exists: true, hasEntries: false });
  });

  it('case C: group exists, has entries -> {exists:true, hasEntries:true}', async () => {
    const db = makeDb();
    db.getFirstAsync
      .mockResolvedValueOnce({ id: 1 })
      .mockResolvedValueOnce({ count: 5 });

    const result = await checkGroupHasEntries(db as any, 1);
    expect(result).toEqual({ exists: true, hasEntries: true });
  });

  it('case D: DB error returns same shape (no throw)', async () => {
    const db = makeDb();
    db.getFirstAsync.mockRejectedValue(new Error('disk gone'));

    const result = await checkGroupHasEntries(db as any, 1);
    expect(result).toEqual({ exists: false, hasEntries: false });
  });

  it('coerces count row of null to hasEntries:false (defensive)', async () => {
    const db = makeDb();
    db.getFirstAsync
      .mockResolvedValueOnce({ id: 1 })
      .mockResolvedValueOnce(null);

    const result = await checkGroupHasEntries(db as any, 1);
    expect(result.exists).toBe(true);
    expect(result.hasEntries).toBe(false);
  });
});
