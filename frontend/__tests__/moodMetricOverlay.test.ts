/**
 * __tests__/moodMetricOverlay.test.ts
 *
 * Pure alignment transform for the mood × metric overlay chart. Runs under the
 * Brisbane pin, but day-keying here is plain 'YYYY-MM-DD' string matching +
 * `addDays` (TZ/DST-safe), so no timezone math is exercised — we assert the
 * window selection, gap (null) handling, and per-metric extraction/scaling.
 */
import {
  buildMoodMetricOverlay,
  OVERLAY_METRICS,
  OVERLAY_MIN_POINTS,
  OVERLAY_WINDOW_DAYS,
  type OverlayMetricConfig,
  type OverlayMetricKey,
} from '@/components/visualisations/transforms/moodMetricOverlay';
import type { HealthMetricDay } from '@/components/visualisations/transforms/healthMoodCorrelation';

const cfg = (key: OverlayMetricKey): OverlayMetricConfig =>
  OVERLAY_METRICS.find((m) => m.key === key)!;

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

/** Sequential 'YYYY-06-DD' days. */
const days = (n: number, startDay = 1): string[] =>
  Array.from({ length: n }, (_, i) =>
    `2026-06-${String(startDay + i).padStart(2, '0')}`
  );

describe('OVERLAY_METRICS config', () => {
  it('exposes the four metrics in toggle order with distinct keys', () => {
    expect(OVERLAY_METRICS.map((m) => m.key)).toEqual([
      'sleep',
      'restingHr',
      'hrv',
      'avgHr',
    ]);
  });

  it('sleep is converted minutes → hours; HR/HRV pass through', () => {
    expect(cfg('sleep').toDisplay(480)).toBe(8);
    expect(cfg('sleep').unit).toBe('h');
    expect(cfg('restingHr').toDisplay(55)).toBe(55);
    expect(cfg('restingHr').extract(hRow('x', { minHr: 55 }))).toBe(55);
    expect(cfg('hrv').extract(hRow('x', { hrv: 42 }))).toBe(42);
    expect(cfg('avgHr').extract(hRow('x', { avgHr: 70 }))).toBe(70);
  });
});

describe('buildMoodMetricOverlay — empty / degenerate', () => {
  it('empty inputs → empty overlay, never throws', () => {
    const o = buildMoodMetricOverlay([], [], cfg('sleep'));
    expect(o).toEqual({
      days: [],
      moodCount: 0,
      metricCount: 0,
      metricMin: null,
      metricMax: null,
    });
  });

  it('metric present but no mood → still windows over the metric days', () => {
    const d = days(3);
    const rows = d.map((day) => hRow(day, { sleep: 420 }));
    const o = buildMoodMetricOverlay(rows, [], cfg('sleep'));
    expect(o.days).toHaveLength(3);
    expect(o.metricCount).toBe(3);
    expect(o.moodCount).toBe(0);
    expect(o.days.every((x) => x.mood === null)).toBe(true);
  });
});

describe('buildMoodMetricOverlay — alignment + gaps', () => {
  it('aligns mood + metric on the shared day; missing sides are null (never 0)', () => {
    // Day1: both. Day2: mood only. Day3: metric only.
    const d = days(3);
    const rows = [hRow(d[0], { sleep: 480 }), hRow(d[2], { sleep: 360 })];
    const moods = [dm(d[0], 6), dm(d[1], 4)];
    const o = buildMoodMetricOverlay(rows, moods, cfg('sleep'));

    expect(o.days).toEqual([
      { date: d[0], mood: 6, metric: 8 }, // 480 min → 8h
      { date: d[1], mood: 4, metric: null }, // mood-only → metric gap
      { date: d[2], mood: null, metric: 6 }, // metric-only → mood gap
    ]);
    expect(o.moodCount).toBe(2);
    expect(o.metricCount).toBe(2);
    expect(o.metricMin).toBe(6);
    expect(o.metricMax).toBe(8);
  });

  it('drops non-positive / non-finite metric + mood values', () => {
    const d = days(3);
    const rows = [
      hRow(d[0], { sleep: 0 }),
      hRow(d[1], { sleep: -60 }),
      hRow(d[2], { sleep: 480 }),
    ];
    const moods = [dm(d[0], 5), dm(d[1], NaN), dm(d[2], 7)];
    const o = buildMoodMetricOverlay(rows, moods, cfg('sleep'));
    // Only day3 has a valid metric; day1 has a valid mood; day2 both dropped.
    expect(o.metricCount).toBe(1);
    expect(o.days.find((x) => x.date === d[2])?.metric).toBe(8);
    expect(o.days.find((x) => x.date === d[1])?.mood).toBeNull();
  });

  it('reads the selected metric only (resting HR ≠ avg HR ≠ HRV)', () => {
    const d = days(2);
    const rows = d.map((day) => hRow(day, { avgHr: 72, minHr: 55, hrv: 40 }));
    const moods = d.map((day) => dm(day, 6));
    expect(buildMoodMetricOverlay(rows, moods, cfg('restingHr')).days[0].metric).toBe(55);
    expect(buildMoodMetricOverlay(rows, moods, cfg('avgHr')).days[0].metric).toBe(72);
    expect(buildMoodMetricOverlay(rows, moods, cfg('hrv')).days[0].metric).toBe(40);
    // No sleep → sleep overlay has no metric points.
    expect(buildMoodMetricOverlay(rows, moods, cfg('sleep')).metricCount).toBe(0);
  });
});

describe('buildMoodMetricOverlay — window selection', () => {
  it('a short history is NOT padded — window = actual data span, ending at latest day', () => {
    const d = days(5); // 5 consecutive days, well under the window
    const rows = d.map((day) => hRow(day, { sleep: 420 }));
    const moods = d.map((day) => dm(day, 6));
    const o = buildMoodMetricOverlay(rows, moods, cfg('sleep'), 30);
    expect(o.days).toHaveLength(5);
    expect(o.days[0].date).toBe(d[0]);
    expect(o.days[4].date).toBe(d[4]);
  });

  it('a long history is clipped to the last `windowDays`, ending at the latest day', () => {
    // Data spans 2026-05-01 .. 2026-06-30 (metric only), window 30.
    const rows: HealthMetricDay[] = [];
    for (let i = 0; i < 61; i++) {
      const day = new Date(2026, 4, 1 + i); // local May 1 + i
      const ymd = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
      rows.push(hRow(ymd, { sleep: 400 }));
    }
    const o = buildMoodMetricOverlay(rows, [], cfg('sleep'), 30);
    expect(o.days).toHaveLength(30);
    expect(o.days[o.days.length - 1].date).toBe('2026-06-30');
    expect(o.days[0].date).toBe('2026-06-01'); // 30 days ending at Jun 30
  });

  it('window spans both series (metric ends earlier than mood)', () => {
    // metric on Jun 1-3, mood on Jun 1-6 → window ends at Jun 6, covers all 6.
    const o = buildMoodMetricOverlay(
      days(3, 1).map((day) => hRow(day, { sleep: 420 })),
      days(6, 1).map((day) => dm(day, 6)),
      cfg('sleep'),
      OVERLAY_WINDOW_DAYS
    );
    expect(o.days).toHaveLength(6);
    expect(o.days[o.days.length - 1].date).toBe('2026-06-06');
    // Metric present only on the first 3 days.
    expect(o.metricCount).toBe(3);
    expect(o.moodCount).toBe(6);
  });

  it('OVERLAY_MIN_POINTS is the small line-drawing threshold', () => {
    expect(OVERLAY_MIN_POINTS).toBeGreaterThanOrEqual(2);
  });
});
