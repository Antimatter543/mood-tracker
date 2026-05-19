import {
  computeActivityImpact,
  barWidthFraction,
  type ActivityImpactRow,
} from '@/components/visualisations/transforms/activityImpact';

const row = (
  activity_name: string,
  impact: number | null,
  entry_count = 3,
): ActivityImpactRow => ({ activity_name, impact, entry_count });

describe('computeActivityImpact', () => {
  it('returns empty arrays for empty input but still gives a safe maxAbsImpact (no divide-by-zero)', () => {
    const out = computeActivityImpact([]);
    expect(out.positive).toEqual([]);
    expect(out.negative).toEqual([]);
    expect(out.displayOrder).toEqual([]);
    expect(out.maxAbsImpact).toBeGreaterThan(0);
  });

  it('drops null and NaN impacts', () => {
    const rows = [
      row('A', null),
      row('B', Number.NaN),
      row('C', 2),
    ];
    const out = computeActivityImpact(rows);
    expect(out.positive.map((r) => r.activity_name)).toEqual(['C']);
  });

  it('keeps top N positives sorted descending', () => {
    const rows = [
      row('a', 1),
      row('b', 3),
      row('c', 2),
      row('d', 5),
      row('e', 4),
      row('f', 0.5),
    ];
    const out = computeActivityImpact(rows, 3);
    expect(out.positive.map((r) => r.impact)).toEqual([5, 4, 3]);
  });

  it('keeps top N negatives sorted ascending (most-negative first)', () => {
    const rows = [
      row('a', -1),
      row('b', -3),
      row('c', -0.5),
      row('d', -5),
    ];
    const out = computeActivityImpact(rows, 2);
    expect(out.negative.map((r) => r.impact)).toEqual([-5, -3]);
  });

  it('displayOrder appends negatives in reversed order after positives', () => {
    const rows = [
      row('p1', 5),
      row('p2', 3),
      row('n1', -2),
      row('n2', -4),
    ];
    const out = computeActivityImpact(rows);
    // positives top-down, negatives bottom-up (least negative first, most-negative last)
    expect(out.displayOrder.map((r) => r.activity_name)).toEqual(['p1', 'p2', 'n1', 'n2']);
  });

  it('handles single entry', () => {
    const out = computeActivityImpact([row('solo', 2.5)]);
    expect(out.positive).toHaveLength(1);
    expect(out.maxAbsImpact).toBe(2.5);
  });
});

describe('barWidthFraction', () => {
  it('returns 0 when maxAbsImpact is 0', () => {
    expect(barWidthFraction(3, 0)).toBe(0);
  });

  it('returns 0 on NaN', () => {
    expect(barWidthFraction(NaN, 5)).toBe(0);
  });

  it('caps at 0.65 (the half-track multiplier)', () => {
    expect(barWidthFraction(5, 5)).toBeCloseTo(0.65);
  });

  it('scales linearly', () => {
    expect(barWidthFraction(2.5, 5)).toBeCloseTo(0.325);
  });
});
