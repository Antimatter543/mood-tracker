/**
 * __tests__/healthSync.test.ts
 *
 * The sync orchestrator: window resolution (backfill vs incremental) → guarded,
 * possibly-CHUNKED read → REAL per-day aggregation → per-chunk upsert + last-synced
 * marker. The native read + DB layers are mocked; healthConnectPure (window +
 * aggregation math) runs for real so the day counts + chunking are deterministic.
 */
import { createMockDatabase } from 'expo-sqlite';

jest.mock('expo-sqlite');
jest.mock('@/lib/healthConnect', () => ({
  readHealthForRange: jest.fn(),
}));
jest.mock('@/databases/health-metrics', () => ({
  upsertHealthMetrics: jest.fn().mockResolvedValue(undefined),
  getEarliestHealthMetricDate: jest.fn(),
}));
jest.mock('@/databases/entries', () => ({
  getEarliestEntryInstant: jest.fn(),
}));
jest.mock('@/databases/user-settings', () => ({
  getSetting: jest.fn(),
  updateSetting: jest.fn().mockResolvedValue(undefined),
}));

import { syncHealthMetrics } from '@/lib/healthSync';
import { readHealthForRange } from '@/lib/healthConnect';
import {
  upsertHealthMetrics,
  getEarliestHealthMetricDate,
} from '@/databases/health-metrics';
import { getEarliestEntryInstant } from '@/databases/entries';
import { getSetting, updateSetting } from '@/databases/user-settings';
import {
  HEALTH_CONNECT_SOURCE,
  HEALTH_LAST_SYNCED_SETTING_KEY,
} from '@/lib/healthConnectConfig';

const mockRead = readHealthForRange as jest.Mock;
const mockGetSetting = getSetting as jest.Mock;
const mockUpdateSetting = updateSetting as jest.Mock;
const mockUpsert = upsertHealthMetrics as jest.Mock;
const mockEarliestMood = getEarliestEntryInstant as jest.Mock;
const mockEarliestStored = getEarliestHealthMetricDate as jest.Mock;

const NOW = new Date('2026-07-08T05:00:00.000Z');
const FULL_START = '2026-06-08T05:00:00.000Z'; // now − 30d (initial window fallback)
const END = '2026-07-08T05:00:00.000Z';

const emptyPayload = (windowStart = '', windowEnd = '') => ({
  windowStart,
  windowEnd,
  sleepSessions: [],
  heartRateSamples: [],
  hrvSamples: [],
});

// Two calendar days: a Jul07 night + a Jul08 heart-rate sample + a Jul07 HRV.
const TWO_DAY_PAYLOAD = {
  ...emptyPayload(),
  sleepSessions: [
    {
      startTime: '2026-07-06T12:00:00.000Z',
      endTime: '2026-07-06T20:00:00.000Z', // wakes Jul07 (Brisbane)
      durationMinutes: 480,
      stageMinutes: { 5: 60 },
    },
  ],
  heartRateSamples: [{ time: '2026-07-07T20:00:00.000Z', beatsPerMinute: 50 }], // Jul08
  hrvSamples: [{ time: '2026-07-07T02:00:00.000Z', hrvMillis: 45 }], // Jul07
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdateSetting.mockResolvedValue(undefined);
  mockUpsert.mockResolvedValue(undefined);
});

describe('syncHealthMetrics — first sync (empty DB, no mood, nothing stored)', () => {
  it('backfills the 30-day initial window in one chunk, writes rows, advances the marker', async () => {
    mockGetSetting.mockResolvedValue(''); // never synced
    mockEarliestMood.mockResolvedValue(null); // no mood history
    mockEarliestStored.mockResolvedValue(null); // nothing stored
    mockRead.mockResolvedValue(TWO_DAY_PAYLOAD);

    const result = await syncHealthMetrics(createMockDatabase() as any, { now: NOW });

    // Reads the marker + earliest mood + earliest stored to resolve the window.
    expect(mockGetSetting).toHaveBeenCalledWith(expect.anything(), HEALTH_LAST_SYNCED_SETTING_KEY);
    expect(mockEarliestMood).toHaveBeenCalledTimes(1);
    expect(mockEarliestStored).toHaveBeenCalledTimes(1);

    // No mood anchor → the 30-day initial window, which is a single chunk.
    expect(mockRead).toHaveBeenCalledTimes(1);
    expect(mockRead).toHaveBeenCalledWith(FULL_START, END);

    // Aggregated rows (Jul07 + Jul08) upserted with source + end marker.
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const [, rows, source, syncedAt] = mockUpsert.mock.calls[0];
    expect(source).toBe(HEALTH_CONNECT_SOURCE);
    expect(syncedAt).toBe(END);
    expect(rows.map((r: { date: string }) => r.date)).toEqual(['2026-07-07', '2026-07-08']);
    // HRV flowed through aggregation onto Jul07.
    const jul07 = rows.find((r: { date: string }) => r.date === '2026-07-07');
    expect(jul07.avgHrvMillis).toBe(45);

    expect(mockUpdateSetting).toHaveBeenCalledWith(expect.anything(), HEALTH_LAST_SYNCED_SETTING_KEY, END);
    expect(result).toEqual({ success: true, daysWritten: 2, syncedAt: END });
  });
});

describe('syncHealthMetrics — historical backfill (mood history spans months)', () => {
  it('reads CHUNKED (multiple ≤30-day windows), upserts per chunk, advances the marker once', async () => {
    mockGetSetting.mockResolvedValue(''); // never synced
    // ~92 days of mood history → backfill reaches back that far.
    mockEarliestMood.mockResolvedValue('2026-04-08T05:00:00.000Z');
    mockEarliestStored.mockResolvedValue(null); // nothing stored → backfill
    // Each chunk returns one Jul07 night (aggregates to 1 row/chunk).
    mockRead.mockResolvedValue({
      ...emptyPayload(),
      sleepSessions: [
        {
          startTime: '2026-07-06T12:00:00.000Z',
          endTime: '2026-07-06T20:00:00.000Z',
          durationMinutes: 480,
          stageMinutes: {},
        },
      ],
    });

    const result = await syncHealthMetrics(createMockDatabase() as any, { now: NOW });

    // Chunked: >1 read, and one upsert PER read (per-chunk upsert bounds memory).
    expect(mockRead.mock.calls.length).toBeGreaterThan(1);
    expect(mockUpsert.mock.calls.length).toBe(mockRead.mock.calls.length);

    // Contiguous windows covering the backfill (each read's end = next read's start).
    const calls = mockRead.mock.calls as [string, string][];
    for (let i = 1; i < calls.length; i++) {
      expect(calls[i][0]).toBe(calls[i - 1][1]);
    }
    // First read starts at the earliest mood LOCAL day; last read ends at now.
    expect(calls[0][0]).toBe('2026-04-07T14:00:00.000Z'); // Brisbane start-of-day
    expect(calls[calls.length - 1][1]).toBe(END);

    // daysWritten = 1 row/chunk × chunk count; marker advanced exactly once.
    expect(result.success).toBe(true);
    expect(result.daysWritten).toBe(calls.length);
    expect(mockUpdateSetting).toHaveBeenCalledTimes(1);
    expect(mockUpdateSetting).toHaveBeenCalledWith(expect.anything(), HEALTH_LAST_SYNCED_SETTING_KEY, END);
  });
});

describe('syncHealthMetrics — steady-state incremental', () => {
  it('reads a single window from the last-synced local day (no chunking)', async () => {
    mockGetSetting.mockResolvedValue('2026-07-07T00:00:00.000Z');
    mockEarliestMood.mockResolvedValue('2026-06-01T00:00:00.000Z');
    // Stored coverage already reaches the earliest mood day → incremental.
    mockEarliestStored.mockResolvedValue('2026-05-31');
    mockRead.mockResolvedValue(emptyPayload());

    const result = await syncHealthMetrics(createMockDatabase() as any, { now: NOW });

    // ONE read; Brisbane start-of-local-day for 2026-07-07T00:00Z is 2026-07-06T14:00Z.
    expect(mockRead).toHaveBeenCalledTimes(1);
    expect(mockRead).toHaveBeenCalledWith('2026-07-06T14:00:00.000Z', END);
    expect(result.success).toBe(true);
    expect(result.daysWritten).toBe(0);
    expect(mockUpdateSetting).toHaveBeenCalledWith(expect.anything(), HEALTH_LAST_SYNCED_SETTING_KEY, END);
  });
});

describe('syncHealthMetrics — failure', () => {
  it('leaves the marker untouched and reports no rows when a read throws', async () => {
    mockGetSetting.mockResolvedValue('');
    mockEarliestMood.mockResolvedValue(null);
    mockEarliestStored.mockResolvedValue(null);
    mockRead.mockRejectedValue(new Error('read blew up'));

    const result = await syncHealthMetrics(createMockDatabase() as any, { now: NOW });

    expect(mockUpdateSetting).not.toHaveBeenCalled(); // marker NOT advanced → next sync re-covers the gap
    expect(result).toEqual({ success: false, daysWritten: 0, syncedAt: null });
  });

  it('reports failure when reading the earliest mood entry throws', async () => {
    mockGetSetting.mockResolvedValue('');
    mockEarliestMood.mockRejectedValue(new Error('db gone'));
    mockEarliestStored.mockResolvedValue(null);

    const result = await syncHealthMetrics(createMockDatabase() as any, { now: NOW });

    expect(mockRead).not.toHaveBeenCalled();
    expect(mockUpdateSetting).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
  });
});
