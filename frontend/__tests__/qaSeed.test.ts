/**
 * The QA seed channel's BEHAVIOUR (lib/qa). Its release-absence proof is the
 * other suite, qaSeedGuard.test.ts.
 *
 * Layers:
 *   1. parseSeedLink / parseUtcInstant: the hostile-input boundary, pure.
 *   2. planScenario: the fixtures, pure + deterministic (screenshot goldens
 *      depend on "same scenario + same now = same data").
 *   3. runSeed against a REAL SQLite engine at the shipped schema: the reset,
 *      the rows, the marker, the refusal to wipe a person's data, single-flight,
 *      readiness and the data-refresh broadcast.
 * The channel only exists in EXPO_PUBLIC_QA=1 builds, but its modules are plain
 * TS, so jest exercises them directly without the flag.
 */
import { QA_FROZEN_NOW_SETTING_KEY, QA_MAX_LINK_LENGTH, QA_SCENARIOS, QA_SEEDED_SETTING_KEY } from '@/lib/qa';
import { parseSeedLink, parseUtcInstant, isSeedLink, type SeedLinkError } from '@/lib/qa/seedLink';
import { planScenario, seededRng, yearBoundaryAnchor, SCENARIO_SPECS } from '@/lib/qa/scenarios';
import { aggregateTimeOfDay, timeOfDayCallout } from '@/components/visualisations/transforms/timeOfDay';
import { restoreFrozenClock, runSeed, __resetRunSeedForTests } from '@/lib/qa/runSeed';
import { now } from '@/lib/clock';
import { freezeNow, unfreezeNow } from '@/testing/clock';
import * as dataRefreshStore from '@/context/dataRefreshStore';
import { markDatabaseInitialized, __resetDatabaseReadinessForTests } from '@/databases/readiness';
import { __setWriteConnectionForTests } from '@/databases/writeTransaction';
import { localDateString } from '@/databases/dateHelpers';
import * as FileSystem from 'expo-file-system/legacy';
import { resetWriteLayer } from '@/testing/fakeDb';
import { countRows, describeSqlite, openMigratedSqlite, type SqliteAdapter } from '@/testing/realSqlite';

// mediaHelpers writes through expo-file-system/legacy; route it to the repo's
// recording mock (same as encryptedBackupExportImport.test.ts). jest hoists it.
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-file-system/legacy', () => require('../__mocks__/expo-file-system'));

const LINK = 'myapp://qa/seed';

// ---------------------------------------------------------------------------
// 1. The link parser
// ---------------------------------------------------------------------------
describe('parseSeedLink: accepted links', () => {
  it.each(QA_SCENARIOS)('accepts scenario=%s', (scenario) => {
    expect(parseSeedLink(`${LINK}?scenario=${scenario}`)).toEqual({ ok: true, command: { scenario } });
  });

  it('accepts a frozen now, with and without milliseconds, in either key order', () => {
    const a = parseSeedLink(`${LINK}?scenario=week&now=2026-06-15T12:00:00Z`);
    const b = parseSeedLink(`${LINK}?now=2026-06-15T12:00:00.000Z&scenario=week`);
    expect(a).toEqual({ ok: true, command: { scenario: 'week', now: new Date('2026-06-15T12:00:00.000Z') } });
    expect(b).toEqual(a);
  });

  it('accepts the triple-slash form some launchers produce, and percent-encoded values', () => {
    expect(parseSeedLink(`myapp:///qa/seed?scenario=empty`)).toEqual({ ok: true, command: { scenario: 'empty' } });
    expect(parseSeedLink(`${LINK}?scenario=week&now=2026-06-15T12%3A00%3A00Z`)).toMatchObject({ ok: true });
  });
});

describe('parseSeedLink: rejected links carry a code and the LENGTH only', () => {
  const cases: [string, SeedLinkError][] = [
    ['https://evil.example/qa/seed?scenario=week', 'not-seed-link'],
    ['myapp://qa/seedling?scenario=week', 'not-seed-link'],
    ['myapp://qa/seed/x?scenario=week', 'not-seed-link'],
    ['myapp://settings', 'not-seed-link'],
    ['MYAPP://qa/seed?scenario=week', 'not-seed-link'],
    [`${LINK}?scenario=week#frag`, 'fragment'],
    [`${LINK}#scenario=week`, 'fragment'],
    [LINK, 'missing-scenario'],
    [`${LINK}?`, 'missing-scenario'],
    [`${LINK}?scenario=`, 'missing-scenario'],
    [`${LINK}?now=2026-06-15T12:00:00Z`, 'missing-scenario'],
    [`${LINK}?scenario`, 'bad-query'],
    [`${LINK}?=week`, 'bad-query'],
    [`${LINK}?scenario=week&`, 'bad-query'],
    [`${LINK}?scenario=%E0%A4%A`, 'bad-query'],
    [`${LINK}?scenario=week&sql=DROP%20TABLE%20entries`, 'unknown-key'],
    [`${LINK}?scenario=week&__proto__=x`, 'unknown-key'],
    [`${LINK}?scenario=week&scenario=empty`, 'duplicate-key'],
    [`${LINK}?scenario=week&now=2026-06-15T12:00:00Z&now=2027-01-01T00:00:00Z`, 'duplicate-key'],
    [`${LINK}?scenario=nuke`, 'unknown-scenario'],
    [`${LINK}?scenario=Week`, 'unknown-scenario'],
    [`${LINK}?scenario=week'%3B--`, 'unknown-scenario'],
    [`${LINK}?scenario=../../etc`, 'unknown-scenario'],
    [`${LINK}?scenario=constructor`, 'unknown-scenario'],
    [`${LINK}?scenario=week&now=yesterday`, 'bad-now'],
    [`${LINK}?scenario=week&now=2026-06-15`, 'bad-now'],
    [`${LINK}?scenario=week&now=2026-06-15T12:00:00%2B10:00`, 'bad-now'],
    [`${LINK}?scenario=week&now=2026-02-30T12:00:00Z`, 'bad-now'],
    [`${LINK}?scenario=week&now=1999-12-31T23:59:59Z`, 'bad-now'],
    [`${LINK}?scenario=week&now=2101-01-01T00:00:00Z`, 'bad-now'],
    [`${LINK}?scenario=week&now=1781179200000`, 'bad-now'],
  ];

  it.each(cases)('%s -> %s', (url, error) => {
    const result = parseSeedLink(url);
    expect(result).toEqual({ ok: false, error, length: url.length });
    // Nothing from the input is echoed back (only a code and a number).
    expect(Object.keys(result).sort()).toEqual(['error', 'length', 'ok']);
  });

  it('caps the raw length BEFORE any decoding', () => {
    const long = `${LINK}?scenario=week&now=${'A'.repeat(QA_MAX_LINK_LENGTH)}`;
    expect(parseSeedLink(long)).toEqual({ ok: false, error: 'too-long', length: long.length });
    const edge = `${LINK}?scenario=week`.padEnd(QA_MAX_LINK_LENGTH + 1, 'x');
    expect(parseSeedLink(edge)).toMatchObject({ error: 'too-long' });
  });

  it('treats a non-string as not a seed link', () => {
    expect(parseSeedLink(undefined as never)).toEqual({ ok: false, error: 'not-seed-link', length: 0 });
  });
});

describe('isSeedLink', () => {
  it('is true for the seed path (valid or not), false for any other link', () => {
    expect(isSeedLink(`${LINK}?scenario=week`)).toBe(true);
    expect(isSeedLink(`${LINK}?scenario=nuke`)).toBe(true);
    expect(isSeedLink(LINK)).toBe(true);
    expect(isSeedLink('myapp://')).toBe(false);
    expect(isSeedLink('myapp://(tabs)/settings')).toBe(false);
    expect(isSeedLink('exp://192.168.1.2:8081')).toBe(false);
    expect(isSeedLink(`${LINK}?x=`.padEnd(QA_MAX_LINK_LENGTH + 1, 'x'))).toBe(false);
  });
});

describe('parseUtcInstant', () => {
  it('round-trips valid instants and rejects calendar overflow', () => {
    expect(parseUtcInstant('2024-02-29T00:00:00Z')?.toISOString()).toBe('2024-02-29T00:00:00.000Z');
    expect(parseUtcInstant('2025-02-29T00:00:00Z')).toBeNull();
    expect(parseUtcInstant('2026-04-31T00:00:00Z')).toBeNull();
    expect(parseUtcInstant('2026-06-15T24:00:00Z')).toBeNull();
    expect(parseUtcInstant('2026-06-15T12:60:00Z')).toBeNull();
    expect(parseUtcInstant('2000-01-01T00:00:00Z')).not.toBeNull();
    expect(parseUtcInstant('2100-12-31T23:59:59.999Z')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. The scenario fixtures
// ---------------------------------------------------------------------------
const NOWS = [
  new Date('2026-06-15T02:00:00Z'), // Brisbane noon (jest pins TZ, see jest.globalSetup.js)
  new Date('2026-01-01T13:00:00Z'), // Jan 1, 23:00 local
  new Date('2026-12-31T14:30:00Z'), // Jan 1 00:30 local: just past New Year
];

describe('planScenario', () => {
  it('produces each scenario count, never after now', () => {
    for (const now of NOWS) {
      for (const name of QA_SCENARIOS) {
        const { plans } = planScenario(name, now);
        expect(plans).toHaveLength(SCENARIO_SPECS[name].count);
        for (const p of plans) expect(Date.parse(p.date)).toBeLessThanOrEqual(now.getTime());
      }
    }
  });

  it('is deterministic: same scenario + same now = identical plans and RNG stream', () => {
    for (const name of QA_SCENARIOS) {
      const a = planScenario(name, NOWS[0]);
      const b = planScenario(name, NOWS[0]);
      expect(a.plans).toEqual(b.plans);
      expect([a.rng(), a.rng()]).toEqual([b.rng(), b.rng()]);
    }
  });

  it('week: every entry falls on one of the 7 local days ending today', () => {
    for (const now of NOWS) {
      const lastWeek = new Set(
        Array.from({ length: 7 }, (_, i) => {
          const d = new Date(now);
          d.setDate(d.getDate() - i);
          return localDateString(d);
        })
      );
      for (const p of planScenario('week', now).plans) {
        expect(lastWeek).toContain(localDateString(new Date(p.date)));
      }
    }
  });

  it('timeline300: has the production-shaped mix (multi-entry days, photos, stars, notes)', () => {
    const { plans } = planScenario('timeline300', NOWS[0]);
    const days = new Set(plans.map((p) => localDateString(new Date(p.date))));
    expect(days.size).toBeLessThan(plans.length); // some days hold several entries
    expect(plans.some((p) => p.photoCount > 0)).toBe(true);
    expect(plans.some((p) => p.starred)).toBe(true);
    expect(plans.some((p) => p.notes === '')).toBe(true);
    expect(plans.some((p) => p.notes.length > 80)).toBe(true);
  });

  it('yearBoundary: spans the New Year whatever now is', () => {
    for (const now of [...NOWS, new Date('2026-01-02T00:00:00Z')]) {
      const years = new Set(planScenario('yearBoundary', now).plans.map((p) => new Date(p.date).getFullYear()));
      expect(years.size).toBe(2);
    }
  });

  it('yearBoundaryAnchor: local Jan 3 noon of this year, or last year when that is still ahead', () => {
    const mid = yearBoundaryAnchor(new Date(2026, 5, 15));
    expect([mid.getFullYear(), mid.getMonth(), mid.getDate(), mid.getHours()]).toEqual([2026, 0, 3, 12]);
    expect(yearBoundaryAnchor(new Date(2026, 0, 2)).getFullYear()).toBe(2025);
    const exact = new Date(2026, 0, 3, 12);
    expect(yearBoundaryAnchor(exact).getTime()).toBe(exact.getTime());
  });

  // The golden for bd4d82d stands on this: the previous month's Stats, with enough
  // entries for the card to speak and every one of them in a single part of the day.
  it('oneBucket: the previous month alone holds a one-bucket Time of Day that speaks', () => {
    const now = new Date(2026, 10, 3, 10, 0, 0);
    const { plans } = planScenario('oneBucket', now);
    const october = plans
      .filter((p) => new Date(p.date).getMonth() === 9)
      .map((p) => ({ date: p.date, mood: p.mood }));
    const data = aggregateTimeOfDay(october);
    expect(data.hasEnoughData).toBe(true);
    expect(timeOfDayCallout(data)).toEqual({ kind: 'single', label: 'Morning' });
    // The counterfactual: the planner on its own spreads a day's entries around.
    const spread = planScenario('timeline300', now).plans.map((p) => ({ date: p.date, mood: p.mood }));
    expect(aggregateTimeOfDay(spread).buckets.filter((b) => b.entry_count > 0).length).toBeGreaterThan(1);
  });

  it('oneBucket: an hour past the clock never produces a future entry, and the count holds', () => {
    const earlyMorning = new Date(2026, 10, 3, 6, 0, 0);
    const { plans } = planScenario('oneBucket', earlyMorning);
    expect(plans).toHaveLength(SCENARIO_SPECS.oneBucket.count);
    expect(plans.every((p) => Date.parse(p.date) <= earlyMorning.getTime())).toBe(true);
  });

  it('seededRng: deterministic, in [0, 1), seed-dependent', () => {
    const a = seededRng(42);
    const b = seededRng(42);
    const xs = Array.from({ length: 100 }, () => a());
    expect(xs).toEqual(Array.from({ length: 100 }, () => b()));
    for (const x of xs) expect(x >= 0 && x < 1).toBe(true);
    expect(seededRng(43)()).not.toBe(xs[0]);
  });
});

// ---------------------------------------------------------------------------
// 3. runSeed on a real SQLite engine
// ---------------------------------------------------------------------------
const NOW = '2026-06-15T02:00:00.000Z';

describeSqlite('runSeed (real SQLite, shipped schema)', () => {
  let db: SqliteAdapter;
  let bump: jest.SpyInstance;

  beforeEach(async () => {
    resetWriteLayer();
    __resetDatabaseReadinessForTests();
    __resetRunSeedForTests();
    db = await openMigratedSqlite();
    __setWriteConnectionForTests(db as never);
    markDatabaseInitialized();
    bump = jest.spyOn(dataRefreshStore, 'bumpDataVersion');
    (FileSystem.writeAsStringAsync as jest.Mock).mockClear();
  });
  afterEach(() => bump.mockRestore());

  const seed = (scenario: (typeof QA_SCENARIOS)[number], now = NOW) =>
    runSeed({ scenario, now: new Date(now) }, { readyTimeoutMs: 50 });

  const marker = () =>
    db.raw.prepare('SELECT value FROM user_settings WHERE key = ?').get(QA_SEEDED_SETTING_KEY) as
      | { value: string }
      | undefined;

  it.each(QA_SCENARIOS)('%s: writes exactly the planned rows, the marker, and broadcasts a reload', async (scenario) => {
    const result = await seed(scenario);
    const expected = SCENARIO_SPECS[scenario].count;
    expect(result).toEqual({ ok: true, scenario, entries: expected, now: NOW });
    expect(countRows(db, 'entries')).toBe(expected);
    expect(marker()).toEqual({ value: scenario });
    expect(bump).toHaveBeenCalledTimes(1);
    const { plans } = planScenario(scenario, new Date(NOW));
    const photos = plans.reduce((n, p) => n + p.photoCount, 0);
    expect(countRows(db, 'entry_media')).toBe(photos);
    // Photos only touch the disk when the plan has any.
    expect((FileSystem.writeAsStringAsync as jest.Mock).mock.calls.length > 0).toBe(photos > 0);
  });

  it('stores the planned dates, moods and notes', async () => {
    await seed('week');
    const rows = db.raw.prepare('SELECT mood, notes, date FROM entries ORDER BY id').all();
    const { plans } = planScenario('week', new Date(NOW));
    expect(rows).toEqual(plans.map((p) => ({ mood: p.mood, notes: p.notes, date: p.date })));
  });

  it('is deterministic across runs (row content ignoring on-disk photo names)', async () => {
    const snapshot = () => ({
      entries: db.raw.prepare('SELECT id, mood, notes, date, starred_at FROM entries ORDER BY id').all(),
      activities: db.raw.prepare('SELECT entry_id, activity_id FROM entry_activities ORDER BY entry_id, activity_id').all(),
      media: db.raw.prepare('SELECT entry_id FROM entry_media ORDER BY entry_id').all(),
    });
    expect(await seed('timeline300')).toMatchObject({ ok: true });
    const first = snapshot();
    expect(first.entries).toHaveLength(300); // never compare two empty tables
    expect(await seed('timeline300')).toMatchObject({ ok: true });
    expect(snapshot()).toEqual(first);
  });

  it('a reseed REPLACES the previous seed (reset first, never appends)', async () => {
    await seed('timeline300');
    expect(await seed('week')).toMatchObject({ ok: true });
    expect(countRows(db, 'entries')).toBe(SCENARIO_SPECS.week.count);
    expect(marker()).toEqual({ value: 'week' });
  });

  it("REFUSES to wipe a person's data: entries without the QA marker", async () => {
    db.raw.prepare('INSERT INTO entries (mood, notes, date) VALUES (?, ?, ?)').run(7, 'mine', NOW);
    expect(await seed('week')).toEqual({ ok: false, error: 'foreign-data' });
    expect(db.raw.prepare('SELECT mood, notes FROM entries').all()).toEqual([{ mood: 7, notes: 'mine' }]);
    expect(marker()).toBeUndefined();
    expect(bump).not.toHaveBeenCalled();
  });

  it('entries that only sit in the recycle bin count as a person\'s data too', async () => {
    db.raw
      .prepare('INSERT INTO entries (mood, notes, date, deleted_at) VALUES (?, ?, ?, ?)')
      .run(4, 'binned', NOW, NOW);
    expect(await seed('week')).toEqual({ ok: false, error: 'foreign-data' });
    expect(countRows(db, 'entries')).toBe(1);
  });

  it('a database with settings but no entries (fresh install) is seedable', async () => {
    expect(countRows(db, 'user_settings')).toBeGreaterThan(0);
    expect(await seed('empty')).toMatchObject({ ok: true });
  });

  it('single-flight: a second command while one runs is rejected as busy', async () => {
    const first = seed('week');
    const second = seed('empty');
    expect(await second).toEqual({ ok: false, error: 'busy' });
    expect(await first).toMatchObject({ ok: true, scenario: 'week' });
    // The latch is released afterwards.
    expect(await seed('empty')).toMatchObject({ ok: true });
  });

  it('waits for initializeDatabase, and gives up (writing nothing) when it never finishes', async () => {
    __resetDatabaseReadinessForTests();
    expect(await seed('week')).toEqual({ ok: false, error: 'db-not-ready' });
    expect(countRows(db, 'entries')).toBe(0);
    expect(marker()).toBeUndefined();

    const pending = runSeed({ scenario: 'empty', now: new Date(NOW) }, { readyTimeoutMs: 5_000 });
    markDatabaseInitialized();
    expect(await pending).toMatchObject({ ok: true });
  });

  it('a failed write reports write-failed, rolls the rows back, and still broadcasts (the reset happened)', async () => {
    (FileSystem.writeAsStringAsync as jest.Mock).mockRejectedValueOnce(new Error('disk full'));
    expect(await seed('timeline300')).toEqual({ ok: false, error: 'write-failed' });
    expect(countRows(db, 'entries')).toBe(0);
    expect(marker()).toBeUndefined();
    expect(bump).toHaveBeenCalledTimes(1);
  });

  // ── the frozen app clock (lib/clock.ts) ──────────────────────────────────
  const frozenRow = () =>
    db.raw.prepare('SELECT value FROM user_settings WHERE key = ?').get(QA_FROZEN_NOW_SETTING_KEY) as
      | { value: string }
      | undefined;

  it("freezes the app clock at the link's now, and persists it for a relaunch", async () => {
    await seed('week');
    expect(now().toISOString()).toBe(NOW);
    expect(frozenRow()).toEqual({ value: NOW });
  });

  it('a link without now UNFREEZES the clock and anchors the fixture at the real present', async () => {
    freezeNow(new Date('2030-01-01T00:00:00Z')); // an earlier seed's freeze
    const before = Date.now();
    const result = await runSeed({ scenario: 'week' }, { readyTimeoutMs: 50 });
    expect(result.ok && Date.parse(result.now)).toBeGreaterThanOrEqual(before);
    expect(Math.abs(now().getTime() - Date.now())).toBeLessThan(5_000);
    expect(frozenRow()).toBeUndefined();
  });

  it('a refused or failed seed never freezes, and a refusal leaves an earlier freeze alone', async () => {
    const earlier = freezeNow(new Date('2030-01-01T00:00:00Z'));
    db.raw.prepare('INSERT INTO entries (mood, notes, date) VALUES (?, ?, ?)').run(7, 'mine', NOW);
    await seed('week');
    expect(now().getTime()).toBe(earlier.getTime());

    db.raw.prepare('DELETE FROM entries').run();
    (FileSystem.writeAsStringAsync as jest.Mock).mockRejectedValueOnce(new Error('disk full'));
    expect(await seed('timeline300')).toMatchObject({ error: 'write-failed' });
    expect(now().getTime()).not.toBe(Date.parse(NOW));
    expect(frozenRow()).toBeUndefined();
  });

  it('restoreFrozenClock re-applies the stored instant after a relaunch, and broadcasts', async () => {
    await seed('week');
    unfreezeNow(); // the relaunch: in-memory freeze gone, the row survives
    bump.mockClear();
    expect((await restoreFrozenClock({ readyTimeoutMs: 50 }))?.toISOString()).toBe(NOW);
    expect(now().toISOString()).toBe(NOW);
    expect(bump).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['no stored instant', null],
    ['a tampered row', "'; DROP TABLE entries; --"],
    ['an out-of-range year', '1970-01-01T00:00:00Z'],
  ])('restoreFrozenClock freezes nothing on %s', async (_, value) => {
    if (value !== null) {
      db.raw.prepare('INSERT INTO user_settings (key, value) VALUES (?, ?)').run(QA_FROZEN_NOW_SETTING_KEY, value);
    }
    expect(await restoreFrozenClock({ readyTimeoutMs: 50 })).toBeNull();
    expect(Math.abs(now().getTime() - Date.now())).toBeLessThan(5_000);
    expect(bump).not.toHaveBeenCalled();
  });

  it('restoreFrozenClock gives up when the database never initializes', async () => {
    __resetDatabaseReadinessForTests();
    expect(await restoreFrozenClock({ readyTimeoutMs: 20 })).toBeNull();
  });

  it('defaults now to the real clock when the link has none', async () => {
    const before = Date.now();
    const result = await runSeed({ scenario: 'week' }, { readyTimeoutMs: 50 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(Date.parse(result.now)).toBeGreaterThanOrEqual(before);
  });
});
