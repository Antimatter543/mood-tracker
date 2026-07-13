// moodMetricOverlay.ts
//
// PURE transform for the "mood × metric over time" overlay card: align a day's
// mood with a day's health metric across a recent window into one row per day.
//
// DAY-KEYING / THE JOIN (load-bearing, same doctrine as healthMoodCorrelation):
//   Both sides are ALREADY keyed to the user's LOCAL calendar day upstream —
//   health_metrics.date is a local 'YYYY-MM-DD' (sleep attributed to the WAKE
//   day), mood is aggregated per local day via aggregateDailyAverages. So the
//   join is a plain string-key match; window enumeration uses `addDays`
//   (local/DST-safe, never `new Date('YYYY-MM-DD')` which is a UTC parse and
//   shifts the day for users west of UTC).
//
// The window is the LAST `windowDays` calendar days ending at the most recent day
// that has ANY data (mood OR metric), tightened to the actual data span so a
// short history isn't padded with empty leading slots. Missing days are `null`
// on their side (rendered as gaps, never zeros).

import { addDays } from '@/databases/dateHelpers';
import type { HealthMetricDay } from './healthMoodCorrelation';
import type { DailyAverage } from './dailyAverages';

/** Which health metric is overlaid against mood. */
export type OverlayMetricKey = 'sleep' | 'restingHr' | 'hrv' | 'avgHr';

/** Per-metric config: how to pull it, label it, and convert it for display. */
export interface OverlayMetricConfig {
  key: OverlayMetricKey;
  /** Short label for the toggle + right axis, e.g. "Sleep". */
  label: string;
  /** Display unit, e.g. "h" / "bpm" / "ms". */
  unit: string;
  /** Pull the STORED metric (raw units) from a health row; null when absent. */
  extract: (row: HealthMetricDay) => number | null;
  /** Map a stored raw value to its DISPLAY value (e.g. sleep minutes → hours). */
  toDisplay: (raw: number) => number;
}

/** The four overlay metrics, in toggle order (Sleep leads, matching the cards). */
export const OVERLAY_METRICS: readonly OverlayMetricConfig[] = [
  {
    key: 'sleep',
    label: 'Sleep',
    unit: 'h',
    extract: (r) => r.sleepTotalMinutes,
    toDisplay: (m) => m / 60,
  },
  {
    key: 'restingHr',
    label: 'Resting HR',
    unit: 'bpm',
    extract: (r) => r.minHeartRate,
    toDisplay: (v) => v,
  },
  {
    key: 'hrv',
    label: 'HRV',
    unit: 'ms',
    extract: (r) => r.avgHrvMillis,
    toDisplay: (v) => v,
  },
  {
    key: 'avgHr',
    label: 'Avg HR',
    unit: 'bpm',
    extract: (r) => r.avgHeartRate,
    toDisplay: (v) => v,
  },
] as const;

/** Minimum present points a series needs before we plot it (≥2 to draw a line). */
export const OVERLAY_MIN_POINTS = 2;

/** Default window length (days) for the overlay chart. */
export const OVERLAY_WINDOW_DAYS = 30;

/** One aligned day: mood (0..10) and the selected metric (DISPLAY units), each nullable. */
export interface OverlayDay {
  /** Local calendar day 'YYYY-MM-DD'. */
  date: string;
  mood: number | null;
  metric: number | null;
}

/** The aligned overlay window plus the counts + metric domain a chart needs. */
export interface MoodMetricOverlay {
  /** One row per day in the window, oldest → newest. Empty when there's no data. */
  days: OverlayDay[];
  /** How many days in the window have a mood value. */
  moodCount: number;
  /** How many days in the window have the selected metric. */
  metricCount: number;
  /** Min present metric value (display units), or null when none. */
  metricMin: number | null;
  /** Max present metric value (display units), or null when none. */
  metricMax: number | null;
}

const EMPTY_OVERLAY: MoodMetricOverlay = {
  days: [],
  moodCount: 0,
  metricCount: 0,
  metricMin: null,
  metricMax: null,
};

/** Build a `date → finite value` map, applying `map` and dropping ≤ 0 / non-finite. */
function toDayMap(
  entries: ReadonlyArray<{ date: string; value: number | null }>,
  map: (raw: number) => number
): Map<string, number> {
  const out = new Map<string, number>();
  for (const { date, value } of entries) {
    if (typeof date !== 'string') continue;
    if (value == null || !Number.isFinite(value) || value <= 0) continue;
    out.set(date, map(value));
  }
  return out;
}

/** True lexicographic max is a valid calendar max for 'YYYY-MM-DD' strings. */
function maxKey(a: string | null, b: string): string {
  return a == null || b > a ? b : a;
}
function minKey(a: string | null, b: string): string {
  return a == null || b < a ? b : a;
}

/**
 * Align mood + one health metric over a recent window. Pure; never throws on
 * empty/degenerate input (returns an empty overlay).
 *
 * @param healthRows  per-day health rows (a HealthMetricDay[] subset is fine).
 * @param dailyMoods  per-day mood averages ({ day, avg }).
 * @param config      which metric to overlay + its display conversion.
 * @param windowDays  max window length (defaults to OVERLAY_WINDOW_DAYS).
 */
export function buildMoodMetricOverlay(
  healthRows: ReadonlyArray<HealthMetricDay>,
  dailyMoods: ReadonlyArray<Pick<DailyAverage, 'day' | 'avg'>>,
  config: OverlayMetricConfig,
  windowDays: number = OVERLAY_WINDOW_DAYS
): MoodMetricOverlay {
  const metricByDay = toDayMap(
    (healthRows ?? []).map((r) => ({
      date: r?.date,
      value: r ? config.extract(r) : null,
    })),
    config.toDisplay
  );
  const moodByDay = toDayMap(
    (dailyMoods ?? []).map((m) => ({ date: m?.day, value: m?.avg })),
    (v) => v
  );

  // Data extent across BOTH series (string compare is valid for ISO dates).
  let dataStart: string | null = null;
  let dataEnd: string | null = null;
  for (const day of metricByDay.keys()) {
    dataStart = minKey(dataStart, day);
    dataEnd = maxKey(dataEnd, day);
  }
  for (const day of moodByDay.keys()) {
    dataStart = minKey(dataStart, day);
    dataEnd = maxKey(dataEnd, day);
  }
  if (dataStart == null || dataEnd == null) return EMPTY_OVERLAY;

  // Window = last `windowDays` ending at dataEnd, but never earlier than
  // dataStart (so a short history isn't padded with empty leading slots).
  const fullWindowStart = addDays(dataEnd, -(Math.max(1, windowDays) - 1));
  const start = dataStart > fullWindowStart ? dataStart : fullWindowStart;

  const days: OverlayDay[] = [];
  let moodCount = 0;
  let metricCount = 0;
  let metricMin: number | null = null;
  let metricMax: number | null = null;

  for (let day = start; day <= dataEnd; day = addDays(day, 1)) {
    const mood = moodByDay.get(day) ?? null;
    const metric = metricByDay.get(day) ?? null;
    if (mood != null) moodCount += 1;
    if (metric != null) {
      metricCount += 1;
      metricMin = metricMin == null ? metric : Math.min(metricMin, metric);
      metricMax = metricMax == null ? metric : Math.max(metricMax, metric);
    }
    days.push({ date: day, mood, metric });
  }

  return { days, moodCount, metricCount, metricMin, metricMax };
}
