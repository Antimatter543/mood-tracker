/**
 * timeOfDay transforms — part-of-day bucketing + intraday swing.
 *
 * Runs under the Brisbane pin (UTC+10, jest.tz.js). Instants are built from
 * LOCAL wall-clock components (`new Date(y, m0, d, hour, min)`), so the local
 * hour/day asserted here is deterministic regardless of the stored UTC offset —
 * the same approach as dowAggregate.test.ts. The Night midnight-wrap case is the
 * critical one: an instant at local 02:00 is the PREVIOUS day in UTC, which is
 * exactly what would mis-bucket if the hour were extracted in SQL/UTC.
 */
import {
  aggregateTimeOfDay,
  computeIntradaySwing,
  bucketForHour,
  TIME_OF_DAY_BUCKETS,
  type TimeOfDayRow,
} from '@/components/visualisations/transforms/timeOfDay';

// A local wall-clock instant: year, 0-based month, day, hour[, minute].
const at = (
  y: number,
  m0: number,
  d: number,
  hour: number,
  minute = 0,
): string => new Date(y, m0, d, hour, minute, 0).toISOString();

const row = (date: string, mood: number): TimeOfDayRow => ({ date, mood });

// Find a bucket stat by its label in the (always length-4, ordered) result.
const bucket = (buckets: ReturnType<typeof aggregateTimeOfDay>['buckets'], label: string) =>
  buckets.find((b) => b.label === label)!;

describe('bucketForHour', () => {
  it('maps boundaries correctly, Night wraps midnight', () => {
    // Morning 05:00–11:59
    expect(bucketForHour(5)).toBe('morning');
    expect(bucketForHour(11)).toBe('morning');
    // Afternoon 12:00–16:59
    expect(bucketForHour(12)).toBe('afternoon');
    expect(bucketForHour(16)).toBe('afternoon');
    // Evening 17:00–21:59
    expect(bucketForHour(17)).toBe('evening');
    expect(bucketForHour(21)).toBe('evening');
    // Night 22:00–04:59 (wraps)
    expect(bucketForHour(22)).toBe('night');
    expect(bucketForHour(23)).toBe('night');
    expect(bucketForHour(0)).toBe('night');
    expect(bucketForHour(4)).toBe('night');
  });

  it('returns null for out-of-range hours', () => {
    expect(bucketForHour(-1)).toBeNull();
    expect(bucketForHour(24)).toBeNull();
    expect(bucketForHour(3.5)).toBeNull();
  });
});

describe('aggregateTimeOfDay', () => {
  it('returns all 4 buckets in display order, zero-filled on empty input', () => {
    const out = aggregateTimeOfDay([]);
    expect(out.buckets.map((b) => b.label)).toEqual([
      'Morning',
      'Afternoon',
      'Evening',
      'Night',
    ]);
    expect(out.buckets.every((b) => b.avg_mood === 0 && b.entry_count === 0)).toBe(true);
    expect(out.bestBucket).toBe('');
    expect(out.worstBucket).toBe('');
    expect(out.totalEntries).toBe(0);
    expect(out.hasEnoughData).toBe(false);
  });

  it('keys entries to the correct bucket by LOCAL hour', () => {
    const out = aggregateTimeOfDay([
      row(at(2026, 5, 1, 8), 7), // Morning
      row(at(2026, 5, 1, 14), 6), // Afternoon
      row(at(2026, 5, 1, 19), 5), // Evening
      row(at(2026, 5, 1, 23), 4), // Night
    ]);
    expect(bucket(out.buckets, 'Morning').entry_count).toBe(1);
    expect(bucket(out.buckets, 'Afternoon').entry_count).toBe(1);
    expect(bucket(out.buckets, 'Evening').entry_count).toBe(1);
    expect(bucket(out.buckets, 'Night').entry_count).toBe(1);
  });

  it('buckets the Night midnight-wrap (local 02:00 -> Night, not via UTC day)', () => {
    // Local 02:00 is the PREVIOUS day in UTC under +10 — proves local keying.
    const out = aggregateTimeOfDay([row(at(2026, 5, 2, 2), 3)]);
    expect(bucket(out.buckets, 'Night').entry_count).toBe(1);
    expect(bucket(out.buckets, 'Night').avg_mood).toBe(3);
  });

  it('respects exact bucket boundaries (11:59 Morning vs 12:00 Afternoon)', () => {
    const out = aggregateTimeOfDay([
      row(at(2026, 5, 3, 11, 59), 8), // Morning
      row(at(2026, 5, 3, 12, 0), 2), // Afternoon
    ]);
    expect(bucket(out.buckets, 'Morning').entry_count).toBe(1);
    expect(bucket(out.buckets, 'Morning').avg_mood).toBe(8);
    expect(bucket(out.buckets, 'Afternoon').entry_count).toBe(1);
    expect(bucket(out.buckets, 'Afternoon').avg_mood).toBe(2);
  });

  it('respects the Night/Morning boundary (04:59 Night vs 05:00 Morning)', () => {
    const out = aggregateTimeOfDay([
      row(at(2026, 5, 4, 4, 59), 1), // Night
      row(at(2026, 5, 4, 5, 0), 9), // Morning
    ]);
    expect(bucket(out.buckets, 'Night').entry_count).toBe(1);
    expect(bucket(out.buckets, 'Night').avg_mood).toBe(1);
    expect(bucket(out.buckets, 'Morning').entry_count).toBe(1);
    expect(bucket(out.buckets, 'Morning').avg_mood).toBe(9);
  });

  it('averages (2 dp) and counts within a bucket', () => {
    const out = aggregateTimeOfDay([
      row(at(2026, 5, 5, 8), 4),
      row(at(2026, 5, 6, 9), 7),
      row(at(2026, 5, 7, 10), 6), // avg = 17/3 = 5.666...
    ]);
    const morning = bucket(out.buckets, 'Morning');
    expect(morning.entry_count).toBe(3);
    expect(morning.avg_mood).toBe(5.67);
  });

  it('selects best and worst bucket only among buckets with entries', () => {
    const out = aggregateTimeOfDay([
      row(at(2026, 5, 8, 8), 9), // Morning best
      row(at(2026, 5, 8, 14), 3), // Afternoon worst
      row(at(2026, 5, 8, 19), 6), // Evening mid
      // Night has no entries -> must not be selected as worst despite avg 0.
    ]);
    expect(out.bestBucket).toBe('Morning');
    expect(out.worstBucket).toBe('Afternoon');
  });

  it('gates hasEnoughData at >= 14 total entries', () => {
    const make = (n: number): TimeOfDayRow[] =>
      Array.from({ length: n }, (_, i) => row(at(2026, 5, 1 + i, 8), 5));
    expect(aggregateTimeOfDay(make(13)).hasEnoughData).toBe(false);
    const out = aggregateTimeOfDay(make(14));
    expect(out.hasEnoughData).toBe(true);
    expect(out.totalEntries).toBe(14);
  });

  it('skips invalid instants and non-finite moods', () => {
    const out = aggregateTimeOfDay([
      { date: 'garbage', mood: 5 } as any,
      { date: at(2026, 5, 9, 8), mood: NaN as any },
      { date: at(2026, 5, 9, 8), mood: Infinity as any },
      row(at(2026, 5, 9, 8), 6), // the only valid one
    ]);
    expect(out.totalEntries).toBe(1);
    expect(bucket(out.buckets, 'Morning').entry_count).toBe(1);
    expect(bucket(out.buckets, 'Morning').avg_mood).toBe(6);
  });

  it('keeps the bucket catalog tunable but ordered (display order invariant)', () => {
    expect(TIME_OF_DAY_BUCKETS.map((b) => b.bucket)).toEqual([
      'morning',
      'afternoon',
      'evening',
      'night',
    ]);
  });
});

describe('computeIntradaySwing', () => {
  it('returns zeros and hasEnough false on empty input (no NaN)', () => {
    const out = computeIntradaySwing([]);
    expect(out.multiLogDayCount).toBe(0);
    expect(out.avgRange).toBe(0);
    expect(out.avgDelta).toBe(0);
    expect(out.hasEnough).toBe(false);
    expect(Number.isNaN(out.avgRange)).toBe(false);
    expect(Number.isNaN(out.avgDelta)).toBe(false);
  });

  it('ignores single-log days entirely', () => {
    const out = computeIntradaySwing([
      row(at(2026, 5, 1, 8), 5),
      row(at(2026, 5, 2, 8), 7),
      row(at(2026, 5, 3, 8), 9),
    ]);
    expect(out.multiLogDayCount).toBe(0);
    expect(out.avgRange).toBe(0);
    expect(out.avgDelta).toBe(0);
    expect(out.hasEnough).toBe(false);
  });

  it('computes a single 2-entry day: delta = last - first, range = max - min', () => {
    const out = computeIntradaySwing([
      row(at(2026, 5, 1, 8), 4), // first (morning)
      row(at(2026, 5, 1, 20), 9), // last (evening)
    ]);
    expect(out.multiLogDayCount).toBe(1);
    expect(out.avgRange).toBe(5); // 9 - 4
    expect(out.avgDelta).toBe(5); // 9 - 4
  });

  it('uses time order (not input order) for first/last', () => {
    // Later instant supplied FIRST in the array; sort must still pick by time.
    const out = computeIntradaySwing([
      row(at(2026, 5, 1, 20), 9), // actually the LAST
      row(at(2026, 5, 1, 8), 4), // actually the FIRST
      row(at(2026, 5, 1, 13), 2), // mid — sets the day min
    ]);
    expect(out.multiLogDayCount).toBe(1);
    expect(out.avgDelta).toBe(5); // last(9) - first(4)
    expect(out.avgRange).toBe(7); // max(9) - min(2)
  });

  it('captures a negative delta (mood dipped across the day)', () => {
    const out = computeIntradaySwing([
      row(at(2026, 5, 1, 8), 8), // first
      row(at(2026, 5, 1, 21), 3), // last
    ]);
    expect(out.avgDelta).toBe(-5); // 3 - 8
    expect(out.avgRange).toBe(5);
  });

  it('averages range and delta across multiple multi-log days', () => {
    const out = computeIntradaySwing([
      // Day 1: delta +5, range 5
      row(at(2026, 5, 1, 8), 4),
      row(at(2026, 5, 1, 20), 9),
      // Day 2: delta -3, range 3
      row(at(2026, 5, 2, 9), 7),
      row(at(2026, 5, 2, 19), 4),
      // Day 3 is single-log — ignored
      row(at(2026, 5, 3, 10), 6),
    ]);
    expect(out.multiLogDayCount).toBe(2);
    expect(out.avgDelta).toBe(1); // (5 + -3) / 2
    expect(out.avgRange).toBe(4); // (5 + 3) / 2
  });

  it('gates hasEnough at >= 3 multi-log days', () => {
    const multiLogDay = (d: number): TimeOfDayRow[] => [
      row(at(2026, 5, d, 8), 4),
      row(at(2026, 5, d, 20), 6),
    ];
    const two = computeIntradaySwing([...multiLogDay(1), ...multiLogDay(2)]);
    expect(two.multiLogDayCount).toBe(2);
    expect(two.hasEnough).toBe(false);
    const three = computeIntradaySwing([
      ...multiLogDay(1),
      ...multiLogDay(2),
      ...multiLogDay(3),
    ]);
    expect(three.multiLogDayCount).toBe(3);
    expect(three.hasEnough).toBe(true);
  });

  it('skips invalid instants / non-finite moods within a day', () => {
    const out = computeIntradaySwing([
      row(at(2026, 5, 1, 8), 4),
      { date: 'garbage', mood: 100 } as any,
      { date: at(2026, 5, 1, 12), mood: NaN as any },
      row(at(2026, 5, 1, 20), 8),
    ]);
    // Only the two valid entries count -> one multi-log day, delta 4, range 4.
    expect(out.multiLogDayCount).toBe(1);
    expect(out.avgDelta).toBe(4);
    expect(out.avgRange).toBe(4);
  });
});
