import { createMockDatabase } from 'expo-sqlite';

jest.mock('expo-sqlite');
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

beforeEach(() => {
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
    const db = createMockDatabase();
    await initializeDatabase(db as any);

    const fkCall = db.execAsync.mock.calls.find((c: any[]) =>
      typeof c[0] === 'string' && c[0].includes('foreign_keys = ON')
    );
    expect(fkCall).toBeDefined();
    expect(runMigrations).toHaveBeenCalledTimes(1);
  });

  it('propagates errors from runMigrations', async () => {
    const db = createMockDatabase();
    (runMigrations as jest.Mock).mockRejectedValueOnce(new Error('migration broke'));

    await expect(initializeDatabase(db as any)).rejects.toThrow('migration broke');
  });
});

describe('resetDatabase — PRAGMA outside transaction', () => {
  it('toggles PRAGMA foreign_keys OUTSIDE the transaction', async () => {
    const db = createMockDatabase();

    // Track call order: every execAsync call gets timestamped via a counter
    let counter = 0;
    const calls: { sql: string; order: number; insideTxn: boolean }[] = [];
    let insideTxn = false;

    db.execAsync.mockImplementation((sql: string) => {
      calls.push({ sql, order: counter++, insideTxn });
      return Promise.resolve();
    });
    db.withExclusiveTransactionAsync.mockImplementation(async (cb: any) => {
      insideTxn = true;
      try {
        await cb();
      } finally {
        insideTxn = false;
      }
    });

    await resetDatabase(db as any);

    const fkOffCall = calls.find((c) => c.sql.includes('foreign_keys = OFF'));
    const fkOnCall = calls.find((c) => c.sql.includes('foreign_keys = ON'));

    expect(fkOffCall).toBeDefined();
    expect(fkOnCall).toBeDefined();
    // Both PRAGMA toggles must NOT be inside the txn — SQLite silently
    // ignores them inside a transaction.
    expect(fkOffCall!.insideTxn).toBe(false);
    expect(fkOnCall!.insideTxn).toBe(false);
  });

  it('re-enables foreign keys even when the transaction throws', async () => {
    const db = createMockDatabase();
    db.withExclusiveTransactionAsync.mockRejectedValue(new Error('boom'));

    const result = await resetDatabase(db as any);
    expect(result.success).toBe(false);

    // Even though the txn threw, we should have called PRAGMA foreign_keys = ON
    // in the finally block.
    const fkOnCall = db.execAsync.mock.calls.find((c: any[]) =>
      typeof c[0] === 'string' && c[0].includes('foreign_keys = ON')
    );
    expect(fkOnCall).toBeDefined();
  });

  it('resets user_version to 0 inside the transaction', async () => {
    const db = createMockDatabase();
    await resetDatabase(db as any);

    const resetCall = db.execAsync.mock.calls.find((c: any[]) =>
      typeof c[0] === 'string' && c[0].includes('user_version = 0')
    );
    expect(resetCall).toBeDefined();
  });

  it('re-runs migrations after dropping tables', async () => {
    const db = createMockDatabase();
    await resetDatabase(db as any);
    expect(runMigrations).toHaveBeenCalled();
  });
});

describe('createInitialSchema', () => {
  it('creates the expected V1 tables', async () => {
    const db = createMockDatabase();
    await createInitialSchema(db as any);

    const sql = db.execAsync.mock.calls[0][0] as string;
    expect(sql).toContain('activity_groups');
    expect(sql).toContain('activities');
    expect(sql).toContain('entries');
    expect(sql).toContain('entry_activities');
    expect(sql).toContain('entry_media');
  });

  it('creates required indexes', async () => {
    const db = createMockDatabase();
    await createInitialSchema(db as any);

    const sql = db.execAsync.mock.calls[0][0] as string;
    expect(sql).toContain('idx_entries_date');
    expect(sql).toContain('idx_entry_activities_entry_id');
  });
});
