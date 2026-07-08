/**
 * __tests__/healthMetrics.test.ts
 *
 * CRUD contract for the health_metrics table. Asserts the SQL shape + params
 * against the jest-mock database (the project's DB-test idiom) — the real SQLite
 * runs on-device.
 */
import { createMockDatabase } from 'expo-sqlite';

jest.mock('expo-sqlite');

import {
  upsertHealthMetrics,
  getHealthMetricsRange,
  getLatestHealthMetric,
  clearAllHealthMetrics,
} from '@/databases/health-metrics';

const rowA = {
  date: '2026-07-07',
  sleepTotalMinutes: 480,
  sleepStages: { 5: 60 },
  avgHeartRate: 80,
  minHeartRate: 60,
};
const rowB = {
  date: '2026-07-08',
  sleepTotalMinutes: null,
  sleepStages: {},
  avgHeartRate: null,
  minHeartRate: null,
};

describe('upsertHealthMetrics', () => {
  it('is a no-op for an empty list (no transaction, no writes)', async () => {
    const db = createMockDatabase();
    await upsertHealthMetrics(db as any, [], 'health_connect', '2026-07-08T05:00:00.000Z');
    expect(db.withExclusiveTransactionAsync).not.toHaveBeenCalled();
    expect(db.runAsync).not.toHaveBeenCalled();
  });

  it('writes one upsert per row inside an EXCLUSIVE transaction, keyed by date', async () => {
    const db = createMockDatabase();
    await upsertHealthMetrics(db as any, [rowA, rowB], 'health_connect', '2026-07-08T05:00:00.000Z');

    expect(db.withExclusiveTransactionAsync).toHaveBeenCalledTimes(1);
    expect(db.withTransactionAsync).not.toHaveBeenCalled();
    expect(db.runAsync).toHaveBeenCalledTimes(2);

    const [sql] = db.runAsync.mock.calls[0];
    // Same-day re-sync REPLACES the row — the upsert contract lives in the SQL.
    expect((sql as string)).toContain('INSERT INTO health_metrics');
    expect((sql as string).toUpperCase()).toContain('ON CONFLICT(DATE) DO UPDATE');
  });

  it('serializes stage maps to JSON and passes nulls through unchanged', async () => {
    const db = createMockDatabase();
    await upsertHealthMetrics(db as any, [rowA, rowB], 'health_connect', '2026-07-08T05:00:00.000Z');

    // rowA — stages serialized, real numbers.
    expect(db.runAsync.mock.calls[0][1]).toEqual([
      '2026-07-07',
      480,
      '{"5":60}',
      80,
      60,
      'health_connect',
      '2026-07-08T05:00:00.000Z',
    ]);
    // rowB — empty stages become NULL; missing metrics stay null.
    expect(db.runAsync.mock.calls[1][1]).toEqual([
      '2026-07-08',
      null,
      null,
      null,
      null,
      'health_connect',
      '2026-07-08T05:00:00.000Z',
    ]);
  });
});

describe('getHealthMetricsRange', () => {
  it('range-filters by local-day bounds and parses stored rows', async () => {
    const db = createMockDatabase();
    db.getAllAsync.mockResolvedValue([
      {
        date: '2026-07-07',
        sleep_total_minutes: 480,
        sleep_stages: '{"5":60}',
        avg_heart_rate: 80,
        min_heart_rate: 60,
        source: 'health_connect',
        synced_at: '2026-07-08T05:00:00.000Z',
      },
    ]);

    const result = await getHealthMetricsRange(db as any, '2026-07-01', '2026-07-31');

    const [sql, params] = db.getAllAsync.mock.calls[0];
    expect((sql as string).toUpperCase()).toContain('WHERE DATE BETWEEN ? AND ?');
    expect((sql as string).toUpperCase()).toContain('ORDER BY DATE ASC');
    expect(params).toEqual(['2026-07-01', '2026-07-31']);

    expect(result).toEqual([
      {
        date: '2026-07-07',
        sleepTotalMinutes: 480,
        sleepStages: { 5: 60 },
        avgHeartRate: 80,
        minHeartRate: 60,
        source: 'health_connect',
        syncedAt: '2026-07-08T05:00:00.000Z',
      },
    ]);
  });

  it('decodes corrupt or absent stage JSON to an empty map (never throws)', async () => {
    const db = createMockDatabase();
    db.getAllAsync.mockResolvedValue([
      { date: '2026-07-07', sleep_total_minutes: 400, sleep_stages: 'not-json', avg_heart_rate: null, min_heart_rate: null, source: 's', synced_at: 't' },
      { date: '2026-07-08', sleep_total_minutes: null, sleep_stages: null, avg_heart_rate: 70, min_heart_rate: 55, source: 's', synced_at: 't' },
    ]);

    const result = await getHealthMetricsRange(db as any, '2026-07-01', '2026-07-31');
    expect(result[0].sleepStages).toEqual({});
    expect(result[1].sleepStages).toEqual({});
  });

  it('returns [] on error', async () => {
    const db = createMockDatabase();
    db.getAllAsync.mockRejectedValue(new Error('db gone'));
    await expect(getHealthMetricsRange(db as any, '2026-07-01', '2026-07-31')).resolves.toEqual([]);
  });
});

describe('getLatestHealthMetric', () => {
  it('reads the newest day (ORDER BY date DESC LIMIT 1)', async () => {
    const db = createMockDatabase();
    db.getFirstAsync.mockResolvedValue({
      date: '2026-07-08',
      sleep_total_minutes: 500,
      sleep_stages: null,
      avg_heart_rate: 70,
      min_heart_rate: 55,
      source: 'health_connect',
      synced_at: '2026-07-08T05:00:00.000Z',
    });

    const result = await getLatestHealthMetric(db as any);
    const [sql] = db.getFirstAsync.mock.calls[0];
    expect((sql as string).toUpperCase()).toContain('ORDER BY DATE DESC');
    expect((sql as string).toUpperCase()).toContain('LIMIT 1');
    expect(result?.date).toBe('2026-07-08');
    expect(result?.avgHeartRate).toBe(70);
  });

  it('returns null when the table is empty', async () => {
    const db = createMockDatabase();
    db.getFirstAsync.mockResolvedValue(null);
    await expect(getLatestHealthMetric(db as any)).resolves.toBeNull();
  });
});

describe('clearAllHealthMetrics', () => {
  it('deletes every row', async () => {
    const db = createMockDatabase();
    await clearAllHealthMetrics(db as any);
    const [sql] = db.runAsync.mock.calls[0];
    expect((sql as string).toUpperCase()).toContain('DELETE FROM HEALTH_METRICS');
  });
});
