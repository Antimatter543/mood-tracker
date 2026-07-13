/**
 * lib/healthSync.ts
 *
 * The Health Connect sync orchestrator: read a date window from Health Connect,
 * roll it up to per-local-day rows, and upsert them into on-device SQLite.
 *
 * A THIN shell — the window math (`resolveSyncWindow` / `splitWindow`) and the
 * day aggregation (`aggregateHealthByDay`) are pure + tested in
 * `lib/healthConnectPure.ts`; the native read is guarded in `lib/healthConnect.ts`.
 *
 * WINDOW STRATEGY (fixes the "wait a few more days" bug):
 *  - FIRST connect / a gap in coverage → a one-time historical BACKFILL that
 *    reaches back to the earliest mood day (capped at MAX_BACKFILL_DAYS), so a
 *    user with months of both mood + Health Connect history immediately has
 *    enough paired days for the insights instead of only the last 30.
 *  - The backfill is driven CHUNKED (≤ CHUNK_DAYS per read → aggregate → upsert),
 *    so at most one chunk's worth of raw heart-rate samples is held in memory at
 *    once — a year of per-second HR would otherwise OOM the read.
 *  - Steady state → a small INCREMENTAL read from the last-synced day.
 *
 * PRIVACY (load-bearing): this is on-device only. It NEVER logs raw health
 * values and NEVER sends them anywhere — SoulSync has no account and no server.
 * The only thing persisted outside `health_metrics` is a last-synced timestamp.
 */

import { SQLiteDatabase } from 'expo-sqlite';
import { readHealthForRange } from '@/lib/healthConnect';
import {
  aggregateHealthByDay,
  resolveSyncWindow,
  splitWindow,
  type SyncWindow,
} from '@/lib/healthConnectPure';
import {
  upsertHealthMetrics,
  getEarliestHealthMetricDate,
} from '@/databases/health-metrics';
import { getEarliestEntryInstant } from '@/databases/entries';
import { getSetting, updateSetting } from '@/databases/user-settings';
import {
  HEALTH_CONNECT_SOURCE,
  HEALTH_CONNECT_MAX_BACKFILL_DAYS,
  HEALTH_CONNECT_INITIAL_WINDOW_DAYS,
  HEALTH_CONNECT_CHUNK_DAYS,
  HEALTH_LAST_SYNCED_SETTING_KEY,
} from '@/lib/healthConnectConfig';

/** Outcome of a sync. Carries counts + a timestamp only — never any health values. */
export interface HealthSyncResult {
  success: boolean;
  /** Number of local-day rows written/updated (summed across chunks). */
  daysWritten: number;
  /** ISO timestamp persisted as the new last-synced marker, or `null` on failure. */
  syncedAt: string | null;
}

/** Overridable knobs — defaults come from healthConnectConfig; tests inject `now`. */
export interface SyncOptions {
  now?: Date;
  maxBackfillDays?: number;
  initialWindowDays?: number;
  chunkDays?: number;
}

/**
 * Read one window from Health Connect, aggregate to per-day rows, and upsert
 * them. Returns the number of day-rows written. Kept small so the backfill loop
 * can call it once per chunk.
 */
async function syncOneWindow(
  db: SQLiteDatabase,
  window: SyncWindow,
  syncedAt: string
): Promise<number> {
  const { sleepSessions, heartRateSamples, hrvSamples } = await readHealthForRange(
    window.startISO,
    window.endISO
  );
  const rows = aggregateHealthByDay({ sleepSessions, heartRateSamples, hrvSamples });
  await upsertHealthMetrics(db, rows, HEALTH_CONNECT_SOURCE, syncedAt);
  return rows.length;
}

/**
 * Sync Health Connect sleep + heart-rate + HRV into `health_metrics`.
 *
 * Resolves the read window from the earliest mood entry, the last-synced marker,
 * and the earliest already-stored health day (see {@link resolveSyncWindow}); a
 * backfill is read chunked, an incremental read is a single window. On success
 * the last-synced marker advances to `now`. Failures leave the marker untouched
 * so the next sync re-covers the gap.
 *
 * Callers MUST only invoke this once the user has connected (Android + granted).
 * It degrades safely otherwise: the guarded read returns empty and this writes
 * nothing but still advances the marker.
 */
export async function syncHealthMetrics(
  db: SQLiteDatabase,
  options?: SyncOptions
): Promise<HealthSyncResult> {
  const now = options?.now ?? new Date();
  const maxBackfillDays = options?.maxBackfillDays ?? HEALTH_CONNECT_MAX_BACKFILL_DAYS;
  const initialWindowDays = options?.initialWindowDays ?? HEALTH_CONNECT_INITIAL_WINDOW_DAYS;
  const chunkDays = options?.chunkDays ?? HEALTH_CONNECT_CHUNK_DAYS;

  try {
    const [lastSynced, earliestMoodInstant, earliestStoredHealthDate] =
      await Promise.all([
        getSetting(db, HEALTH_LAST_SYNCED_SETTING_KEY),
        getEarliestEntryInstant(db),
        getEarliestHealthMetricDate(db),
      ]);

    const { startISO, endISO, isBackfill } = resolveSyncWindow({
      earliestMoodInstant,
      lastSyncedAtISO: lastSynced || null,
      earliestStoredHealthDate,
      now,
      maxBackfillDays,
      initialWindowDays,
    });

    // A backfill is chunked (bounded memory); an incremental read is one window.
    // splitWindow returns [] for a zero-width window, so an already-current sync
    // does no reads but still advances the marker below.
    const windows: SyncWindow[] = isBackfill
      ? splitWindow(startISO, endISO, chunkDays)
      : startISO < endISO
        ? [{ startISO, endISO }]
        : [];

    let daysWritten = 0;
    for (const window of windows) {
      daysWritten += await syncOneWindow(db, window, endISO);
    }

    await updateSetting(db, HEALTH_LAST_SYNCED_SETTING_KEY, endISO);

    return { success: true, daysWritten, syncedAt: endISO };
  } catch (error) {
    // Log the failure only — NEVER the health data itself.
    console.error('Health sync failed:', error);
    return { success: false, daysWritten: 0, syncedAt: null };
  }
}
