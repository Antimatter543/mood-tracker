/**
 * lib/healthSync.ts
 *
 * The Health Connect sync orchestrator: read a date window from Health Connect,
 * roll it up to per-local-day rows, and upsert them into on-device SQLite.
 *
 * A THIN shell — the window math and the day aggregation are pure + tested in
 * `lib/healthConnectPure.ts`; the native read is guarded in `lib/healthConnect.ts`.
 *
 * PRIVACY (load-bearing): this is on-device only. It NEVER logs raw health
 * values and NEVER sends them anywhere — SoulSync has no account and no server.
 * The only thing persisted outside `health_metrics` is a last-synced timestamp.
 */

import { SQLiteDatabase } from 'expo-sqlite';
import { readHealthForRange } from '@/lib/healthConnect';
import { aggregateHealthByDay, computeSyncWindow } from '@/lib/healthConnectPure';
import { upsertHealthMetrics } from '@/databases/health-metrics';
import { getSetting, updateSetting } from '@/databases/user-settings';
import {
  HEALTH_CONNECT_SOURCE,
  HEALTH_CONNECT_SYNC_WINDOW_DAYS,
  HEALTH_LAST_SYNCED_SETTING_KEY,
} from '@/lib/healthConnectConfig';

/** Outcome of a sync. Carries counts + a timestamp only — never any health values. */
export interface HealthSyncResult {
  success: boolean;
  /** Number of local-day rows written/updated. */
  daysWritten: number;
  /** ISO timestamp persisted as the new last-synced marker, or `null` on failure. */
  syncedAt: string | null;
}

/**
 * Sync Health Connect sleep + heart-rate into `health_metrics`.
 *
 * Window: the first sync reads {@link HEALTH_CONNECT_SYNC_WINDOW_DAYS} back;
 * later syncs read incrementally from the last-synced day (see
 * {@link computeSyncWindow}). On success the last-synced marker advances to
 * `now`. Failures leave the marker untouched so the next sync re-covers the gap.
 *
 * Callers MUST only invoke this once the user has connected (Android + granted).
 * It degrades safely otherwise: the guarded read returns empty and this writes
 * nothing but still advances the marker.
 */
export async function syncHealthMetrics(
  db: SQLiteDatabase,
  options?: { windowDays?: number; now?: Date }
): Promise<HealthSyncResult> {
  const windowDays = options?.windowDays ?? HEALTH_CONNECT_SYNC_WINDOW_DAYS;
  const now = options?.now ?? new Date();

  try {
    const lastSynced = await getSetting(db, HEALTH_LAST_SYNCED_SETTING_KEY);
    const { startISO, endISO } = computeSyncWindow(
      lastSynced || null,
      now,
      windowDays
    );

    const { sleepSessions, heartRateSamples } = await readHealthForRange(
      startISO,
      endISO
    );
    const rows = aggregateHealthByDay({ sleepSessions, heartRateSamples });

    await upsertHealthMetrics(db, rows, HEALTH_CONNECT_SOURCE, endISO);
    await updateSetting(db, HEALTH_LAST_SYNCED_SETTING_KEY, endISO);

    return { success: true, daysWritten: rows.length, syncedAt: endISO };
  } catch (error) {
    // Log the failure only — NEVER the health data itself.
    console.error('Health sync failed:', error);
    return { success: false, daysWritten: 0, syncedAt: null };
  }
}
