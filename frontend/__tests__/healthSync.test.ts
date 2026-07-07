/**
 * __tests__/healthSync.test.ts
 *
 * The sync orchestrator: window selection → guarded read → REAL per-day
 * aggregation → upsert + last-synced marker. The native read + DB layers are
 * mocked; healthConnectPure (aggregation / window math) runs for real so the
 * day counts are deterministic.
 */
import { createMockDatabase } from 'expo-sqlite';

jest.mock('expo-sqlite');
jest.mock('@/lib/healthConnect', () => ({
  readHealthForRange: jest.fn(),
}));
jest.mock('@/databases/health-metrics', () => ({
  upsertHealthMetrics: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/databases/user-settings', () => ({
  getSetting: jest.fn(),
  updateSetting: jest.fn().mockResolvedValue(undefined),
}));

import { syncHealthMetrics } from '@/lib/healthSync';
import { readHealthForRange } from '@/lib/healthConnect';
import { upsertHealthMetrics } from '@/databases/health-metrics';
import { getSetting, updateSetting } from '@/databases/user-settings';
import {
  HEALTH_CONNECT_SOURCE,
  HEALTH_LAST_SYNCED_SETTING_KEY,
} from '@/lib/healthConnectConfig';

const mockRead = readHealthForRange as jest.Mock;
const mockGetSetting = getSetting as jest.Mock;
const mockUpdateSetting = updateSetting as jest.Mock;
const mockUpsert = upsertHealthMetrics as jest.Mock;

const NOW = new Date('2026-07-08T05:00:00.000Z');
const FULL_START = '2026-06-08T05:00:00.000Z'; // now - 30d
const END = '2026-07-08T05:00:00.000Z';

// Two calendar days of data: a Jul07 night + a Jul08 heart-rate sample.
const READ_PAYLOAD = {
  windowStart: FULL_START,
  windowEnd: END,
  sleepSessions: [
    {
      startTime: '2026-07-06T12:00:00.000Z',
      endTime: '2026-07-06T20:00:00.000Z', // wakes Jul07 (Brisbane)
      durationMinutes: 480,
      stageMinutes: { 5: 60 },
    },
  ],
  heartRateSamples: [{ time: '2026-07-07T20:00:00.000Z', beatsPerMinute: 50 }], // Jul08
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdateSetting.mockResolvedValue(undefined);
  mockUpsert.mockResolvedValue(undefined);
});

describe('syncHealthMetrics', () => {
  it('first sync: reads the full window, writes per-day rows, advances the marker', async () => {
    mockGetSetting.mockResolvedValue(''); // never synced
    mockRead.mockResolvedValue(READ_PAYLOAD);

    const result = await syncHealthMetrics(createMockDatabase() as any, { now: NOW });

    // Read the LAST-synced marker, then read the full lookback window.
    expect(mockGetSetting).toHaveBeenCalledWith(expect.anything(), HEALTH_LAST_SYNCED_SETTING_KEY);
    expect(mockRead).toHaveBeenCalledWith(FULL_START, END);

    // Upsert the aggregated rows (Jul07 + Jul08), tagged with source + end marker.
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const [, rows, source, syncedAt] = mockUpsert.mock.calls[0];
    expect(source).toBe(HEALTH_CONNECT_SOURCE);
    expect(syncedAt).toBe(END);
    expect(rows.map((r: { date: string }) => r.date)).toEqual(['2026-07-07', '2026-07-08']);

    // Advance the last-synced marker to `now`.
    expect(mockUpdateSetting).toHaveBeenCalledWith(expect.anything(), HEALTH_LAST_SYNCED_SETTING_KEY, END);

    expect(result).toEqual({ success: true, daysWritten: 2, syncedAt: END });
  });

  it('incremental sync: reads from the start of the last-synced local day', async () => {
    mockGetSetting.mockResolvedValue('2026-07-07T00:00:00.000Z');
    mockRead.mockResolvedValue({ ...READ_PAYLOAD, sleepSessions: [], heartRateSamples: [] });

    const result = await syncHealthMetrics(createMockDatabase() as any, { now: NOW });

    // Brisbane start-of-local-day for 2026-07-07T00:00Z is 2026-07-06T14:00Z.
    expect(mockRead).toHaveBeenCalledWith('2026-07-06T14:00:00.000Z', END);
    expect(result.success).toBe(true);
    expect(result.daysWritten).toBe(0);
  });

  it('failure: leaves the marker untouched and reports no rows', async () => {
    mockGetSetting.mockResolvedValue('');
    mockRead.mockRejectedValue(new Error('read blew up'));

    const result = await syncHealthMetrics(createMockDatabase() as any, { now: NOW });

    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockUpdateSetting).not.toHaveBeenCalled(); // marker NOT advanced → next sync re-covers the gap
    expect(result).toEqual({ success: false, daysWritten: 0, syncedAt: null });
  });
});
