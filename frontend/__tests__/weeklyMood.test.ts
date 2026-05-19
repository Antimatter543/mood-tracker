import {
  buildWeeklyMoodChartData,
  formatLabel,
  type MoodAvgRow,
} from '@/components/visualisations/transforms/weeklyMood';

describe('buildWeeklyMoodChartData', () => {
  it('returns isEmpty=true on empty input', () => {
    const result = buildWeeklyMoodChartData([], 'week');
    expect(result.isEmpty).toBe(true);
    expect(result.data).toEqual([]);
    expect(result.labels).toEqual([]);
    expect(result.nullIndices).toEqual([]);
  });

  it('handles a single entry', () => {
    const rows: MoodAvgRow[] = [{ date: '2025-06-15', avgMood: 7 }];
    const result = buildWeeklyMoodChartData(rows, 'week');
    expect(result.isEmpty).toBe(false);
    expect(result.data).toEqual([7]);
    expect(result.nullIndices).toEqual([]);
    expect(result.labels).toHaveLength(1);
  });

  it('interpolates null avgMood and tracks null indices', () => {
    const rows: MoodAvgRow[] = [
      { date: '2025-06-13', avgMood: 4 },
      { date: '2025-06-14', avgMood: null },
      { date: '2025-06-15', avgMood: 6 },
    ];
    const result = buildWeeklyMoodChartData(rows, 'week');
    expect(result.data).toEqual([4, 5, 6]);
    expect(result.nullIndices).toEqual([1]);
  });

  it('preserves length even with all-null mood (every day flagged)', () => {
    const rows: MoodAvgRow[] = [
      { date: '2025-06-13', avgMood: null },
      { date: '2025-06-14', avgMood: null },
      { date: '2025-06-15', avgMood: null },
    ];
    const result = buildWeeklyMoodChartData(rows, 'week');
    expect(result.data).toHaveLength(3);
    expect(result.nullIndices).toEqual([0, 1, 2]);
  });
});

describe('formatLabel', () => {
  it('emits a short weekday for the week timeframe', () => {
    const label = formatLabel('2025-06-15', 0, 7, 'week');
    expect(typeof label).toBe('string');
    expect(label.length).toBeGreaterThan(0);
    expect(label.length).toBeLessThanOrEqual(4);
  });

  it('emits Week N for the month timeframe', () => {
    expect(formatLabel('2025-06-15', 0, 4, 'month')).toBe('Week 1');
    expect(formatLabel('2025-06-22', 1, 4, 'month')).toBe('Week 2');
  });

  it('emits month names for year/alltime', () => {
    const yearLabel = formatLabel('2025-06-15', 0, 12, 'year');
    const allLabel = formatLabel('2025-06-15', 0, 24, 'alltime');
    expect(yearLabel.length).toBeGreaterThan(0);
    expect(allLabel.length).toBeGreaterThan(0);
  });

  it('produces sparse labels for the 3months timeframe', () => {
    // First and last get a M/D label; middle indices not divisible by 3 are empty.
    expect(formatLabel('2025-06-15', 0, 18, '3months')).toMatch(/\d+\/\d+/);
    expect(formatLabel('2025-06-15', 17, 18, '3months')).toMatch(/\d+\/\d+/);
    expect(formatLabel('2025-06-15', 1, 18, '3months')).toBe('');
    expect(formatLabel('2025-06-15', 3, 18, '3months')).toMatch(/\d+\/\d+/);
  });
});
