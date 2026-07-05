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

// Mock the database functions used by migrations.
// migrations.ts now imports these directly from the focused modules.
jest.mock('@/databases/lifecycle', () => ({
  createInitialSchema: jest.fn().mockResolvedValue(undefined),
  seedActivitiesV1: jest.fn().mockResolvedValue({ success: true }),
}));
jest.mock('@/databases/user-settings', () => ({
  initializeSettingsTable: jest.fn().mockResolvedValue(undefined),
}));
// Keep the legacy facade mock too, in case anything still resolves it.
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
    // for each pending migration (v2..vN). Derive the expected count from the
    // array so adding migrations doesn't require touching this number.
    const pragmaCalls = db.runAsync.mock.calls.filter(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('PRAGMA user_version')
    );
    const pendingFromV1 = migrations.filter(m => m.version > 1).length;
    expect(pragmaCalls.length).toBe(pendingFromV1);
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

  it('preserves entry data via copy-into-new-table pattern (no DROP TABLE entries)', async () => {
    const db = createMockDatabase();
    const v2 = migrations.find(m => m.version === 2)!;
    await v2.up(db as any);

    // V2 rebuilds the `activities` table but should NEVER drop `entries`.
    const allSql = db.execAsync.mock.calls
      .map((c: any[]) => (c[0] as string).toUpperCase())
      .join(' ');
    expect(allSql).not.toContain('DROP TABLE ENTRIES');
    expect(allSql).not.toContain('DROP TABLE IF EXISTS ENTRIES');

    // And it should explicitly preserve activity data via SELECT/INSERT.
    expect(allSql).toContain('INSERT INTO ACTIVITIES_NEW');
    expect(allSql).toContain('SELECT ID, NAME, GROUP_ID, POSITION FROM ACTIVITIES');
  });
});

describe('Migration V3', () => {
  it('adds show_mood_benchmarks setting with INSERT OR IGNORE', async () => {
    const db = createMockDatabase();
    const v3 = migrations.find(m => m.version === 3)!;
    expect(v3).toBeDefined();

    await v3.up(db as any);

    const seedCall = db.runAsync.mock.calls.find((c: any[]) =>
      typeof c[0] === 'string' && c[0].includes('show_mood_benchmarks')
    );
    expect(seedCall).toBeDefined();
    expect((seedCall![0] as string).toUpperCase()).toContain('INSERT OR IGNORE');
  });
});

describe('Migration V4', () => {
  it('seeds reminder_enabled and reminder_time with INSERT OR IGNORE', async () => {
    const db = createMockDatabase();
    const v4 = migrations.find(m => m.version === 4)!;
    expect(v4).toBeDefined();

    await v4.up(db as any);

    const sql = db.runAsync.mock.calls
      .map((c: any[]) => (c[0] as string))
      .join(' ');
    expect(sql).toContain('reminder_enabled');
    expect(sql).toContain('reminder_time');
    expect(sql.toUpperCase()).toContain('INSERT OR IGNORE');
  });
});

describe('Migration V5', () => {
  it('rebuilds entry_media without dropping entries, adds created_at + index', async () => {
    const db = createMockDatabase();
    const v5 = migrations.find(m => m.version === 5)!;
    expect(v5).toBeDefined();

    await v5.up(db as any);

    const sql = db.execAsync.mock.calls
      .map((c: any[]) => (c[0] as string).toUpperCase())
      .join(' ');
    // Never touches the entries table.
    expect(sql).not.toContain('DROP TABLE ENTRIES');
    expect(sql).not.toContain('DROP TABLE IF EXISTS ENTRIES');
    // Rebuilds entry_media via the copy-into-new-table pattern.
    expect(sql).toContain('ALTER TABLE ENTRY_MEDIA RENAME TO ENTRY_MEDIA_V1');
    expect(sql).toContain('CREATE TABLE ENTRY_MEDIA');
    expect(sql).toContain('CREATED_AT');
    expect(sql).toContain('IDX_ENTRY_MEDIA_ENTRY_ID');
    expect(sql).toContain('DROP TABLE ENTRY_MEDIA_V1');
  });
});

describe('Migration V6', () => {
  it('renames the vague default Event activity without clobbering custom duplicates', async () => {
    const db = createMockDatabase();
    const v6 = migrations.find(m => m.version === 6)!;
    expect(v6).toBeDefined();

    await v6.up(db as any);

    expect(db.runAsync).toHaveBeenCalledTimes(1);
    const [sql, params] = db.runAsync.mock.calls[0];
    expect((sql as string).toUpperCase()).toContain('UPDATE ACTIVITIES');
    expect(sql as string).toContain('NOT EXISTS');
    expect(params).toEqual(['Social event', 'Event', 3, 'Social event', 3]);
  });
});
