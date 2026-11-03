import { insertSeedPlans, writeSamplePhotoFiles } from '@/components/generateData';
import { bumpDataVersion } from '@/context/dataRefreshStore';
import { getActivities } from '@/databases/activities';
import { resetDatabase } from '@/databases/lifecycle';
import { whenDatabaseInitialized } from '@/databases/readiness';
import { withWriteLock, withWriteTransaction } from '@/databases/writeTransaction';
import { QA_SEEDED_SETTING_KEY, type QaScenario } from './index';
import { planScenario } from './scenarios';
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
 *   4. write fresh sample photos, then ONE transaction with the scenario rows
 *      and the marker;
 *   5. broadcast the data-refresh signal so every screen reloads.
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
    const entries = await conn.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM entries');
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

    // TODO(lane C, lib/clock.ts): once the injectable app clock lands, also
    // FREEZE it at `command.now` here, so screens that read "today" agree with
    // the seeded data. Until then `now` only anchors the fixture; the app's
    // own "today" is still the device clock.
    const now = command.now ?? new Date();

    if (await holdsForeignData()) return { ok: false, error: 'foreign-data' };

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
        await txn.runAsync('INSERT OR REPLACE INTO user_settings (key, value) VALUES (?, ?)', [
          QA_SEEDED_SETTING_KEY,
          command.scenario,
        ]);
        return true;
      });
    } catch {
      written = null;
    }

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

/** TEST ONLY. Clear the single-flight latch. */
export function __resetRunSeedForTests(): void {
  running = false;
}
