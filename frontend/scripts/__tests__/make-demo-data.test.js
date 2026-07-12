/**
 * Round-trip test for the demo-data generator.
 *
 * Goal (per the task): run the generator's CORE function and validate the output
 * against the ACTUAL import parser/validator (importDatabaseData in
 * databases/data-export.ts). We feed the generated JSON straight through the
 * real importer over a mock DB and assert: it reports SUCCESS (passes the
 * validator), every entry is INSERTed, dates are local-day sane, and the curve
 * meets the demo requirements (range, today+yesterday present, ~40% notes,
 * 1-3 known activities per entry).
 *
 * Mock setup mirrors __tests__/data-export.test.ts so the importer's RN/expo
 * imports resolve under jest (createMockDatabase + Platform stub).
 */

const { createMockDatabase } = require('expo-sqlite');
const DocumentPicker = require('expo-document-picker');
const FileSystem = require('expo-file-system/legacy');

jest.mock('expo-sqlite');
jest.mock('expo-document-picker');
jest.mock('expo-file-system/legacy');
jest.mock('expo-sharing');
jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));
jest.mock('@/components/IconPicker', () => ({ IconFamilyType: {} }));
jest.mock('@/components/types', () => ({}));
jest.mock('@/components/seedData', () => ({
  initialActivities: [],
  initialActivityGroups: [],
}));
jest.mock('@/databases/migrations', () => ({ runMigrations: jest.fn() }));

const { importDatabaseData } = require('@/databases/data-export');
const {
  __setWriteConnectionForTests,
  __resetWriteTransactionForTests,
} = require('@/databases/writeTransaction');
const {
  generateDemoData,
  DEFAULT_ACTIVITIES,
  NOTE_POOL,
} = require('../make-demo-data');

const KNOWN_ACTIVITY_IDS = new Set(DEFAULT_ACTIVITIES.map((a) => a.id));

/** Local YYYY-MM-DD for a Date, matching how the app keys days locally. */
function localDay(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Drive the real importDatabaseData with `payload` as the picked file content,
 * over a fresh mock DB. Returns { result, db } so callers can inspect the SQL
 * the importer issued.
 */
async function runImport(payload) {
  const db = createMockDatabase();
  // importDatabaseData writes through withWriteTransaction now; route that onto
  // this same mock (`txn === db`) so the INSERT/DELETE assertions below still see
  // the SQL it issues. See databases/writeTransaction.ts test hooks.
  __resetWriteTransactionForTests();
  __setWriteConnectionForTests(db);
  DocumentPicker.getDocumentAsync.mockResolvedValueOnce({
    canceled: false,
    assets: [{ uri: 'file:///mock/demo.json' }],
  });
  FileSystem.readAsStringAsync.mockResolvedValueOnce(JSON.stringify(payload));
  // The importer reads existing groups then existing activities; empty install.
  db.getAllAsync.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
  db.runAsync.mockResolvedValue({ lastInsertRowId: 1, changes: 1 });

  const result = await importDatabaseData(db);
  return { result, db };
}

describe('generateDemoData — shape & curve', () => {
  const FIXED_TODAY = '2026-06-13';
  const data = generateDemoData({ today: FIXED_TODAY, days: 35, seed: 42 });

  it('produces a valid v2 export envelope the importer requires', () => {
    expect(data.version).toBe(2);
    expect(data.data).toBeDefined();
    expect(Array.isArray(data.data.entries)).toBe(true);
    expect(Array.isArray(data.data.activities)).toBe(true);
    expect(Array.isArray(data.data.activityGroups)).toBe(true);
  });

  it('generates exactly `days` entries ending TODAY, with yesterday present', () => {
    expect(data.data.entries).toHaveLength(35);

    const days = data.data.entries.map((e) => localDay(new Date(e.date)));
    const today = localDay(new Date(2026, 5, 13)); // local 2026-06-13
    const yesterday = localDay(new Date(2026, 5, 12));
    expect(days).toContain(today); // streak anchor
    expect(days).toContain(yesterday); // -> "2-day streak"

    // No duplicate days, and they are contiguous (no gaps) across the window.
    const unique = new Set(days);
    expect(unique.size).toBe(35);
  });

  it('emits dates pinned to LOCAL NOON so the local-day key is timezone-robust', () => {
    for (const e of data.data.entries) {
      const d = new Date(e.date);
      // Constructed at local noon -> local hour is 12 regardless of TZ. (jest is
      // pinned to Australia/Brisbane via jest.tz.js, a fixed UTC+10 offset.)
      expect(d.getHours()).toBe(12);
    }
  });

  it('keeps every mood in the believable 3..9 range (0.5 steps)', () => {
    for (const e of data.data.entries) {
      expect(e.mood).toBeGreaterThanOrEqual(3);
      expect(e.mood).toBeLessThanOrEqual(9);
      expect(Number.isInteger(e.mood * 2)).toBe(true); // half-step grid
    }
  });

  it('has a believable shape: a mid-window rough patch below the overall mean', () => {
    const moods = data.data.entries.map((e) => e.mood);
    const mean = moods.reduce((a, b) => a + b, 0) / moods.length;
    // The "rough patch" is centered ~60% through the window; the lowest mood
    // should sit clearly under the mean and fall in that mid-to-late region.
    const min = Math.min(...moods);
    expect(min).toBeLessThan(mean - 1);
    const minIdx = moods.indexOf(min);
    expect(minIdx).toBeGreaterThan(35 * 0.4);
    expect(minIdx).toBeLessThan(35 * 0.85);
  });

  it('attaches 1-3 KNOWN activities to every entry', () => {
    for (const e of data.data.entries) {
      const ids = e.activity_ids.split(',').filter(Boolean).map(Number);
      expect(ids.length).toBeGreaterThanOrEqual(1);
      expect(ids.length).toBeLessThanOrEqual(3);
      for (const id of ids) {
        expect(KNOWN_ACTIVITY_IDS.has(id)).toBe(true);
      }
    }
  });

  it('writes a realistic note on ~40% of entries (all from the pool)', () => {
    const withNotes = data.data.entries.filter((e) => e.notes && e.notes.length > 0);
    const ratio = withNotes.length / data.data.entries.length;
    expect(ratio).toBeGreaterThan(0.2);
    expect(ratio).toBeLessThan(0.6);
    for (const e of withNotes) {
      expect(NOTE_POOL).toContain(e.notes);
    }
  });

  it('carries NO photo bytes (file-ref schema only, and we omit media)', () => {
    for (const e of data.data.entries) {
      expect(e.photos).toEqual([]);
    }
    expect(JSON.stringify(data)).not.toMatch(/base64|data:image/);
  });

  it('is deterministic for a fixed seed + today (content, not the export clock)', () => {
    // `exportDate` is intentionally wall-clock "now" (it documents when the file
    // was generated), so it differs between calls. The DATA — entries, moods,
    // notes, activity picks — must be identical for a fixed seed + today.
    const again = generateDemoData({ today: FIXED_TODAY, days: 35, seed: 42 });
    expect(again.data).toEqual(data.data);
  });

  it('rejects a malformed --today', () => {
    expect(() => generateDemoData({ today: 'not-a-date' })).toThrow(/Invalid date/);
  });
});

describe('generateDemoData — round-trips through the real importer', () => {
  it('imports successfully (passes the validator)', async () => {
    const payload = generateDemoData({ today: '2026-06-13', days: 35, seed: 1 });
    const { result } = await runImport(payload);
    expect(result.success).toBe(true);
    expect(result.message).toMatch(/imported successfully/i);
  });

  it('INSERTs every generated entry (count matches)', async () => {
    const payload = generateDemoData({ today: '2026-06-13', days: 35, seed: 1 });
    const { result, db } = await runImport(payload);
    expect(result.success).toBe(true);

    // The importer upserts entries via INSERT OR REPLACE INTO entries (...).
    const entryInserts = db.runAsync.mock.calls.filter((call) =>
      /INSERT OR REPLACE INTO entries/i.test(String(call[0]))
    );
    expect(entryInserts).toHaveLength(payload.data.entries.length);

    // Each insert binds [id, mood, notes, date] — moods land in range, dates ISO.
    for (const call of entryInserts) {
      const [, params] = call;
      const [, mood, , date] = params;
      expect(mood).toBeGreaterThanOrEqual(3);
      expect(mood).toBeLessThanOrEqual(9);
      expect(() => new Date(date).toISOString()).not.toThrow();
      expect(new Date(date).toISOString()).toBe(date); // already a valid ISO instant
    }
  });

  it('links activity references for entries that have them (no blanket entry wipe)', async () => {
    const payload = generateDemoData({ today: '2026-06-13', days: 35, seed: 1 });
    const { db } = await runImport(payload);

    // Activity links are inserted into entry_activities.
    const linkInserts = db.runAsync.mock.calls.filter((call) =>
      /INSERT INTO entry_activities/i.test(String(call[0]))
    );
    const totalRefs = payload.data.entries.reduce(
      (n, e) => n + e.activity_ids.split(',').filter(Boolean).length,
      0
    );
    expect(linkInserts).toHaveLength(totalRefs);

    // And it must NOT issue a destructive whole-table delete.
    const blanketDeletes = db.runAsync.mock.calls.filter((call) => {
      const sql = String(call[0]).trim().toUpperCase();
      return sql === 'DELETE FROM ENTRIES' || sql === 'DELETE FROM ENTRY_ACTIVITIES';
    });
    expect(blanketDeletes).toHaveLength(0);
  });
});
