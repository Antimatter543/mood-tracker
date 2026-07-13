// healthMoodCorrelation.ts
//
// PURE transform: how a day's health signal (sleep total / heart rate) relates
// to that day's mood — the payoff of the Health Connect integration.
//
// DAY-KEYING / THE JOIN (load-bearing):
//   Both sides are ALREADY keyed to the user's LOCAL calendar day before they
//   reach here:
//     - health_metrics.date is a local 'YYYY-MM-DD' string (databases/
//       health-metrics.ts storage contract), and sleep is attributed to the
//       WAKE day (lib/healthConnectPure.ts sleepSessionWakeDay) — so "last
//       night's sleep" lines up with "how I feel today".
//     - mood is aggregated per local day via aggregateDailyAverages
//       (transforms/dailyAverages.ts), the one day-keying authority.
//   So the join is a plain STRING-KEY match on the local day. We deliberately do
//   NOT join in SQL: the project bans SQL day-bucketing of the UTC-instant
//   `entries.date` (queries.ts / dateHelpers.ts doctrine; enforced by
//   queriesNoDateBucketing.test.ts). Joining in this pure layer is both
//   doctrine-compliant and exhaustively testable.
//
// HONESTY WITH SMALL SAMPLES:
//   A correlation on a handful of days is noise. We require MIN_PAIRS paired
//   days before reporting a result; below that we return a `notEnoughData`
//   signal carrying the current pair count so the UI can say "X more days".
//   Above it we split the days at the median metric (rank split) into a
//   lower/upper half and compare average mood, and we suppress any directional
//   claim when |Pearson r| is within a flat band or a series has zero variance
//   (constant sleep, or constant mood — "no clear link" is itself an honest
//   finding, not a bug). Nothing here ever throws on empty/degenerate input.

import type { DailyAverage } from './dailyAverages';
import { pValueTwoSided } from './correlationStats';

/**
 * Minimum paired (health + mood) days before we report a sleep↔mood or
 * heart-rate↔mood pattern. A correlation on fewer days is noise, so below this
 * the UI shows a "keep logging" state instead of a number. Chosen at 7 (~a
 * week of overlap, ≥3 days per split half) — honesty-leaning within the 5–7
 * range, and the keep-logging copy tells the user exactly how many more days.
 */
export const MIN_PAIRS = 7;

/**
 * |Pearson r| at/above which we're willing to name a direction. Below it (or
 * when r is undefined for a constant series) we call it "no clear link" rather
 * than over-claiming noise. Deliberately low — we're describing the user's own
 * data honestly, not asserting statistical significance.
 */
export const FLAT_R_BAND = 0.1;

/** One local day where we have BOTH a health metric and a mood average. */
export interface MetricMoodPair {
  /** Local calendar day 'YYYY-MM-DD'. */
  date: string;
  /** The health metric value that day (sleep minutes, or bpm). Always finite & > 0. */
  metric: number;
  /** That day's average mood. */
  mood: number;
}

/** Averaged summary of one half of the metric range (lower vs upper). */
export interface HalfSummary {
  /** Number of days in this half. */
  count: number;
  /** Average metric value in this half (1 dp). */
  avgMetric: number;
  /** Average mood in this half (1 dp). */
  avgMood: number;
}

/** Direction of the health↔mood relationship, with a flat band for "no clear link". */
export type MetricMoodDirection = 'positive' | 'negative' | 'flat';

/** Not-enough-data signal: fewer than MIN_PAIRS paired days. */
export interface MetricMoodNotEnough {
  status: 'notEnoughData';
  /** How many paired days we DO have (< MIN_PAIRS). Powers the "X more days" copy. */
  pairCount: number;
  /** The pairs we have so far (sorted by metric asc), for any partial display. */
  pairs: MetricMoodPair[];
}

/** A computed correlation over ≥ MIN_PAIRS paired days. */
export interface MetricMoodResult {
  status: 'ok';
  pairCount: number;
  /** All pairs, ascending by metric (ready for a scatter/trend plot). */
  pairs: MetricMoodPair[];
  /** Lower-metric half (e.g. shorter-sleep / lower-HR days). */
  lower: HalfSummary;
  /** Upper-metric half (e.g. longer-sleep / higher-HR days). */
  upper: HalfSummary;
  /**
   * upper.avgMood − lower.avgMood (1 dp), computed from the ROUNDED half
   * averages so it always equals what the UI shows. Positive = better mood on
   * higher-metric days.
   */
  moodDelta: number;
  /** Pearson r over the pairs (2 dp), or null when either series has zero variance. */
  r: number | null;
  /**
   * Two-tailed p-value of the Pearson r over the paired days (null when r is
   * null). See correlationStats.pValueTwoSided.
   */
  pValue: number | null;
  /** Direction, flat-banded so a near-zero / undefined r reads as "no clear link". */
  direction: MetricMoodDirection;
}

export type MetricMoodCorrelation = MetricMoodNotEnough | MetricMoodResult;

/**
 * The minimal per-day health shape the correlation needs — a structural subset
 * of StoredHealthMetric, so DB rows pass straight in and this transform stays
 * native-free and DB-free (fully unit-testable).
 */
export interface HealthMetricDay {
  /** Local calendar day 'YYYY-MM-DD' (the health_metrics PK). */
  date: string;
  sleepTotalMinutes: number | null;
  avgHeartRate: number | null;
  /** Lowest bpm that day — the resting-HR proxy (see restingHeartRateMoodCorrelation). */
  minHeartRate: number | null;
  /**
   * Dedicated RestingHeartRate reading — the REAL resting HR (sources like
   * Fitbit write ~1/day), preferred over the minHeartRate proxy. Null when the
   * source emitted none, in which case the minHeartRate proxy is used instead.
   */
  restingHeartRate: number | null;
  /** Mean HRV (RMSSD, ms) that day, or null when the source emitted none. */
  avgHrvMillis: number | null;
}

/** The mood side: only the local day key + its average is needed (DailyAverage subset). */
type DailyMood = Pick<DailyAverage, 'day' | 'avg'>;

const round1 = (n: number): number => Math.round(n * 10) / 10;
const round2 = (n: number): number => Math.round(n * 100) / 100;

const mean = (xs: readonly number[]): number =>
  xs.reduce((sum, x) => sum + x, 0) / xs.length;

/**
 * Pearson correlation coefficient over the pairs, rounded to 2 dp and clamped to
 * [-1, 1]. Returns null when either series has zero variance (constant metric or
 * constant mood — r is genuinely undefined, not 0), or when there are < 2 pairs.
 */
function pearson(pairs: readonly MetricMoodPair[]): number | null {
  if (pairs.length < 2) return null;
  const mx = mean(pairs.map((p) => p.metric));
  const my = mean(pairs.map((p) => p.mood));
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (const p of pairs) {
    const dx = p.metric - mx;
    const dy = p.mood - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  if (vx === 0 || vy === 0) return null;
  const r = cov / Math.sqrt(vx * vy);
  return round2(Math.max(-1, Math.min(1, r)));
}

/** Averaged summary of a set of pairs (metric + mood, 1 dp). */
function summarize(pairs: readonly MetricMoodPair[]): HalfSummary {
  return {
    count: pairs.length,
    avgMetric: round1(mean(pairs.map((p) => p.metric))),
    avgMood: round1(mean(pairs.map((p) => p.mood))),
  };
}

/**
 * Pair each day that has BOTH a finite, positive metric value AND a mood average,
 * matched on the shared LOCAL day key. Days missing either side, or carrying a
 * garbage value (null / NaN / ≤ 0), are dropped. Never throws.
 */
function pairMetricWithMood(
  healthRows: ReadonlyArray<HealthMetricDay>,
  dailyMoods: ReadonlyArray<DailyMood>,
  extract: (row: HealthMetricDay) => number | null
): MetricMoodPair[] {
  const moodByDay = new Map<string, number>();
  for (const d of dailyMoods ?? []) {
    if (d && typeof d.day === 'string' && Number.isFinite(d.avg)) {
      moodByDay.set(d.day, d.avg);
    }
  }

  const pairs: MetricMoodPair[] = [];
  for (const row of healthRows ?? []) {
    if (!row || typeof row.date !== 'string') continue;
    const metric = extract(row);
    if (metric == null || !Number.isFinite(metric) || metric <= 0) continue;
    const mood = moodByDay.get(row.date);
    if (mood == null || !Number.isFinite(mood)) continue;
    pairs.push({ date: row.date, metric, mood });
  }
  return pairs;
}

/** Shape a set of pairs into a gated, median-split, direction-flagged result. */
function buildCorrelation(pairs: MetricMoodPair[]): MetricMoodCorrelation {
  // Ascending by metric; tie-break by date so the split + output are deterministic.
  const sorted = [...pairs].sort(
    (a, b) =>
      a.metric - b.metric || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)
  );
  const pairCount = sorted.length;

  if (pairCount < MIN_PAIRS) {
    return { status: 'notEnoughData', pairCount, pairs: sorted };
  }

  // Rank (median) split: lowest-`half` metric days vs the rest. Both halves are
  // non-empty for pairCount ≥ MIN_PAIRS. For an odd count the median day falls
  // into the upper half — deterministic, and it never empties a side.
  const half = Math.floor(pairCount / 2);
  const lower = summarize(sorted.slice(0, half));
  const upper = summarize(sorted.slice(half));

  const r = pearson(sorted);
  // Significance of that r over the paired days. Null when r is null (a
  // zero-variance series has no correlation to test).
  const pValue = pValueTwoSided(r ?? NaN, pairCount);
  // From the ROUNDED half averages, so it equals what the UI renders.
  const moodDelta = round1(upper.avgMood - lower.avgMood);
  const direction: MetricMoodDirection =
    r == null || Math.abs(r) < FLAT_R_BAND
      ? 'flat'
      : r > 0
        ? 'positive'
        : 'negative';

  return { status: 'ok', pairCount, pairs: sorted, lower, upper, moodDelta, r, pValue, direction };
}

/**
 * Correlate nightly sleep TOTAL (minutes, attributed to the wake day) with that
 * day's mood. See module header for the honesty gates.
 */
export function sleepMoodCorrelation(
  healthRows: ReadonlyArray<HealthMetricDay>,
  dailyMoods: ReadonlyArray<DailyMood>
): MetricMoodCorrelation {
  return buildCorrelation(
    pairMetricWithMood(healthRows, dailyMoods, (row) => row.sleepTotalMinutes)
  );
}

/**
 * Correlate a day's AVERAGE heart rate (bpm) with that day's mood. Uses
 * avgHeartRate (the day-representative value); minHeartRate powers the separate
 * {@link restingHeartRateMoodCorrelation}. Same honesty gates.
 */
export function heartRateMoodCorrelation(
  healthRows: ReadonlyArray<HealthMetricDay>,
  dailyMoods: ReadonlyArray<DailyMood>
): MetricMoodCorrelation {
  return buildCorrelation(
    pairMetricWithMood(healthRows, dailyMoods, (row) => row.avgHeartRate)
  );
}

/**
 * Correlate a day's RESTING heart rate with that day's mood. Prefers the
 * dedicated RestingHeartRate reading (`restingHeartRate` — the REAL resting HR
 * that sources like Fitbit write ~1/day) and falls back to `minHeartRate`, the
 * day's lowest bpm, as an intraday-min proxy when no dedicated reading exists. A
 * lower resting HR is generally the "recovered" signal, so this often reads
 * oppositely to average HR. Same honesty gates.
 */
export function restingHeartRateMoodCorrelation(
  healthRows: ReadonlyArray<HealthMetricDay>,
  dailyMoods: ReadonlyArray<DailyMood>
): MetricMoodCorrelation {
  return buildCorrelation(
    pairMetricWithMood(
      healthRows,
      dailyMoods,
      (row) => row.restingHeartRate ?? row.minHeartRate
    )
  );
}

/**
 * Correlate a day's AVERAGE HRV (RMSSD, ms) with that day's mood. HRV is optional
 * and sparse (many sources never emit it), so most users will stay below MIN_PAIRS
 * here — the honesty gate handles that with the "keep logging" state. Same gates.
 */
export function hrvMoodCorrelation(
  healthRows: ReadonlyArray<HealthMetricDay>,
  dailyMoods: ReadonlyArray<DailyMood>
): MetricMoodCorrelation {
  return buildCorrelation(
    pairMetricWithMood(healthRows, dailyMoods, (row) => row.avgHrvMillis)
  );
}
