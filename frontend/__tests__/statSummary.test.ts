import {
  buildStatSummary,
  SLOPE_THRESHOLD,
  type StatSummaryInput,
} from '@/components/visualisations/transforms/statSummary';

const base: StatSummaryInput = {
  currentStreak: 5,
  longestStreak: 12,
  avgMoodInWindow: 7.24,
  totalEntries: 20,
  daysInWindow: 30,
  movingAverageSlope: 0,
};

describe('buildStatSummary', () => {
  it('rounds avg mood to 1dp', () => {
    expect(buildStatSummary({ ...base, avgMoodInWindow: 7.24 }).avgMood).toBe(7.2);
    expect(buildStatSummary({ ...base, avgMoodInWindow: 7.25 }).avgMood).toBe(7.3);
  });

  it('computes consistency as entries / days * 100, rounded', () => {
    expect(buildStatSummary({ ...base, totalEntries: 20, daysInWindow: 30 }).consistency)
      .toBe(67);
  });

  it('caps consistency at 100', () => {
    expect(
      buildStatSummary({ ...base, totalEntries: 40, daysInWindow: 30 }).consistency,
    ).toBe(100);
  });

  it('returns 0 consistency when daysInWindow <= 0', () => {
    expect(buildStatSummary({ ...base, daysInWindow: 0 }).consistency).toBe(0);
  });

  it('marks trend stable just below the slope threshold', () => {
    const out = buildStatSummary({
      ...base,
      movingAverageSlope: SLOPE_THRESHOLD - 0.001,
    });
    expect(out.trendArrow).toBe('stable');
  });

  it('marks trend rising just above the slope threshold', () => {
    const out = buildStatSummary({
      ...base,
      movingAverageSlope: SLOPE_THRESHOLD + 0.001,
    });
    expect(out.trendArrow).toBe('rising');
  });

  it('marks trend falling for a clearly negative slope', () => {
    const out = buildStatSummary({ ...base, movingAverageSlope: -0.1 });
    expect(out.trendArrow).toBe('falling');
  });

  it('treats NaN/Infinite slope as stable', () => {
    expect(buildStatSummary({ ...base, movingAverageSlope: NaN }).trendArrow).toBe('stable');
    expect(buildStatSummary({ ...base, movingAverageSlope: Infinity }).trendArrow).toBe('stable');
  });

  it('passes through streak values, flooring and clamping to >= 0', () => {
    const out = buildStatSummary({ ...base, currentStreak: 5, longestStreak: 12 });
    expect(out.streak).toBe(5);
    expect(out.longestStreak).toBe(12);
    expect(buildStatSummary({ ...base, currentStreak: -3 }).streak).toBe(0);
  });
});
