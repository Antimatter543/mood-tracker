import { createMockDatabase } from 'expo-sqlite';
import {
  __setWriteConnectionForTests,
  __resetWriteTransactionForTests,
} from '@/databases/writeTransaction';

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

// Create a mock DB and route the write transaction onto it, so writes issued via
// withWriteTransaction (databases/writeTransaction.ts) land on THIS mock —
// `txn === db` — and the assertions below (which inspect db.runAsync etc.) see
// them. Reads still run on the same mock. See writeTransaction's test hooks.
const makeDb = () => {
  const db = createMockDatabase();
  __setWriteConnectionForTests(db as any);
  return db;
};

beforeEach(() => {
  __resetWriteTransactionForTests();
});

describe('addMoodEntry — additional validation', () => {
  it('uses provided date when supplied', async () => {
    const db = makeDb();
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
    const db = makeDb();
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

  it('returns failure when the write transaction throws', async () => {
    const db = makeDb();
    db.getAllAsync.mockResolvedValue([]);
    // A failed INSERT inside the transaction → withWriteTransaction ROLLBACKs
    // and rethrows → addMoodEntry returns a failure result.
    db.runAsync.mockRejectedValue(new Error('disk full'));

    const result = await addMoodEntry(db as any, 5, [1], 'note');
    expect(result.success).toBe(false);
    expect(result.message).toContain('Error');
  });

  // Regression for the "Home cards vanish after adding a mood, fixed only by a
  // restart" bug AND the deeper "the transactions were fake" incident: the write
  // must run in a REAL transaction (BEGIN IMMEDIATE on the write connection),
  // NEVER expo's withExclusiveTransactionAsync/withTransactionAsync (whose
  // statements this codebase ran outside any transaction — see
  // databases/writeTransaction.ts). The class-level guard lives in
  // writeTransactionInvariant.test.ts; this pins the most important call site.
  it('runs the insert in a real write transaction (BEGIN IMMEDIATE), not expo txn APIs', async () => {
    const db = makeDb();
    db.getAllAsync.mockResolvedValue([]);
    db.runAsync.mockResolvedValue({ lastInsertRowId: 1, changes: 1 });

    await addMoodEntry(db as any, 5, [1, 2], 'note');

    const beganImmediate = db.execAsync.mock.calls.some(
      (c: any[]) => typeof c[0] === 'string' && c[0].toUpperCase().includes('BEGIN IMMEDIATE')
    );
    expect(beganImmediate).toBe(true);
    expect(db.withExclusiveTransactionAsync).not.toHaveBeenCalled();
    expect(db.withTransactionAsync).not.toHaveBeenCalled();
  });

  it('inserts a link row for every valid activity', async () => {
    const db = makeDb();
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
    const db = makeDb();
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
    const db = makeDb();
    db.getAllAsync.mockResolvedValue([]);
    db.runAsync.mockResolvedValue({ lastInsertRowId: 1, changes: 1 });

    const result = await addMoodEntry(db as any, 0, [], 'edge');
    expect(result.success).toBe(true);
  });

  it('mood exactly 10 is accepted', async () => {
    const db = makeDb();
    db.getAllAsync.mockResolvedValue([]);
    db.runAsync.mockResolvedValue({ lastInsertRowId: 1, changes: 1 });

    const result = await addMoodEntry(db as any, 10, [], 'edge');
    expect(result.success).toBe(true);
  });

  it('runs activity-id validation INSIDE the transaction (after BEGIN, not before)', async () => {
    // Fail BEGIN IMMEDIATE so the transaction body never runs. If
    // filterValidActivityIds ran OUTSIDE/BEFORE the transaction its getAllAsync
    // would still fire; because it runs on `txn` INSIDE, a failed BEGIN means it
    // is never reached.
    const db = makeDb();
    db.execAsync.mockRejectedValue(new Error('cannot begin'));

    await addMoodEntry(db as any, 5, [1, 2], 'note');
    expect(db.getAllAsync).not.toHaveBeenCalled();
  });
});

describe('filterValidActivityIds', () => {
  it('returns empty array for empty input', async () => {
    const db = makeDb();
    const result = await filterValidActivityIds(db as any, []);
    expect(result).toEqual([]);
    expect(db.getAllAsync).not.toHaveBeenCalled();
  });

  it('filters out non-integer values defensively', async () => {
    const db = makeDb();
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
    const db = makeDb();
    const result = await filterValidActivityIds(db as any, [
      'a' as any,
      NaN,
      Infinity,
    ]);
    expect(result).toEqual([]);
    expect(db.getAllAsync).not.toHaveBeenCalled();
  });

  it('returns empty array on DB error', async () => {
    const db = makeDb();
    db.getAllAsync.mockRejectedValue(new Error('db gone'));

    const result = await filterValidActivityIds(db as any, [1, 2]);
    expect(result).toEqual([]);
  });
});

describe('getMoodEntries — additional', () => {
  it('hydrates each entry with its activities', async () => {
    const db = makeDb();
    // Default any unspecified getAllAsync (e.g. the per-entry photo fetch) to
    // an empty array so the activity-fetch ordering below is unaffected.
    db.getAllAsync.mockResolvedValue([]);
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

    // The READ path must NOT open any transaction — the SELECT + per-entry
    // sub-reads run as plain awaited queries directly on the connection.
    expect(db.withTransactionAsync).not.toHaveBeenCalled();
    expect(db.withExclusiveTransactionAsync).not.toHaveBeenCalled();
    // The reads went straight through getAllAsync.
    expect(db.getAllAsync).toHaveBeenCalled();
  });

  it('reads without any transaction wrapper on the empty-DB path too', async () => {
    const db = makeDb();
    db.getAllAsync.mockResolvedValue([]); // no entries

    const result = await getMoodEntries(db as any);
    expect(result).toEqual([]);
    expect(db.withTransactionAsync).not.toHaveBeenCalled();
    expect(db.withExclusiveTransactionAsync).not.toHaveBeenCalled();
  });
});

describe('addMoodEntry — photos', () => {
  it('copies each photo and inserts an entry_media row per photo', async () => {
    // copyToMediaDir hits expo-file-system; mock it so no real IO happens.
    // resetModules gives us a FRESH entries + writeTransaction module graph, so
    // we must re-inject the write connection on that fresh writeTransaction.
    jest.resetModules();
    jest.doMock('@/databases/mediaHelpers', () => ({
      MEDIA_DIR: 'file:///media/',
      copyToMediaDir: jest
        .fn()
        .mockImplementation(async (uri: string) => `/mock/media/${uri.split('/').pop()}`),
      deleteMediaFile: jest.fn(),
    }));
    const { addMoodEntry: addWithMockedMedia } = require('@/databases/entries');
    const freshWriteTxn = require('@/databases/writeTransaction');

    const db = createMockDatabase();
    db.getAllAsync.mockResolvedValue([]);
    db.runAsync.mockResolvedValue({ lastInsertRowId: 99, changes: 1 });
    freshWriteTxn.__setWriteConnectionForTests(db);

    await addWithMockedMedia(
      db as any,
      6,
      [],
      'with photos',
      undefined,
      ['file:///cache/a.jpg', 'file:///cache/b.png']
    );

    const mediaInserts = db.runAsync.mock.calls.filter((c: any[]) =>
      typeof c[0] === 'string' && c[0].includes('INSERT INTO entry_media')
    );
    expect(mediaInserts.length).toBe(2);
    for (const call of mediaInserts) {
      expect(call[1][0]).toBe(99); // entry_id = lastInsertRowId
    }

    freshWriteTxn.__resetWriteTransactionForTests();
    jest.dontMock('@/databases/mediaHelpers');
    jest.resetModules();
  });

  it('inserts no media rows when no photos are supplied', async () => {
    const db = makeDb();
    db.getAllAsync.mockResolvedValue([]);
    db.runAsync.mockResolvedValue({ lastInsertRowId: 1, changes: 1 });

    await addMoodEntry(db as any, 5, [], 'no photos');

    const mediaInserts = db.runAsync.mock.calls.filter((c: any[]) =>
      typeof c[0] === 'string' && c[0].includes('INSERT INTO entry_media')
    );
    expect(mediaInserts.length).toBe(0);
  });
});
