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

// Migration-7-shaped health_metrics (WITHOUT avg_hrv_millis / resting_heart_rate)
// — what an existing user / a fresh install has BEFORE migrations 8 + 9 run.
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

// Migration-8-shaped health_metrics (V7 + avg_hrv_millis, but NO
// resting_heart_rate) — what a user on 2.4.0 has BEFORE migration 9 runs.
const HEALTH_METRICS_V8 = `
  CREATE TABLE health_metrics (
    date                TEXT PRIMARY KEY,
    sleep_total_minutes REAL,
    sleep_stages        TEXT,
    avg_heart_rate      REAL,
    min_heart_rate      REAL,
    source              TEXT NOT NULL DEFAULT 'health_connect',
    synced_at           TEXT NOT NULL,
    avg_hrv_millis      REAL
  );
`;

const columnNames = (db: any): string[] =>
  db.prepare(`PRAGMA table_info(health_metrics)`).all().map((c: any) => c.name);

/**
 * Bring a migration-7-shaped table up to the CURRENT (v9) shape by running
 * migrations 8 + 9 in version order — exactly the on-device upgrade path. Both
 * are ADD COLUMN, the sole path for fresh installs AND existing users.
 */
async function migrateV7ToCurrent(adapter: any): Promise<void> {
  for (const version of [8, 9]) {
    await migrations.find((m) => m.version === version)!.up(adapter);
  }
}

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

  it('avg_hrv_millis + resting_heart_rate round-trip through upsert → read (real engine)', async () => {
    // Start from the migration-7 table, then run migrations 8 + 9 to reach the
    // current shape — exactly the on-device path.
    db.exec(HEALTH_METRICS_V7);
    await migrateV7ToCurrent(adapter);

    await upsertHealthMetrics(
      adapter,
      [
        {
          date: '2026-07-07',
          sleepTotalMinutes: 480,
          sleepStages: { 5: 60 },
          avgHeartRate: 80,
          minHeartRate: 60,
          restingHeartRate: 58,
          avgHrvMillis: 42,
        },
        {
          date: '2026-07-08',
          sleepTotalMinutes: null,
          sleepStages: {},
          avgHeartRate: null,
          minHeartRate: null,
          restingHeartRate: null, // resting-HR-absent day stays NULL
          avgHrvMillis: null, // HRV-absent day stays NULL
        },
      ],
      'health_connect',
      '2026-07-08T05:00:00.000Z'
    );

    const rows = await getHealthMetricsRange(adapter as any, '2026-07-01', '2026-07-31');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      date: '2026-07-07',
      avgHrvMillis: 42,
      avgHeartRate: 80,
      restingHeartRate: 58,
    });
    expect(rows[1]).toMatchObject({
      date: '2026-07-08',
      avgHrvMillis: null,
      restingHeartRate: null,
    });

    // Earliest stored day (drives the backfill coverage check).
    await expect(getEarliestHealthMetricDate(adapter as any)).resolves.toBe('2026-07-07');
  });

  it('re-upserting the same day REPLACES its resting HR (idempotent, ON CONFLICT)', async () => {
    db.exec(HEALTH_METRICS_V7);
    await migrateV7ToCurrent(adapter);

    const base = {
      date: '2026-07-07',
      sleepTotalMinutes: 480,
      sleepStages: {},
      avgHeartRate: 80,
      minHeartRate: 60,
      avgHrvMillis: 40,
    };
    await upsertHealthMetrics(adapter, [{ ...base, restingHeartRate: 57 }], 'health_connect', 't1');
    await upsertHealthMetrics(adapter, [{ ...base, restingHeartRate: 52 }], 'health_connect', 't2');

    const rows = await getHealthMetricsRange(adapter as any, '2026-07-01', '2026-07-31');
    expect(rows).toHaveLength(1); // no duplicate
    expect(rows[0].restingHeartRate).toBe(52); // latest wins
  });

  it('migration 9 adds resting_heart_rate to a migration-7-shaped table', async () => {
    db.exec(HEALTH_METRICS_V7);
    expect(columnNames(db)).not.toContain('resting_heart_rate');

    await migrateV7ToCurrent(adapter);

    expect(columnNames(db)).toContain('avg_hrv_millis'); // migration 8
    expect(columnNames(db)).toContain('resting_heart_rate'); // migration 9
  });

  it('migration 9 adds resting_heart_rate to an EXISTING v8 table, preserving its rows', async () => {
    // A 2.4.0 user already has a migration-8 table (avg_hrv_millis present, no
    // resting_heart_rate) with real data. Migration 9 must ADD the new column
    // without disturbing the existing rows.
    db.exec(HEALTH_METRICS_V8);
    db.prepare(
      `INSERT INTO health_metrics
         (date, sleep_total_minutes, sleep_stages, avg_heart_rate, min_heart_rate, source, synced_at, avg_hrv_millis)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('2026-07-05', 470, '{"5":50}', 78, 61, 'health_connect', 't0', 44);
    expect(columnNames(db)).not.toContain('resting_heart_rate');

    await migrations.find((m) => m.version === 9)!.up(adapter as any);

    expect(columnNames(db)).toContain('resting_heart_rate');
    // The pre-existing row survives; its new column defaults to NULL.
    const rows = await getHealthMetricsRange(adapter as any, '2026-07-01', '2026-07-31');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      date: '2026-07-05',
      avgHeartRate: 78,
      minHeartRate: 61,
      avgHrvMillis: 44,
      restingHeartRate: null,
    });

    // And a subsequent upsert can now write the dedicated resting HR.
    await upsertHealthMetrics(
      adapter,
      [
        {
          date: '2026-07-05',
          sleepTotalMinutes: 470,
          sleepStages: { 5: 50 },
          avgHeartRate: 78,
          minHeartRate: 61,
          restingHeartRate: 56,
          avgHrvMillis: 44,
        },
      ],
      'health_connect',
      't1'
    );
    const after = await getHealthMetricsRange(adapter as any, '2026-07-01', '2026-07-31');
    expect(after[0].restingHeartRate).toBe(56);
  });
});
