/**
 * Tests for SettingsContext's persistence round-trip.
 *
 * We test the load + update logic at the database layer (which the context
 * thinly wraps) rather than mounting a React provider tree — the SQLite
 * native module can't be exercised in jest, so we go straight at the
 * `getSetting` / `updateSetting` API which is exactly what the context calls.
 */
import { createMockDatabase } from 'expo-sqlite';
import { getSetting, updateSetting } from '@/databases/database';
import { SETTINGS_REGISTRY } from '@/databases/settings';

jest.mock('expo-sqlite');
jest.mock('@/components/types', () => ({}));
jest.mock('@/components/seedData', () => ({
    initialActivities: [],
    initialActivityGroups: [],
}));
jest.mock('@/databases/migrations', () => ({
    runMigrations: jest.fn(),
}));

describe('SettingsContext persistence (via DB layer)', () => {
    it('updateSetting -> getSetting round-trips a value', async () => {
        const db = createMockDatabase();
        // Simulate persistence: getFirstAsync returns the last value we
        // wrote via runAsync. We capture writes in a local map.
        const store: Record<string, string> = {};
        db.runAsync.mockImplementation(async (_sql: string, params: any[]) => {
            const [key, value] = params;
            store[key] = value;
            return { lastInsertRowId: 1, changes: 1 };
        });
        db.getFirstAsync.mockImplementation(async (_sql: string, params: any[]) => {
            const key = params[0];
            return key in store ? { value: store[key] } : null;
        });

        await updateSetting(db as any, 'theme', 'cherry');
        const value = await getSetting(db as any, 'theme');
        expect(value).toBe('cherry');
    });

    it('getSetting returns the registry default when the key has never been written', async () => {
        const db = createMockDatabase();
        db.getFirstAsync.mockResolvedValue(null);

        const value = await getSetting(db as any, 'fab_position');
        expect(value).toBe(SETTINGS_REGISTRY.fab_position.default);
    });

    it('updates a setting twice and reads the latest value', async () => {
        const db = createMockDatabase();
        const store: Record<string, string> = {};
        db.runAsync.mockImplementation(async (_sql: string, params: any[]) => {
            store[params[0]] = params[1];
            return { lastInsertRowId: 1, changes: 1 };
        });
        db.getFirstAsync.mockImplementation(async (_sql: string, params: any[]) => {
            const key = params[0];
            return key in store ? { value: store[key] } : null;
        });

        await updateSetting(db as any, 'theme_mode', 'light');
        await updateSetting(db as any, 'theme_mode', 'dark');
        const value = await getSetting(db as any, 'theme_mode');
        expect(value).toBe('dark');
    });

    it('survives a "remount" — values written before are still there', async () => {
        // This emulates the theme-switch-persists-across-remounts requirement.
        // The DB is the source of truth; SettingsContext just reads from it on
        // mount. So we write, then *re-read* with a fresh getSetting call.
        const db = createMockDatabase();
        const store: Record<string, string> = {};
        db.runAsync.mockImplementation(async (_sql: string, params: any[]) => {
            store[params[0]] = params[1];
            return { lastInsertRowId: 1, changes: 1 };
        });
        db.getFirstAsync.mockImplementation(async (_sql: string, params: any[]) => {
            const key = params[0];
            return key in store ? { value: store[key] } : null;
        });

        await updateSetting(db as any, 'theme', 'midnight');
        // simulate a "remount" — same db handle, fresh call to getSetting
        const value = await getSetting(db as any, 'theme');
        expect(value).toBe('midnight');
    });
});
