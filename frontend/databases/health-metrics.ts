import { SQLiteDatabase } from 'expo-sqlite';
import type { DailyHealthMetrics } from '@/lib/healthConnectPure';

/**
 * CRUD for the `health_metrics` table — Health Connect daily sleep + heart-rate
 * metrics, ONE row per LOCAL calendar day (`date` = `YYYY-MM-DD`).
 *
 * PRIVACY: this data is 100% on-device. Nothing here logs raw health values or
 * sends them anywhere; the table exists only so the (opt-in) health signal can
 * be JOINed to day-keyed mood `entries` for on-device insights (Phase 2b).
 *
 * Storage contract: `date` is a local calendar day (from `localDateString`), so
 * a future correlation is a trivial `hm.date = <entry's local day>` match — no
 * timezone math at read time. `sleep_stages` is a JSON string of
 * `Record<numericStageType, minutes>` (or NULL when there was no staged sleep).
 */

/** A stored health-metrics row, with `source` + `syncedAt` alongside the day's metrics. */
export interface StoredHealthMetric extends DailyHealthMetrics {
  /** Where the row came from (e.g. 'health_connect'). */
  source: string;
  /** ISO timestamp of the sync that wrote this row. */
  syncedAt: string;
}

/** The raw SQLite row shape (snake_case columns). */
interface HealthMetricRow {
  date: string;
  sleep_total_minutes: number | null;
  sleep_stages: string | null;
  avg_heart_rate: number | null;
  min_heart_rate: number | null;
  source: string;
  synced_at: string;
}

/** Parse a raw row into a {@link StoredHealthMetric}, defensively decoding JSON. */
function rowToMetric(row: HealthMetricRow): StoredHealthMetric {
  let sleepStages: Record<number, number> = {};
  if (row.sleep_stages) {
    try {
      const parsed = JSON.parse(row.sleep_stages);
      if (parsed && typeof parsed === 'object') sleepStages = parsed;
    } catch {
      // Corrupt JSON → treat as no stage data rather than throwing.
      sleepStages = {};
    }
  }
  return {
    date: row.date,
    sleepTotalMinutes: row.sleep_total_minutes,
    sleepStages,
    avgHeartRate: row.avg_heart_rate,
    minHeartRate: row.min_heart_rate,
    source: row.source,
    syncedAt: row.synced_at,
  };
}

/** Serialize a day's stage map to JSON, or NULL when there are no stages. */
function serializeStages(stages: Record<number, number>): string | null {
  return Object.keys(stages).length > 0 ? JSON.stringify(stages) : null;
}

/**
 * Upsert daily metrics BY DATE: a second sync of the same day REPLACES that
 * day's row (via `ON CONFLICT(date) DO UPDATE`), so re-syncing a partial day is
 * idempotent and never duplicates. All rows share one `syncedAt`. Runs inside a
 * single EXCLUSIVE transaction (consistent with the rest of the write layer —
 * the shared connection has concurrent focus-driven reads). No-op for an empty
 * list.
 */
export async function upsertHealthMetrics(
  db: SQLiteDatabase,
  rows: ReadonlyArray<DailyHealthMetrics>,
  source: string,
  syncedAt: string
): Promise<void> {
  if (rows.length === 0) return;

  await db.withExclusiveTransactionAsync(async () => {
    for (const row of rows) {
      await db.runAsync(
        `INSERT INTO health_metrics
           (date, sleep_total_minutes, sleep_stages, avg_heart_rate, min_heart_rate, source, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(date) DO UPDATE SET
           sleep_total_minutes = excluded.sleep_total_minutes,
           sleep_stages        = excluded.sleep_stages,
           avg_heart_rate      = excluded.avg_heart_rate,
           min_heart_rate      = excluded.min_heart_rate,
           source              = excluded.source,
           synced_at           = excluded.synced_at`,
        [
          row.date,
          row.sleepTotalMinutes,
          serializeStages(row.sleepStages),
          row.avgHeartRate,
          row.minHeartRate,
          source,
          syncedAt,
        ]
      );
    }
  });
}

/**
 * Read stored metrics for an inclusive local-day range `[startDate, endDate]`
 * (both `YYYY-MM-DD`), ascending by date. Returns `[]` on error.
 */
export async function getHealthMetricsRange(
  db: SQLiteDatabase,
  startDate: string,
  endDate: string
): Promise<StoredHealthMetric[]> {
  try {
    const rows = await db.getAllAsync<HealthMetricRow>(
      `SELECT * FROM health_metrics
       WHERE date BETWEEN ? AND ?
       ORDER BY date ASC`,
      [startDate, endDate]
    );
    return rows.map(rowToMetric);
  } catch (error) {
    console.error('Error reading health metrics range:', error);
    return [];
  }
}

/** The most recent stored day, or `null` when the table is empty / on error. */
export async function getLatestHealthMetric(
  db: SQLiteDatabase
): Promise<StoredHealthMetric | null> {
  try {
    const row = await db.getFirstAsync<HealthMetricRow>(
      `SELECT * FROM health_metrics ORDER BY date DESC LIMIT 1`
    );
    return row ? rowToMetric(row) : null;
  } catch (error) {
    console.error('Error reading latest health metric:', error);
    return null;
  }
}

/** Delete every stored health row (used by the "Turn off" disconnect flow). */
export async function clearAllHealthMetrics(db: SQLiteDatabase): Promise<void> {
  await db.runAsync(`DELETE FROM health_metrics`);
}
