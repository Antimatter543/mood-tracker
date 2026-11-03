jest.mock('@/components/IconPicker', () => ({ IconFamilyType: {} }));
jest.mock('@/components/types', () => ({}));
jest.mock('@/components/seedData', () => ({
  initialActivities: [],
  initialActivityGroups: [],
}));
jest.mock('@/databases/migrations', () => ({
  runMigrations: jest.fn().mockResolvedValue(undefined),
}));

import {
  initializeDatabase,
  resetDatabase,
  DATABASE_VERSION,
  createInitialSchema,
} from '@/databases/lifecycle';
import { runMigrations } from '@/databases/migrations';
import { makeDb, resetWriteLayer, sqlCalls } from '@/testing/fakeDb';

beforeEach(() => {
  resetWriteLayer();
  (runMigrations as jest.Mock).mockClear();
});

describe('DATABASE_VERSION', () => {
  it('is a positive integer', () => {
    expect(Number.isInteger(DATABASE_VERSION)).toBe(true);
    expect(DATABASE_VERSION).toBeGreaterThan(0);
  });
});

describe('initializeDatabase', () => {
  it('enables foreign keys before running migrations', async () => {
    const db = makeDb();
    await initializeDatabase(db as any);

    const fkCall = sqlCalls(db, /foreign_keys = ON/, db.execAsync)[0];
    expect(fkCall).toBeDefined();
    expect(runMigrations).toHaveBeenCalledTimes(1);
  });

  it('propagates errors from runMigrations', async () => {
    const db = makeDb();
    (runMigrations as jest.Mock).mockRejectedValueOnce(new Error('migration broke'));

    await expect(initializeDatabase(db as any)).rejects.toThrow('migration broke');
  });
});

describe('resetDatabase — PRAGMA outside transaction', () => {
  it('toggles PRAGMA foreign_keys OUTSIDE the transaction', async () => {
    const db = makeDb();

    // Record execAsync order. resetDatabase issues, on the write connection:
    //   FK OFF → BEGIN IMMEDIATE → DROP… → user_version=0 → COMMIT → (migrations) → FK ON
    const calls: string[] = [];
    db.execAsync.mockImplementation((sql: string) => {
      calls.push(String(sql));
      return Promise.resolve();
    });

    await resetDatabase(db as any);

    const idx = (needle: string) =>
      calls.findIndex((sql) => sql.toUpperCase().includes(needle));
    const fkOff = idx('FOREIGN_KEYS = OFF');
    const begin = idx('BEGIN IMMEDIATE');
    const commit = idx('COMMIT');
    const fkOn = idx('FOREIGN_KEYS = ON');

    expect(fkOff).toBeGreaterThanOrEqual(0);
    expect(begin).toBeGreaterThanOrEqual(0);
    expect(commit).toBeGreaterThanOrEqual(0);
    expect(fkOn).toBeGreaterThanOrEqual(0);
    // FK OFF is issued BEFORE the transaction opens and FK ON AFTER it commits —
    // both outside the BEGIN..COMMIT window (a PRAGMA is a no-op inside a txn).
    expect(fkOff).toBeLessThan(begin);
    expect(fkOn).toBeGreaterThan(commit);
  });

  it('re-enables foreign keys even when the transaction throws', async () => {
    const db = makeDb();
    // FK OFF succeeds, then the DROP inside the transaction fails — the finally
    // must still restore FK ON on the write connection.
    db.execAsync.mockImplementation((sql: string) => {
      if (typeof sql === 'string' && sql.includes('DROP TABLE')) {
        return Promise.reject(new Error('boom'));
      }
      return Promise.resolve();
    });

    const result = await resetDatabase(db as any);
    expect(result.success).toBe(false);

    const fkOnCall = sqlCalls(db, /foreign_keys = ON/, db.execAsync)[0];
    expect(fkOnCall).toBeDefined();
  });

  it('resets user_version to 0 inside the transaction', async () => {
    const db = makeDb();
    await resetDatabase(db as any);

    const resetCall = sqlCalls(db, /user_version = 0/, db.execAsync)[0];
    expect(resetCall).toBeDefined();
  });

  it('re-runs migrations after dropping tables', async () => {
    const db = makeDb();
    await resetDatabase(db as any);
    expect(runMigrations).toHaveBeenCalled();
  });
});

describe('createInitialSchema', () => {
  it('creates the expected V1 tables', async () => {
    const db = makeDb();
    await createInitialSchema(db as any);

    const sql = db.execAsync.mock.calls[0][0] as string;
    expect(sql).toContain('activity_groups');
    expect(sql).toContain('activities');
    expect(sql).toContain('entries');
    expect(sql).toContain('entry_activities');
    expect(sql).toContain('entry_media');
  });

  it('creates required indexes', async () => {
    const db = makeDb();
    await createInitialSchema(db as any);

    const sql = db.execAsync.mock.calls[0][0] as string;
    expect(sql).toContain('idx_entries_date');
    expect(sql).toContain('idx_entry_activities_entry_id');
  });
});
