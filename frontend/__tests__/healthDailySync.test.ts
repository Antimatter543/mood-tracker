/**
 * Optional daily Health Connect sync (lib/healthDailySync.ts): runs once per
 * local day, only when the user turned it on and is connected.
 */
import { Platform } from 'react-native';

const mockSettings: Record<string, string> = {};
jest.mock('@/databases/user-settings', () => ({
  getSetting: jest.fn(async (_db: unknown, key: string) => mockSettings[key] ?? ''),
}));
const mockHasReadPermission = jest.fn(async () => true);
jest.mock('@/lib/healthConnect', () => ({
  hasReadPermission: () => mockHasReadPermission(),
}));
const mockSync = jest.fn(async () => ({ success: true, daysWritten: 1, syncedAt: 'x' }));
jest.mock('@/lib/healthSync', () => ({
  syncHealthMetrics: () => mockSync(),
}));

import { isDailySyncDue, runDailyHealthSyncIfDue } from '@/lib/healthDailySync';
import { freezeNow } from '@/testing/clock';
import { localIso } from '@/testing/builders';

const db = {} as any;
const now = new Date(localIso('2026-09-28', 8));

describe('isDailySyncDue', () => {
  const due = (over: Partial<Parameters<typeof isDailySyncDue>[0]>) =>
    isDailySyncDue({ dailySync: 'true', optedIn: 'true', lastSyncedAtISO: null, now, ...over });

  it('is off unless the toggle is on and the user is connected', () => {
    expect(due({ dailySync: '' })).toBe(false);
    expect(due({ dailySync: 'false' })).toBe(false);
    expect(due({ optedIn: 'false' })).toBe(false);
  });

  it('is due when never synced or last synced on an earlier local day', () => {
    expect(due({ lastSyncedAtISO: '' })).toBe(true);
    expect(due({ lastSyncedAtISO: 'garbage' })).toBe(true);
    expect(due({ lastSyncedAtISO: localIso('2026-09-27', 23, 59) })).toBe(true);
  });

  it('is not due again on the same local day', () => {
    expect(due({ lastSyncedAtISO: localIso('2026-09-28', 0, 1) })).toBe(false);
  });
});

describe('runDailyHealthSyncIfDue', () => {
  beforeEach(() => {
    Platform.OS = 'android';
    freezeNow(now);
    for (const k of Object.keys(mockSettings)) delete mockSettings[k];
    Object.assign(mockSettings, {
      health_daily_sync: 'true',
      health_connect_opt_in: 'true',
      health_last_synced_at: localIso('2026-09-27', 20),
    });
    mockSync.mockClear();
    mockHasReadPermission.mockClear();
    mockHasReadPermission.mockResolvedValue(true);
  });

  it('syncs when due', async () => {
    await expect(runDailyHealthSyncIfDue(db)).resolves.toBe(true);
    expect(mockSync).toHaveBeenCalledTimes(1);
  });

  it('runs one sync for overlapping triggers (launch + foreground)', async () => {
    await Promise.all([runDailyHealthSyncIfDue(db), runDailyHealthSyncIfDue(db)]);
    expect(mockSync).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the toggle is off (the default)', async () => {
    delete mockSettings.health_daily_sync;
    await expect(runDailyHealthSyncIfDue(db)).resolves.toBe(false);
    expect(mockSync).not.toHaveBeenCalled();
  });

  it('does nothing when already synced today', async () => {
    mockSettings.health_last_synced_at = localIso('2026-09-28', 7);
    await runDailyHealthSyncIfDue(db);
    expect(mockSync).not.toHaveBeenCalled();
  });

  it('does nothing without the read permission', async () => {
    mockHasReadPermission.mockResolvedValue(false);
    await expect(runDailyHealthSyncIfDue(db)).resolves.toBe(false);
    expect(mockSync).not.toHaveBeenCalled();
  });

  it('does nothing off Android', async () => {
    Platform.OS = 'ios';
    await runDailyHealthSyncIfDue(db);
    expect(mockHasReadPermission).not.toHaveBeenCalled();
  });

  it('never throws when the sync fails', async () => {
    mockSync.mockRejectedValueOnce(new Error('boom'));
    await expect(runDailyHealthSyncIfDue(db)).resolves.toBe(false);
  });
});
