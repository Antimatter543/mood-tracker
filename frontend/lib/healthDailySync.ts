/**
 * Optional daily Health Connect sync: the first time the app opens (or comes to
 * the foreground) on a local day, sync once, if the user turned it on.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import { Platform } from 'react-native';
import { getSetting } from '@/databases/user-settings';
import { localDateString } from '@/databases/dateHelpers';
import { hasReadPermission } from '@/lib/healthConnect';
import {
  HEALTH_DAILY_SYNC_SETTING_KEY,
  HEALTH_LAST_SYNCED_SETTING_KEY,
  HEALTH_OPT_IN_SETTING_KEY,
  shouldShowHealthConnect,
} from '@/lib/healthConnectConfig';
import { syncHealthMetrics } from '@/lib/healthSync';
import { now as clockNow } from '@/lib/clock';

/** True when daily sync is on, the user is connected, and no sync has run today. Pure. */
export function isDailySyncDue(opts: {
  dailySync: string | null;
  optedIn: string | null;
  lastSyncedAtISO: string | null;
  now: Date;
}): boolean {
  if (opts.dailySync !== 'true' || opts.optedIn !== 'true') return false;
  const last = opts.lastSyncedAtISO ? Date.parse(opts.lastSyncedAtISO) : NaN;
  if (!Number.isFinite(last)) return true;
  return localDateString(new Date(last)) !== localDateString(opts.now);
}

let inFlight: Promise<boolean> | null = null;

/** Sync if due. Resolves true when a sync wrote. Never throws; one run at a time. */
export function runDailyHealthSyncIfDue(db: SQLiteDatabase): Promise<boolean> {
  if (!shouldShowHealthConnect(Platform.OS)) return Promise.resolve(false);
  if (!inFlight) {
    inFlight = (async () => {
      try {
        const [dailySync, optedIn, lastSyncedAtISO] = await Promise.all([
          getSetting(db, HEALTH_DAILY_SYNC_SETTING_KEY),
          getSetting(db, HEALTH_OPT_IN_SETTING_KEY),
          getSetting(db, HEALTH_LAST_SYNCED_SETTING_KEY),
        ]);
        if (!isDailySyncDue({ dailySync, optedIn, lastSyncedAtISO, now: clockNow() })) return false;
        if (!(await hasReadPermission())) return false;
        return (await syncHealthMetrics(db)).success;
      } catch {
        return false;
      } finally {
        inFlight = null;
      }
    })();
  }
  return inFlight;
}
