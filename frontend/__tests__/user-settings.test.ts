import { createMockDatabase } from 'expo-sqlite';

jest.mock('expo-sqlite');
jest.mock('@/components/IconPicker', () => ({ IconFamilyType: {} }));
jest.mock('@/components/types', () => ({}));

import {
  initializeSettingsTable,
  getSetting,
  updateSetting,
} from '@/databases/user-settings';

describe('initializeSettingsTable', () => {
  it('creates the user_settings table', async () => {
    const db = createMockDatabase();
    await initializeSettingsTable(db as any);

    const createSql = db.execAsync.mock.calls[0][0] as string;
    expect(createSql).toContain('CREATE TABLE IF NOT EXISTS user_settings');
    expect(createSql).toContain('key TEXT PRIMARY KEY');
  });

  it('seeds the V1 default settings via INSERT OR IGNORE', async () => {
    const db = createMockDatabase();
    await initializeSettingsTable(db as any);

    const seedSql = db.runAsync.mock.calls[0][0] as string;
    expect(seedSql).toContain('INSERT OR IGNORE');
    expect(seedSql).toContain('fab_position');
    expect(seedSql).toContain('theme_mode');
    expect(seedSql).toContain('mood_precision');
  });
});

describe('updateSetting', () => {
  it('issues an INSERT OR REPLACE upsert', async () => {
    const db = createMockDatabase();
    db.runAsync.mockResolvedValue({ lastInsertRowId: 1, changes: 1 });

    await updateSetting(db as any, 'fab_position', 'left');

    const sql = db.runAsync.mock.calls[0][0] as string;
    expect(sql).toContain('INSERT OR REPLACE');
    expect(db.runAsync.mock.calls[0][1]).toEqual(['fab_position', 'left']);
  });
});

describe('getSetting — additional fallback cases', () => {
  it('returns registry default when key is missing and registry has a boolean default', async () => {
    const db = createMockDatabase();
    db.getFirstAsync.mockResolvedValue(null);

    const result = await getSetting(db as any, 'show_mood_benchmarks');
    // Registry default is `true` (boolean) — gets toString()ed
    expect(result).toBe('true');
  });

  it('returns empty string for keys not in the registry', async () => {
    const db = createMockDatabase();
    db.getFirstAsync.mockResolvedValue(null);

    const result = await getSetting(db as any, 'utterly_unknown_key');
    expect(result).toBe('');
  });
});
