import {
  computeMovingAverage,
  type DayAvg,
} from '@/components/visualisations/transforms/movingAverage';

const day = (date: string, avgMood: number): DayAvg => ({ date, avgMood });

describe('computeMovingAverage', () => {
  it('returns empty array for empty input', () => {
    expect(computeMovingAverage([], 7)).toEqual([]);
  });

  it('returns the single point unchanged for one data point', () => {
    const rows = [day('2025-06-01', 7)];
    const out = computeMovingAverage(rows, 7);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ date: '2025-06-01', value: 7 });
  });

  it('keeps all-same values flat (MA equals the constant)', () => {
    const rows = [
      day('d1', 5), day('d2', 5), day('d3', 5), day('d4', 5), day('d5', 5),
    ];
    const out = computeMovingAverage(rows, 3);
    expect(out.map((p) => p.value)).toEqual([5, 5, 5, 5, 5]);
  });

  it('computes a centred window=3 average with partial edges', () => {
    const rows = [
      day('d1', 1), day('d2', 2), day('d3', 3), day('d4', 4), day('d5', 5),
    ];
    const out = computeMovingAverage(rows, 3).map((p) => p.value);
    // edges are partial windows: [avg(1,2), avg(1,2,3), avg(2,3,4), avg(3,4,5), avg(4,5)]
    expect(out[0]).toBeCloseTo(1.5);
    expect(out[1]).toBeCloseTo(2);
    expect(out[2]).toBeCloseTo(3);
    expect(out[3]).toBeCloseTo(4);
    expect(out[4]).toBeCloseTo(4.5);
  });

  it('preserves output length equal to input length', () => {
    const rows = Array.from({ length: 10 }, (_, i) => day(`d${i}`, i));
    const out = computeMovingAverage(rows, 7);
    expect(out).toHaveLength(10);
  });

  it('coerces an even window to odd (symmetric centred window)', () => {
    const rows = [day('d1', 2), day('d2', 4), day('d3', 6)];
    // window=2 -> 3; centre of d2 averages all three -> 4
    const out = computeMovingAverage(rows, 2).map((p) => p.value);
    expect(out[1]).toBeCloseTo(4);
  });

  it('when window > data length, every output is the mean of all points', () => {
    const rows = [day('d1', 2), day('d2', 4), day('d3', 6)];
    const out = computeMovingAverage(rows, 99).map((p) => p.value);
    expect(out).toEqual([4, 4, 4]);
  });

  it('ignores non-finite values inside the window', () => {
    const rows: DayAvg[] = [
      { date: 'd1', avgMood: NaN },
      { date: 'd2', avgMood: 4 },
      { date: 'd3', avgMood: 6 },
    ];
    const out = computeMovingAverage(rows, 3).map((p) => p.value);
    // d1 window {NaN,4} -> only 4 counts; never NaN
    expect(out.every((v) => Number.isFinite(v))).toBe(true);
    expect(out[0]).toBeCloseTo(4);
  });
});
