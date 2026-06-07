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

  it('emits month + 2-digit year for year/alltime endpoints', () => {
    // First and last index are always labelled, and include the year so
    // adjacent years are distinguishable (e.g. "Jan '25" vs "Jan '26").
    const yearFirst = formatLabel('2025-06-15', 0, 365, 'year');
    const allFirst = formatLabel('2025-01-10', 0, 500, 'alltime');
    expect(yearFirst).toMatch(/^[A-Za-z]{3} '\d{2}$/);
    expect(allFirst).toBe("Jan '25");
  });

  it('distinguishes the same month across different years', () => {
    const jan25 = formatLabel('2025-01-10', 0, 500, 'alltime');
    const jan26 = formatLabel('2026-01-10', 499, 500, 'alltime');
    expect(jan25).toBe("Jan '25");
    expect(jan26).toBe("Jan '26");
    expect(jan25).not.toBe(jan26);
  });

  it('blanks most points and shows only a handful of evenly-spaced labels', () => {
    const total = 365;
    const labels = Array.from({ length: total }, (_, i) =>
      formatLabel('2025-06-15', i, total, 'year'),
    );
    const shown = labels.filter((l) => l.length > 0);
    // ~5 target labels — must be sparse (few), never one-per-point.
    expect(shown.length).toBeGreaterThanOrEqual(3);
    expect(shown.length).toBeLessThanOrEqual(7);
    // Both ends are always anchored.
    expect(labels[0].length).toBeGreaterThan(0);
    expect(labels[total - 1].length).toBeGreaterThan(0);
  });

  it('labels every point when there are fewer points than the target', () => {
    // 4 points <= target 5 → all labelled, none blank.
    const labels = Array.from({ length: 4 }, (_, i) =>
      formatLabel('2025-06-15', i, 4, 'alltime'),
    );
    expect(labels.every((l) => l.length > 0)).toBe(true);
  });

  it('produces sparse labels for the 3months timeframe', () => {
    // First and last get a M/D label; middle indices not divisible by 3 are empty.
    expect(formatLabel('2025-06-15', 0, 18, '3months')).toMatch(/\d+\/\d+/);
    expect(formatLabel('2025-06-15', 17, 18, '3months')).toMatch(/\d+\/\d+/);
    expect(formatLabel('2025-06-15', 1, 18, '3months')).toBe('');
    expect(formatLabel('2025-06-15', 3, 18, '3months')).toMatch(/\d+\/\d+/);
  });
});
