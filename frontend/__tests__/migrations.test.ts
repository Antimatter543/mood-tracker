import { migrations, runMigrations } from '@/databases/migrations';
import { createMockDatabase } from 'expo-sqlite';

jest.mock('expo-sqlite');

// Mock IconPicker
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

// Mock the database functions used by migrations
jest.mock('@/databases/database', () => ({
  createInitialSchema: jest.fn().mockResolvedValue(undefined),
  initializeSettingsTable: jest.fn().mockResolvedValue(undefined),
  seedActivitiesV1: jest.fn().mockResolvedValue({ success: true }),
}));

describe('migrations array', () => {
  it('has versions starting from 1', () => {
    expect(migrations[0].version).toBe(1);
  });

  it('has sequential version numbers with no gaps', () => {
    for (let i = 0; i < migrations.length; i++) {
      expect(migrations[i].version).toBe(i + 1);
    }
  });

  it('every migration has an up function', () => {
    for (const migration of migrations) {
      expect(typeof migration.up).toBe('function');
    }
  });
});

describe('runMigrations', () => {
  it('skips when database is up-to-date', async () => {
    const db = createMockDatabase();
    const latestVersion = migrations[migrations.length - 1].version;
    db.getFirstAsync.mockResolvedValue({ user_version: latestVersion });

    await runMigrations(db as any);

    // Should not have started a transaction since nothing to do
    expect(db.withTransactionAsync).not.toHaveBeenCalled();
  });

  it('runs only pending migrations', async () => {
    const db = createMockDatabase();
    // Pretend we're at version 1, so only v2 and v3 should run
    db.getFirstAsync.mockResolvedValue({ user_version: 1 });

    await runMigrations(db as any);

    expect(db.withTransactionAsync).toHaveBeenCalled();
    // Inside the transaction, runAsync should be called to set PRAGMA user_version
    // for each pending migration (v2 and v3)
    const pragmaCalls = db.runAsync.mock.calls.filter(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('PRAGMA user_version')
    );
    expect(pragmaCalls.length).toBe(2);
  });

  it('updates pragma user_version after each migration', async () => {
    const db = createMockDatabase();
    db.getFirstAsync.mockResolvedValue({ user_version: 0 });

    await runMigrations(db as any);

    const pragmaCalls = db.runAsync.mock.calls.filter(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('PRAGMA user_version')
    );
    expect(pragmaCalls.length).toBe(migrations.length);
    // Verify version numbers are correct
    for (let i = 0; i < migrations.length; i++) {
      expect(pragmaCalls[i][0]).toContain(`${migrations[i].version}`);
    }
  });

  it('wraps in transaction', async () => {
    const db = createMockDatabase();
    db.getFirstAsync.mockResolvedValue({ user_version: 0 });

    await runMigrations(db as any);

    expect(db.withTransactionAsync).toHaveBeenCalledTimes(1);
  });
});

describe('Migration V2 SQL', () => {
  it('does NOT contain DROP COLUMN (unsupported in older SQLite)', async () => {
    const db = createMockDatabase();

    // Run V2's up function
    const v2 = migrations.find(m => m.version === 2);
    expect(v2).toBeDefined();

    await v2!.up(db as any);

    // Check all execAsync calls for DROP COLUMN
    for (const call of db.execAsync.mock.calls) {
      const sql = call[0] as string;
      expect(sql.toUpperCase()).not.toContain('DROP COLUMN');
    }
  });
});
