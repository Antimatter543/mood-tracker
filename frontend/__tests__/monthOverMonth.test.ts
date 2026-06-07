import {
  computeMonthOverMonth,
  FLAT_THRESHOLD,
  type MonthMoodRow,
} from '@/components/visualisations/transforms/monthOverMonth';

const m = (avg: number | null, count: number): MonthMoodRow => ({
  avg_mood: avg,
  entry_count: count,
});

describe('computeMonthOverMonth', () => {
  it('computes delta as current - previous', () => {
    const out = computeMonthOverMonth(m(7.1, 22), m(6.8, 18), 30, 31);
    expect(out.delta).toBeCloseTo(0.3, 5);
  });

  it('classifies trend up when delta exceeds the flat threshold', () => {
    const out = computeMonthOverMonth(m(7.5, 10), m(6.0, 10), 30, 30);
    expect(out.trend).toBe('up');
  });

  it('classifies trend down for a clear decrease', () => {
    const out = computeMonthOverMonth(m(5.0, 10), m(7.0, 10), 30, 30);
    expect(out.trend).toBe('down');
  });

  it('classifies trend flat when |delta| < FLAT_THRESHOLD', () => {
    const out = computeMonthOverMonth(
      m(6.2, 10),
      m(6.0, 10), // delta 0.2 < 0.3
      30,
      30,
    );
    expect(Math.abs(out.delta)).toBeLessThan(FLAT_THRESHOLD);
    expect(out.trend).toBe('flat');
  });

  it('caps consistency at 100%', () => {
    // 40 entries in a 30-day month -> would be 133%, capped to 100
    const out = computeMonthOverMonth(m(7, 40), m(6, 15), 30, 31);
    expect(out.currentConsistencyPct).toBe(100);
  });

  it('computes consistency as entries / daysInMonth * 100', () => {
    const out = computeMonthOverMonth(m(7, 15), m(6, 10), 30, 31);
    expect(out.currentConsistencyPct).toBeCloseTo(50);
    expect(out.previousConsistencyPct).toBeCloseTo((10 / 31) * 100);
  });

  it('coerces null averages to 0 (empty month)', () => {
    const out = computeMonthOverMonth(m(null, 0), m(6.5, 10), 30, 31);
    expect(out.currentAvg).toBe(0);
    expect(out.previousAvg).toBeCloseTo(6.5);
    expect(out.currentEntryCount).toBe(0);
  });

  it('avoids division by zero when daysInMonth is 0', () => {
    const out = computeMonthOverMonth(m(7, 5), m(6, 5), 0, 0);
    expect(out.currentConsistencyPct).toBe(0);
    expect(out.previousConsistencyPct).toBe(0);
  });
});
