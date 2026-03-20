import { SETTINGS_REGISTRY } from '@/databases/settings';
import { getSetting } from '@/databases/database';
import { createMockDatabase } from 'expo-sqlite';

jest.mock('expo-sqlite');

// Mock the types import chain to avoid native module issues
jest.mock('@/components/types', () => ({
  // Re-export the types as empty - they're just type definitions
}));

// Mock the seedData import used by database.ts
jest.mock('@/components/seedData', () => ({
  initialActivities: [],
  initialActivityGroups: [],
}));

// Mock the migrations import used by database.ts
jest.mock('@/databases/migrations', () => ({
  runMigrations: jest.fn(),
}));

describe('SETTINGS_REGISTRY', () => {
  const registryEntries = Object.entries(SETTINGS_REGISTRY);

  it('every key in registry has a key field matching its object key', () => {
    for (const [objKey, config] of registryEntries) {
      expect(config.key).toBe(objKey);
    }
  });

  it('every entry has a label string', () => {
    for (const [, config] of registryEntries) {
      expect(typeof config.label).toBe('string');
      expect(config.label.length).toBeGreaterThan(0);
    }
  });

  it('every entry has a type that is one of switch, select, or text', () => {
    for (const [, config] of registryEntries) {
      expect(['switch', 'select', 'text']).toContain(config.type);
    }
  });

  it('every entry has a default value', () => {
    for (const [, config] of registryEntries) {
      expect(config.default).toBeDefined();
    }
  });
});

describe('getSetting', () => {
  it('returns stored value when it exists', async () => {
    const db = createMockDatabase();
    db.getFirstAsync.mockResolvedValue({ value: 'left' });

    const result = await getSetting(db as any, 'fab_position');
    expect(result).toBe('left');
  });

  it('returns registry default for theme_mode when key is missing (not hardcoded "right")', async () => {
    const db = createMockDatabase();
    db.getFirstAsync.mockResolvedValue(null);

    const result = await getSetting(db as any, 'theme_mode');
    expect(result).toBe('dark');
    expect(result).not.toBe('right');
  });

  it('returns registry default for mood_precision when key is missing (not hardcoded "right")', async () => {
    const db = createMockDatabase();
    db.getFirstAsync.mockResolvedValue(null);

    const result = await getSetting(db as any, 'mood_precision');
    expect(result).toBe('low');
    expect(result).not.toBe('right');
  });
});
