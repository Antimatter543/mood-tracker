/**
 * __tests__/healthMoodCorrelation.test.ts
 *
 * Exhaustive tests for the pure sleep↔mood / heart-rate↔mood transforms.
 *
 * Runs under the Brisbane TZ pin (jest.tz.js, UTC+10). The join here is a plain
 * LOCAL-day string-key match (both sides are already local-day-keyed upstream),
 * so there's no TZ math IN the transform — but we assert the day-key/wake-day
 * conventions explicitly so a regression that breaks the pairing is caught.
 */
import {
  sleepMoodCorrelation,
  heartRateMoodCorrelation,
  restingHeartRateMoodCorrelation,
  hrvMoodCorrelation,
  MIN_PAIRS,
  FLAT_R_BAND,
  type HealthMetricDay,
  type MetricMoodCorrelation,
  type MetricMoodResult,
} from '@/components/visualisations/transforms/healthMoodCorrelation';

// ── builders ────────────────────────────────────────────────────────────────

const hRow = (
  date: string,
  opts: {
    sleep?: number | null;
    avgHr?: number | null;
    minHr?: number | null;
    hrv?: number | null;
  } = {}
): HealthMetricDay => ({
  date,
  sleepTotalMinutes: opts.sleep ?? null,
  avgHeartRate: opts.avgHr ?? null,
  minHeartRate: opts.minHr ?? null,
  avgHrvMillis: opts.hrv ?? null,
});

const dm = (day: string, avg: number) => ({ day, avg });

/** Sequential local days 'YYYY-06-01', '...-02', ... for N entries. */
const days = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => `2026-06-${String(i + 1).padStart(2, '0')}`);

/** Narrow to the `ok` branch (throws with a clear message if not). */
function ok(c: MetricMoodCorrelation): MetricMoodResult {
  expect(c.status).toBe('ok');
  if (c.status !== 'ok') throw new Error(`expected ok, got ${c.status}`);
  return c;
}

// A clean POSITIVE fixture: more sleep → better mood, 8 paired days.
const POS_DATES = days(8);
const POS_SLEEP = [300, 360, 390, 420, 450, 480, 510, 540];
const POS_MOOD = [3, 4, 4, 5, 6, 6, 7, 8];
const posRows = POS_DATES.map((d, i) => hRow(d, { sleep: POS_SLEEP[i] }));
const posMoods = POS_DATES.map((d, i) => dm(d, POS_MOOD[i]));

// ── MIN_PAIRS / not-enough-data gating ───────────────────────────────────────

describe('gating on MIN_PAIRS', () => {
  it('MIN_PAIRS is the documented threshold (7)', () => {
    // A change to this constant is a product decision, not an accident.
    expect(MIN_PAIRS).toBe(7);
    expect(FLAT_R_BAND).toBeGreaterThan(0);
  });

  it('empty inputs → notEnoughData with 0 pairs, never throws', () => {
    const c = sleepMoodCorrelation([], []);
    expect(c).toEqual({ status: 'notEnoughData', pairCount: 0, pairs: [] });
  });

  it('a single paired day → notEnoughData (pairCount 1)', () => {
    const c = sleepMoodCorrelation([hRow('2026-06-01', { sleep: 480 })], [dm('2026-06-01', 6)]);
    expect(c.status).toBe('notEnoughData');
    expect(c.pairCount).toBe(1);
  });

  it('below MIN_PAIRS → notEnoughData; pairs are sorted ascending by metric', () => {
    const d = days(3);
    const rows = [
      hRow(d[0], { sleep: 500 }),
      hRow(d[1], { sleep: 300 }),
      hRow(d[2], { sleep: 400 }),
    ];
    const moods = [dm(d[0], 7), dm(d[1], 4), dm(d[2], 5)];
    const c = sleepMoodCorrelation(rows, moods);
    expect(c.status).toBe('notEnoughData');
    expect(c.pairCount).toBe(3);
    expect(c.pairs.map((p) => p.metric)).toEqual([300, 400, 500]);
  });

  it('exactly MIN_PAIRS-1 paired days is still notEnoughData', () => {
    const d = days(MIN_PAIRS - 1);
    const rows = d.map((day, i) => hRow(day, { sleep: 300 + i * 30 }));
    const moods = d.map((day, i) => dm(day, 3 + i));
    expect(sleepMoodCorrelation(rows, moods).status).toBe('notEnoughData');
    expect(sleepMoodCorrelation(rows, moods).pairCount).toBe(MIN_PAIRS - 1);
  });

  it('exactly MIN_PAIRS paired days crosses into an ok result', () => {
    const d = days(MIN_PAIRS);
    const rows = d.map((day, i) => hRow(day, { sleep: 300 + i * 30 }));
    const moods = d.map((day, i) => dm(day, 3 + i));
    expect(sleepMoodCorrelation(rows, moods).status).toBe('ok');
  });
});

// ── correlation direction + median split ─────────────────────────────────────

describe('sleepMoodCorrelation — direction & split', () => {
  it('positive: longer-sleep half has higher average mood', () => {
    const r = ok(sleepMoodCorrelation(posRows, posMoods));
    expect(r.pairCount).toBe(8);
    // median (rank) split: 4 low-sleep vs 4 high-sleep days.
    expect(r.lower.count).toBe(4);
    expect(r.upper.count).toBe(4);
    expect(r.lower.avgMood).toBe(4.0); // (3+4+4+5)/4
    expect(r.upper.avgMood).toBe(6.8); // (6+6+7+8)/4 = 6.75 → 6.8 (1 dp)
    expect(r.lower.avgMetric).toBe(367.5); // (300+360+390+420)/4
    expect(r.upper.avgMetric).toBe(495); // (450+480+510+540)/4
    expect(r.moodDelta).toBe(2.8); // 6.8 − 4.0, from the rounded halves
    expect(r.direction).toBe('positive');
    expect(r.r).not.toBeNull();
    expect(r.r!).toBeGreaterThan(0.9);
    // pairs sorted ascending by metric, ready for a scatter.
    expect(r.pairs.map((p) => p.metric)).toEqual([...POS_SLEEP]);
  });

  it('negative: same sleep, reversed mood → shorter-sleep half higher, negative r', () => {
    const moods = POS_DATES.map((d, i) => dm(d, [8, 7, 6, 6, 5, 4, 4, 3][i]));
    const r = ok(sleepMoodCorrelation(posRows, moods));
    expect(r.lower.avgMood).toBe(6.8); // (8+7+6+6)/4 = 6.75 → 6.8
    expect(r.upper.avgMood).toBe(4.0); // (5+4+4+3)/4
    expect(r.moodDelta).toBe(-2.8);
    expect(r.direction).toBe('negative');
    expect(r.r!).toBeLessThan(-0.9);
  });

  it('flat via constant mood: r is null (undefined), direction flat, moodDelta 0', () => {
    const moods = POS_DATES.map((d) => dm(d, 5));
    const r = ok(sleepMoodCorrelation(posRows, moods));
    expect(r.r).toBeNull(); // zero mood variance → r genuinely undefined, not 0
    expect(r.direction).toBe('flat');
    expect(r.moodDelta).toBe(0);
  });

  it('flat via constant metric: r is null, direction flat (no meaningful high/low)', () => {
    const rows = POS_DATES.map((d) => hRow(d, { sleep: 480 }));
    const moods = POS_DATES.map((d, i) => dm(d, [3, 4, 5, 6, 7, 8, 4, 5][i]));
    const r = ok(sleepMoodCorrelation(rows, moods));
    expect(r.r).toBeNull();
    expect(r.direction).toBe('flat');
  });

  it('flat via near-zero r: symmetric mood over evenly-spaced sleep → r 0, flat', () => {
    // Evenly-spaced metric + mood symmetric about the middle → covariance 0.
    const rows = POS_DATES.map((d, i) => hRow(d, { sleep: 300 + i * 30 }));
    const moods = POS_DATES.map((d, i) => dm(d, [5, 5, 6, 6, 6, 6, 5, 5][i]));
    const r = ok(sleepMoodCorrelation(rows, moods));
    expect(r.r).not.toBeNull();
    expect(Math.abs(r.r!)).toBeLessThan(FLAT_R_BAND);
    expect(r.direction).toBe('flat');
    expect(r.moodDelta).toBe(0);
  });

  it('odd pair count: median day falls into the upper half (both halves non-empty)', () => {
    const d = days(7);
    const rows = d.map((day, i) => hRow(day, { sleep: 300 + i * 30 }));
    const moods = d.map((day, i) => dm(day, 3 + i));
    const r = ok(sleepMoodCorrelation(rows, moods));
    expect(r.lower.count).toBe(3); // floor(7/2)
    expect(r.upper.count).toBe(4);
  });
});

// ── p-value on the result (significance layer) ───────────────────────────────

describe('MetricMoodResult.pValue', () => {
  it('a directional (≥MIN_PAIRS) result carries a finite p-value in [0,1]', () => {
    const r = ok(sleepMoodCorrelation(posRows, posMoods));
    expect(r.r).not.toBeNull();
    expect(r.pValue).not.toBeNull();
    expect(Number.isFinite(r.pValue!)).toBe(true);
    expect(r.pValue!).toBeGreaterThanOrEqual(0);
    expect(r.pValue!).toBeLessThanOrEqual(1);
    // A strong positive r over 8 days is significant-ish, not p=1.
    expect(r.pValue!).toBeLessThan(0.05);
  });

  it('a zero-variance (constant mood) result has r=null AND pValue=null', () => {
    const moods = POS_DATES.map((d) => dm(d, 5));
    const r = ok(sleepMoodCorrelation(posRows, moods));
    expect(r.r).toBeNull();
    expect(r.pValue).toBeNull();
  });

  it('a near-zero (flat) r still gets a finite p-value (the honest nerdy detail)', () => {
    const rows = POS_DATES.map((d, i) => hRow(d, { sleep: 300 + i * 30 }));
    const moods = POS_DATES.map((d, i) => dm(d, [5, 5, 6, 6, 6, 6, 5, 5][i]));
    const r = ok(sleepMoodCorrelation(rows, moods));
    expect(r.direction).toBe('flat');
    expect(r.r).not.toBeNull();
    expect(r.pValue).not.toBeNull();
    expect(r.pValue!).toBeGreaterThanOrEqual(0);
    expect(r.pValue!).toBeLessThanOrEqual(1);
  });

  it('notEnoughData results carry no pValue field (variant unchanged)', () => {
    const c = sleepMoodCorrelation([], []);
    expect(c.status).toBe('notEnoughData');
    expect(c).toEqual({ status: 'notEnoughData', pairCount: 0, pairs: [] });
    expect('pValue' in c).toBe(false);
  });
});

// ── day-key / wake-day / pairing correctness ─────────────────────────────────

describe('pairing correctness', () => {
  it('pairs only days present in BOTH sources (health-only + mood-only days dropped)', () => {
    // 8 health days, but mood logged on only 3 of them → 3 pairs → notEnoughData.
    const d = days(8);
    const rows = d.map((day, i) => hRow(day, { sleep: 300 + i * 30 }));
    const moods = [dm(d[0], 4), dm(d[3], 6), dm(d[6], 7), dm('2099-01-01', 9)];
    const c = sleepMoodCorrelation(rows, moods);
    expect(c.status).toBe('notEnoughData');
    expect(c.pairCount).toBe(3);
    expect(c.pairs.map((p) => p.date).sort()).toEqual([d[0], d[3], d[6]]);
  });

  it('wake-day attribution: sleep dated to the wake day pairs with THAT day’s mood', () => {
    // A night attributed to wake-day 2026-06-11 must pair with the 11th's mood,
    // never the 10th's (mirrors lib/healthConnectPure sleepSessionWakeDay).
    const c = sleepMoodCorrelation(
      [hRow('2026-06-11', { sleep: 480 })],
      [dm('2026-06-10', 9), dm('2026-06-11', 3)]
    );
    expect(c.pairs).toEqual([{ date: '2026-06-11', metric: 480, mood: 3 }]);
  });

  it('string-key match is exact — a mismatched day never pairs', () => {
    const c = sleepMoodCorrelation(
      [hRow('2026-06-11', { sleep: 480 })],
      [dm('2026-06-12', 8)]
    );
    expect(c.pairs).toEqual([]);
  });
});

// ── metric filtering (garbage never becomes a data point) ────────────────────

describe('metric filtering', () => {
  it('sleep: null / 0 / negative totals are dropped', () => {
    const d = days(4);
    const rows = [
      hRow(d[0], { sleep: null }),
      hRow(d[1], { sleep: 0 }),
      hRow(d[2], { sleep: -60 }),
      hRow(d[3], { sleep: 420 }),
    ];
    const moods = d.map((day) => dm(day, 5));
    const c = sleepMoodCorrelation(rows, moods);
    expect(c.pairs).toEqual([{ date: d[3], metric: 420, mood: 5 }]);
  });

  it('heart rate uses avgHeartRate, not minHeartRate', () => {
    // avgHeartRate is null on every row (only minHeartRate present) → no HR pairs.
    const d = days(8);
    const rows = d.map((day, i) => hRow(day, { avgHr: null, minHr: 50 + i }));
    const moods = d.map((day, i) => dm(day, 3 + i));
    const c = heartRateMoodCorrelation(rows, moods);
    expect(c.status).toBe('notEnoughData');
    expect(c.pairCount).toBe(0);
  });

  it('sleep and heart rate are independent metrics on the same rows', () => {
    // Every row has sleep; only some have avg HR → different pair counts.
    const d = days(8);
    const rows = d.map((day, i) =>
      hRow(day, { sleep: 300 + i * 30, avgHr: i < 3 ? 60 + i : null })
    );
    const moods = d.map((day, i) => dm(day, 3 + i));
    expect(sleepMoodCorrelation(rows, moods).pairCount).toBe(8);
    expect(heartRateMoodCorrelation(rows, moods).pairCount).toBe(3);
  });
});

// ── heart-rate correlation basics ────────────────────────────────────────────

describe('heartRateMoodCorrelation', () => {
  it('negative: higher heart rate goes with lower mood', () => {
    const d = days(8);
    const hr = [55, 58, 60, 62, 65, 68, 72, 80];
    const mood = [8, 7, 7, 6, 5, 5, 4, 3];
    const rows = d.map((day, i) => hRow(day, { avgHr: hr[i] }));
    const moods = d.map((day, i) => dm(day, mood[i]));
    const r = ok(heartRateMoodCorrelation(rows, moods));
    expect(r.lower.avgMood).toBe(7.0); // low-HR half: (8+7+7+6)/4
    expect(r.upper.avgMood).toBe(4.3); // high-HR half: (5+5+4+3)/4 = 4.25 → 4.3
    expect(r.moodDelta).toBe(-2.7); // 4.3 − 7.0
    expect(r.direction).toBe('negative');
    expect(r.r!).toBeLessThan(-0.9);
  });
});

// ── resting heart-rate correlation (keys on minHeartRate) ────────────────────

describe('restingHeartRateMoodCorrelation', () => {
  it('keys on minHeartRate, not avgHeartRate', () => {
    // Only minHeartRate present → resting HR pairs; avg is null → HR pairs 0.
    const d = days(8);
    const rows = d.map((day, i) => hRow(day, { avgHr: null, minHr: 48 + i }));
    const moods = d.map((day, i) => dm(day, 3 + i));
    expect(restingHeartRateMoodCorrelation(rows, moods).status).toBe('ok');
    expect(restingHeartRateMoodCorrelation(rows, moods).pairCount).toBe(8);
    expect(heartRateMoodCorrelation(rows, moods).pairCount).toBe(0);
  });

  it('positive: higher resting HR half has higher mood (uses the min column)', () => {
    const d = days(8);
    const minHr = [48, 50, 52, 54, 56, 58, 60, 62];
    const mood = [3, 4, 4, 5, 6, 6, 7, 8];
    const rows = d.map((day, i) => hRow(day, { minHr: minHr[i] }));
    const moods = d.map((day, i) => dm(day, mood[i]));
    const r = ok(restingHeartRateMoodCorrelation(rows, moods));
    expect(r.lower.avgMood).toBe(4.0);
    expect(r.upper.avgMood).toBe(6.8);
    expect(r.moodDelta).toBe(2.8);
    expect(r.direction).toBe('positive');
  });

  it('drops null / non-positive resting-HR values', () => {
    const d = days(4);
    const rows = [
      hRow(d[0], { minHr: null }),
      hRow(d[1], { minHr: 0 }),
      hRow(d[2], { minHr: -5 }),
      hRow(d[3], { minHr: 55 }),
    ];
    const moods = d.map((day) => dm(day, 5));
    expect(restingHeartRateMoodCorrelation(rows, moods).pairs).toEqual([
      { date: d[3], metric: 55, mood: 5 },
    ]);
  });
});

// ── HRV correlation (keys on avgHrvMillis) ───────────────────────────────────

describe('hrvMoodCorrelation', () => {
  it('keys on avgHrvMillis and is independent of the HR metrics', () => {
    const d = days(8);
    // HRV present on all 8; avg/min HR only on 3 → different pair counts.
    const rows = d.map((day, i) =>
      hRow(day, { hrv: 30 + i * 4, avgHr: i < 3 ? 60 : null })
    );
    const moods = d.map((day, i) => dm(day, 3 + i));
    expect(hrvMoodCorrelation(rows, moods).pairCount).toBe(8);
    expect(heartRateMoodCorrelation(rows, moods).pairCount).toBe(3);
  });

  it('positive: higher-HRV half has higher mood', () => {
    const d = days(8);
    const hrv = [22, 28, 33, 40, 46, 52, 60, 71];
    const mood = [3, 4, 4, 5, 6, 6, 7, 8];
    const rows = d.map((day, i) => hRow(day, { hrv: hrv[i] }));
    const moods = d.map((day, i) => dm(day, mood[i]));
    const r = ok(hrvMoodCorrelation(rows, moods));
    expect(r.direction).toBe('positive');
    expect(r.upper.avgMood).toBeGreaterThan(r.lower.avgMood);
  });

  it('sparse HRV (below MIN_PAIRS) → notEnoughData, never throws', () => {
    const d = days(8);
    // Only 3 days carry HRV.
    const rows = d.map((day, i) =>
      hRow(day, { hrv: i < 3 ? 40 + i : null })
    );
    const moods = d.map((day, i) => dm(day, 3 + i));
    const c = hrvMoodCorrelation(rows, moods);
    expect(c.status).toBe('notEnoughData');
    expect(c.pairCount).toBe(3);
  });

  it('drops null / non-positive HRV values', () => {
    const d = days(3);
    const rows = [
      hRow(d[0], { hrv: null }),
      hRow(d[1], { hrv: 0 }),
      hRow(d[2], { hrv: 45 }),
    ];
    const moods = d.map((day) => dm(day, 5));
    expect(hrvMoodCorrelation(rows, moods).pairs).toEqual([
      { date: d[2], metric: 45, mood: 5 },
    ]);
  });
});

// ── never throws on degenerate input ─────────────────────────────────────────

describe('degenerate input never throws', () => {
  it('tolerates null rows, null dates, and non-finite moods', () => {
    const run = () =>
      sleepMoodCorrelation(
        [
          null as unknown as HealthMetricDay,
          { date: null as unknown as string, sleepTotalMinutes: 480, avgHeartRate: null, minHeartRate: null, avgHrvMillis: null },
          hRow('2026-06-01', { sleep: 480 }),
        ],
        [
          dm('2026-06-01', NaN),
          { day: null as unknown as string, avg: 5 },
          dm('2026-06-01', 5),
        ]
      );
    expect(run).not.toThrow();
    const c = run();
    // Only the one valid (date+metric+mood) triple survives.
    expect(c.pairs).toEqual([{ date: '2026-06-01', metric: 480, mood: 5 }]);
  });
});
