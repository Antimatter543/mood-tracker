import { insertSeedPlans, writeSamplePhotoFiles } from '@/components/generateData';
import { bumpDataVersion } from '@/context/dataRefreshStore';
import { getActivities } from '@/databases/activities';
import { resetDatabase } from '@/databases/lifecycle';
import { whenDatabaseInitialized } from '@/databases/readiness';
import { withWriteLock, withWriteTransaction } from '@/databases/writeTransaction';
import { now as clockNow, __setFrozenNowForQa } from '@/lib/clock';
import { QA_FROZEN_NOW_SETTING_KEY, QA_SEEDED_SETTING_KEY, type QaScenario } from './index';
import { parseUtcInstant } from './seedLink';
import { planScenario, planScenarioHealth } from './scenarios';
import type { SeedCommand } from './seedLink';

/**
 * The QA seed I/O layer: wipe the database and write one allowlisted scenario.
 * Only reachable in an `EXPO_PUBLIC_QA=1` build (see lib/qa/index.ts).
 *
 * Order, all on the singleton write connection:
 *   1. wait for `initializeDatabase` (WAL + migrations) to finish, so a cold
 *      launch from the deep link never races it;
 *   2. REFUSE when the database holds entries but no QA marker: that is data a
 *      person typed, and another app firing the link must not destroy it;
 *   3. reset (drop + re-migrate, same as the dev "Reset Database" button);
 *   4. write fresh sample photos, then ONE transaction with the scenario rows,
 *      the marker and the frozen instant (if any);
 *   5. freeze the app clock (lib/clock.ts) at the link's `now`, or unfreeze it
 *      when the link has none, so every screen's "today" matches the data;
 *   6. broadcast the data-refresh signal so every screen reloads.
 * One seed at a time: a second command while one runs is rejected, not queued.
 */

export type SeedErrorCode =
  | 'busy'
  | 'db-not-ready'
  | 'foreign-data'
  | 'reset-failed'
  | 'no-activities'
  | 'write-failed';

export type SeedOutcome =
  | { ok: true; scenario: QaScenario; entries: number; now: string }
  | { ok: false; error: SeedErrorCode };

export interface RunSeedOptions {
  /** How long to wait for `initializeDatabase` before giving up. */
  readyTimeoutMs?: number;
}

const DEFAULT_READY_TIMEOUT_MS = 30_000;

let running = false;

function withTimeout(promise: Promise<void>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    promise.then(() => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

/** Entries exist and no earlier seed left its marker = a person's data. */
async function holdsForeignData(): Promise<boolean> {
  return withWriteLock(async (conn) => {
    // BOTH sides of the bin on purpose: a reset destroys binned entries too, and
    // they are just as much a person's data (softDeleteExclusion.test.ts wants
    // that decision spelled out in the query).
    const entries = await conn.getFirstAsync<{ n: number }>(
      'SELECT COUNT(*) AS n FROM entries WHERE deleted_at IS NULL OR deleted_at IS NOT NULL'
    );
    if (!entries || entries.n === 0) return false;
    const marker = await conn.getFirstAsync<{ n: number }>(
      'SELECT COUNT(*) AS n FROM user_settings WHERE key = ?',
      [QA_SEEDED_SETTING_KEY]
    );
    return !marker || marker.n === 0;
  });
}

export async function runSeed(
  command: SeedCommand,
  options: RunSeedOptions = {}
): Promise<SeedOutcome> {
  if (running) return { ok: false, error: 'busy' };
  running = true;
  try {
    const ready = await withTimeout(
      whenDatabaseInitialized(),
      options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS
    );
    if (!ready) return { ok: false, error: 'db-not-ready' };

    // A refusal changes nothing, the clock included.
    if (await holdsForeignData()) return { ok: false, error: 'foreign-data' };

    // Unfreeze first: without a `now` the fixture anchors at the real present,
    // never at an instant an earlier seed froze.
    __setFrozenNowForQa(null);
    const now = command.now ?? clockNow();

    const reset = await resetDatabase();
    if (!reset.success) return { ok: false, error: 'reset-failed' };

    const { plans, rng } = planScenario(command.scenario, now);

    let written: boolean | null;
    try {
      const photoPaths = plans.some((p) => p.photoCount > 0) ? await writeSamplePhotoFiles() : [];
      written = await withWriteTransaction(async (txn) => {
        const activities = await getActivities(txn);
        if (plans.length > 0 && activities.length === 0) return false;
        await insertSeedPlans(txn, plans, activities, photoPaths, rng, now.toISOString());
        for (const h of planScenarioHealth(command.scenario, now)) {
          await txn.runAsync(
            `INSERT INTO health_metrics
               (date, sleep_total_minutes, sleep_stages, avg_heart_rate, min_heart_rate, resting_heart_rate, avg_hrv_millis, source, synced_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [h.date, h.sleepTotalMinutes, null, h.avgHeartRate, h.minHeartRate, h.restingHeartRate, h.avgHrvMillis, 'qa-seed', now.toISOString()]
          );
        }
        await txn.runAsync('INSERT OR REPLACE INTO user_settings (key, value) VALUES (?, ?)', [
          QA_SEEDED_SETTING_KEY,
          command.scenario,
        ]);
        if (command.now) {
          await txn.runAsync('INSERT OR REPLACE INTO user_settings (key, value) VALUES (?, ?)', [
            QA_FROZEN_NOW_SETTING_KEY,
            command.now.toISOString(),
          ]);
        }
        return true;
      });
    } catch {
      written = null;
    }

    // Freeze only on success: a failed seed leaves the wall clock (set above).
    if (written && command.now) __setFrozenNowForQa(command.now);

    // The reset already changed what every screen shows: reload them whatever
    // happened next.
    bumpDataVersion();

    if (written === null) return { ok: false, error: 'write-failed' };
    if (!written) return { ok: false, error: 'no-activities' };
    return { ok: true, scenario: command.scenario, entries: plans.length, now: now.toISOString() };
  } finally {
    running = false;
  }
}

/**
 * Re-apply a persisted frozen instant after a relaunch (QaSeedHost calls this
 * on mount). Waits for `initializeDatabase` like a seed does; returns the
 * instant it froze at, or null when there is none (or the DB never got ready).
 * The stored value goes through the link parser's strict UTC check, so a
 * tampered row can freeze nothing but a valid 2000..2100 instant.
 */
export async function restoreFrozenClock(
  options: RunSeedOptions = {}
): Promise<Date | null> {
  const ready = await withTimeout(
    whenDatabaseInitialized(),
    options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS
  );
  if (!ready) return null;
  const row = await withWriteLock((conn) =>
    conn.getFirstAsync<{ value: string }>('SELECT value FROM user_settings WHERE key = ?', [
      QA_FROZEN_NOW_SETTING_KEY,
    ])
  );
  const at = row ? parseUtcInstant(row.value) : null;
  if (!at) return null;
  __setFrozenNowForQa(at);
  bumpDataVersion();
  return at;
}

/** TEST ONLY. Clear the single-flight latch. */
export function __resetRunSeedForTests(): void {
  running = false;
}
