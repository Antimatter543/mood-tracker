/**
 * The EXPO_PUBLIC_HEALTH_CONNECT=0 (emergency rollback) build for the two paths
 * day health added: the daily sync and the Timeline's day health. With the knob
 * off, neither may read a setting, the health table or Health Connect, and the
 * Timeline rows carry no health. (The knob-to-flag wiring itself is proven in
 * healthConnectConfig.test.ts; here the gate is forced off at file scope, as in
 * healthConnectSectionDisabled.test.tsx.)
 */
import { Platform } from 'react-native';
import { renderHook, waitFor } from '@testing-library/react-native';

Platform.OS = 'android';

jest.mock('@/lib/healthConnectConfig', () => {
  const actual = jest.requireActual('@/lib/healthConnectConfig');
  return {
    ...actual,
    HEALTH_CONNECT_ENABLED: false,
    shouldShowHealthConnect: (os: string) => actual.shouldShowHealthConnect(os, false),
  };
});
const mockGetSetting = jest.fn(async () => 'true');
jest.mock('@/databases/user-settings', () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...(args as [])),
}));
const mockHasReadPermission = jest.fn(async () => true);
jest.mock('@/lib/healthConnect', () => ({
  hasReadPermission: () => mockHasReadPermission(),
}));
const mockSync = jest.fn(async () => ({ success: true, daysWritten: 1, syncedAt: 'x' }));
jest.mock('@/lib/healthSync', () => ({
  syncHealthMetrics: () => mockSync(),
}));
const mockRange = jest.fn(async () => [
  { date: '2026-09-27', sleepTotalMinutes: 420, restingHeartRate: 60, avgHeartRate: 70, minHeartRate: 55, avgHrvMillis: 40 },
]);
jest.mock('@/databases/health-metrics', () => ({
  getHealthMetricsRange: (...args: unknown[]) => mockRange(...(args as [])),
}));
jest.mock('@/hooks/useDataRefresh', () => ({
  useDataRefresh: (load: () => void) => {
    const { useEffect } = jest.requireActual('react');
    useEffect(() => load(), [load]);
  },
}));

import { runDailyHealthSyncIfDue } from '@/lib/healthDailySync';
import { useTimelineHealth } from '@/components/timeline/useTimelineHealth';
import { buildTimelineRows } from '@/components/timeline/timelineRows';
import { localIso, makeEntry } from '@/testing/builders';
import { freezeNow } from '@/testing/clock';

const db = {} as any;

beforeEach(() => {
  freezeNow(new Date(localIso('2026-09-28', 9)));
  jest.clearAllMocks();
});

it('the daily sync reads nothing and syncs nothing', async () => {
  await expect(runDailyHealthSyncIfDue(db)).resolves.toBe(false);
  expect(mockGetSetting).not.toHaveBeenCalled();
  expect(mockHasReadPermission).not.toHaveBeenCalled();
  expect(mockSync).not.toHaveBeenCalled();
});

it('the Timeline gets no health and never reads the health table', async () => {
  const entries = [makeEntry({ id: 2, date: localIso('2026-09-27', 18), mood: 7 }), makeEntry({ id: 1, date: localIso('2026-09-26', 9), mood: 5 })];
  const { result } = await renderHook(() => useTimelineHealth(db, entries));
  await waitFor(() => expect(result.current).toBeUndefined());
  expect(mockRange).not.toHaveBeenCalled();
  const rows = buildTimelineRows(entries, false, result.current);
  expect(rows.some((r: any) => r.health)).toBe(false);
});
