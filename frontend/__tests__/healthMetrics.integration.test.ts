/**
 * INTEGRATION test — runs the REAL health-metrics write/read + the REAL
 * migration-8 ALTER against a REAL SQLite engine (Node's built-in `node:sqlite`,
 * Node ≥ 22.5) to prove what the no-op expo-sqlite jest mock CANNOT:
 *   - `avg_hrv_millis` round-trips through upsertHealthMetrics → getHealthMetricsRange,
 *   - migration 8 (`ALTER TABLE health_metrics ADD COLUMN avg_hrv_millis REAL`)
 *     actually adds the column to a migration-7-shaped table.
 *
 * The write layer opens its connection via `openDatabaseAsync`; here we INJECT a
 * thin adapter over an in-memory node:sqlite DB as the write connection (and pass
 * it as the read `db` too), so every statement hits one real engine. Skips
 * cleanly if the runtime lacks node:sqlite.
 */
jest.mock('expo-sqlite');

import {
  __setWriteConnectionForTests,
  __resetWriteTransactionForTests,
} from '@/databases/writeTransaction';
import {
  upsertHealthMetrics,
  getHealthMetricsRange,
  getEarliestHealthMetricDate,
} from '@/databases/health-metrics';
import { migrations } from '@/databases/migrations';

let DatabaseSync: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  DatabaseSync = null;
}
const describeIfSqlite = DatabaseSync ? describe : describe.skip;

/** An expo-sqlite-shaped async adapter over a synchronous node:sqlite database. */
function makeAdapter(db: any) {
  return {
    execAsync: async (sql: string) => {
      db.exec(sql);
    },
    runAsync: async (sql: string, params: any[] = []) => {
      const r = db.prepare(sql).run(...(params ?? []));
      return { lastInsertRowId: Number(r.lastInsertRowid), changes: Number(r.changes) };
    },
    getAllAsync: async (sql: string, params: any[] = []) => db.prepare(sql).all(...(params ?? [])),
    getFirstAsync: async (sql: string, params: any[] = []) =>
      db.prepare(sql).get(...(params ?? [])) ?? null,
  };
}

// Migration-7-shaped health_metrics (WITHOUT avg_hrv_millis) — what an existing
// user / a fresh install has BEFORE migration 8 runs.
const HEALTH_METRICS_V7 = `
  CREATE TABLE health_metrics (
    date                TEXT PRIMARY KEY,
    sleep_total_minutes REAL,
    sleep_stages        TEXT,
    avg_heart_rate      REAL,
    min_heart_rate      REAL,
    source              TEXT NOT NULL DEFAULT 'health_connect',
    synced_at           TEXT NOT NULL
  );
`;

const columnNames = (db: any): string[] =>
  db.prepare(`PRAGMA table_info(health_metrics)`).all().map((c: any) => c.name);

describeIfSqlite('health_metrics — real SQLite migration + HRV round-trip', () => {
  let db: any;
  let adapter: any;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    adapter = makeAdapter(db);
    __resetWriteTransactionForTests();
    __setWriteConnectionForTests(adapter);
  });

  afterEach(() => {
    __resetWriteTransactionForTests();
    db?.close?.();
  });

  it('migration 8 adds avg_hrv_millis to a migration-7-shaped table', async () => {
    db.exec(HEALTH_METRICS_V7);
    expect(columnNames(db)).not.toContain('avg_hrv_millis');

    const migration8 = migrations.find((m) => m.version === 8);
    expect(migration8).toBeDefined();
    await migration8!.up(adapter as any);

    expect(columnNames(db)).toContain('avg_hrv_millis');
  });

  it('avg_hrv_millis round-trips through upsert → read (real engine)', async () => {
    // Start from the migration-7 table, then run migration 8 to reach the current
    // shape — exactly the on-device path.
    db.exec(HEALTH_METRICS_V7);
    await migrations.find((m) => m.version === 8)!.up(adapter as any);

    await upsertHealthMetrics(
      adapter,
      [
        {
          date: '2026-07-07',
          sleepTotalMinutes: 480,
          sleepStages: { 5: 60 },
          avgHeartRate: 80,
          minHeartRate: 60,
          avgHrvMillis: 42,
        },
        {
          date: '2026-07-08',
          sleepTotalMinutes: null,
          sleepStages: {},
          avgHeartRate: null,
          minHeartRate: null,
          avgHrvMillis: null, // HRV-absent day stays NULL
        },
      ],
      'health_connect',
      '2026-07-08T05:00:00.000Z'
    );

    const rows = await getHealthMetricsRange(adapter as any, '2026-07-01', '2026-07-31');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ date: '2026-07-07', avgHrvMillis: 42, avgHeartRate: 80 });
    expect(rows[1]).toMatchObject({ date: '2026-07-08', avgHrvMillis: null });

    // Earliest stored day (drives the backfill coverage check).
    await expect(getEarliestHealthMetricDate(adapter as any)).resolves.toBe('2026-07-07');
  });

  it('re-upserting the same day REPLACES its HRV (idempotent, ON CONFLICT)', async () => {
    db.exec(HEALTH_METRICS_V7);
    await migrations.find((m) => m.version === 8)!.up(adapter as any);

    const base = {
      date: '2026-07-07',
      sleepTotalMinutes: 480,
      sleepStages: {},
      avgHeartRate: 80,
      minHeartRate: 60,
    };
    await upsertHealthMetrics(adapter, [{ ...base, avgHrvMillis: 40 }], 'health_connect', 't1');
    await upsertHealthMetrics(adapter, [{ ...base, avgHrvMillis: 55 }], 'health_connect', 't2');

    const rows = await getHealthMetricsRange(adapter as any, '2026-07-01', '2026-07-31');
    expect(rows).toHaveLength(1); // no duplicate
    expect(rows[0].avgHrvMillis).toBe(55); // latest wins
  });
});
