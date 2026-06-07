import {
  computeActivityCorrelation,
  MIN_SAMPLES,
  type ActivityCorrelationRow,
} from '@/components/visualisations/transforms/activityCorrelation';

const r = (
  name: string,
  avgWith: number | null,
  avgWithout: number | null,
  countWith: number,
  countWithout: number,
): ActivityCorrelationRow => ({
  activity_name: name,
  avg_with: avgWith,
  avg_without: avgWithout,
  count_with: countWith,
  count_without: countWithout,
});

describe('computeActivityCorrelation', () => {
  it('returns empty result for empty input', () => {
    const out = computeActivityCorrelation([]);
    expect(out.items).toEqual([]);
    expect(out.meaningful).toEqual([]);
  });

  it('computes delta as avg_with - avg_without', () => {
    const out = computeActivityCorrelation([r('Yoga', 7.5, 6, 6, 6)]);
    expect(out.items[0].delta).toBeCloseTo(1.5);
  });

  it('marks items meaningful only when both sides >= MIN_SAMPLES', () => {
    const out = computeActivityCorrelation([
      r('Enough', 7, 5, MIN_SAMPLES, MIN_SAMPLES),
      r('TooFewWith', 7, 5, MIN_SAMPLES - 1, 20),
      r('TooFewWithout', 7, 5, 20, MIN_SAMPLES - 1),
    ]);
    const byName = Object.fromEntries(out.items.map((i) => [i.activity_name, i]));
    expect(byName['Enough'].isMeaningful).toBe(true);
    expect(byName['TooFewWith'].isMeaningful).toBe(false);
    expect(byName['TooFewWithout'].isMeaningful).toBe(false);
    expect(out.meaningful.map((i) => i.activity_name)).toEqual(['Enough']);
  });

  it('treats an activity logged every day (count_without = 0) as not meaningful', () => {
    const out = computeActivityCorrelation([r('Daily', 7, null, 30, 0)]);
    expect(out.items[0].isMeaningful).toBe(false);
    // null avg_without coerced to 0 — no NaN
    expect(out.items[0].avg_without).toBe(0);
    expect(Number.isFinite(out.items[0].delta)).toBe(true);
  });

  it('coerces null avgs to 0 (NaN guard)', () => {
    const out = computeActivityCorrelation([r('Sparse', null, null, 0, 0)]);
    expect(out.items[0].avg_with).toBe(0);
    expect(out.items[0].avg_without).toBe(0);
    expect(out.items[0].delta).toBe(0);
    expect(out.items[0].isMeaningful).toBe(false);
  });

  it('sorts items by absolute delta descending', () => {
    const out = computeActivityCorrelation([
      r('Small', 6, 5.5, 6, 6), // |delta| 0.5
      r('BigNeg', 4, 8, 6, 6),  // |delta| 4
      r('Mid', 7, 5, 6, 6),     // |delta| 2
    ]);
    expect(out.items.map((i) => i.activity_name)).toEqual(['BigNeg', 'Mid', 'Small']);
  });

  it('preserves the sign of delta for negative correlations', () => {
    const out = computeActivityCorrelation([r('Doomscroll', 4, 7, 6, 6)]);
    expect(out.items[0].delta).toBeCloseTo(-3);
  });
});
