import {
  buildWeeklyMoodChartData,
  formatLabel,
  type MoodAvgRow,
} from '@/components/visualisations/transforms/weeklyMood';
import { type DateFormatPref } from '@/lib/dateFormat';

// These existing cases pin the SPARSENESS + weekday/month-year policy, which is
// independent of the date-format preference, so they run under 'system' (the
// default). The preference's effect on the numeric labels is pinned in its own
// describe block at the bottom.
const SYSTEM: DateFormatPref = 'system';

describe('buildWeeklyMoodChartData', () => {
  it('returns isEmpty=true on empty input', () => {
    const result = buildWeeklyMoodChartData([], 'week', SYSTEM);
    expect(result.isEmpty).toBe(true);
    expect(result.data).toEqual([]);
    expect(result.labels).toEqual([]);
    expect(result.nullIndices).toEqual([]);
  });

  it('handles a single entry', () => {
    const rows: MoodAvgRow[] = [{ date: '2025-06-15', avgMood: 7 }];
    const result = buildWeeklyMoodChartData(rows, 'week', SYSTEM);
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
    const result = buildWeeklyMoodChartData(rows, 'week', SYSTEM);
    expect(result.data).toEqual([4, 5, 6]);
    expect(result.nullIndices).toEqual([1]);
  });

  it('preserves length even with all-null mood (every day flagged)', () => {
    const rows: MoodAvgRow[] = [
      { date: '2025-06-13', avgMood: null },
      { date: '2025-06-14', avgMood: null },
      { date: '2025-06-15', avgMood: null },
    ];
    const result = buildWeeklyMoodChartData(rows, 'week', SYSTEM);
    expect(result.data).toHaveLength(3);
    expect(result.nullIndices).toEqual([0, 1, 2]);
  });
});

describe('formatLabel', () => {
  it('emits a short weekday for the week timeframe', () => {
    const label = formatLabel('2025-06-15', 0, 7, 'week', SYSTEM);
    expect(typeof label).toBe('string');
    expect(label.length).toBeGreaterThan(0);
    expect(label.length).toBeLessThanOrEqual(4);
  });

  it('sparse-labels the month timeframe with short dates', () => {
    const total = 30;
    const labels = Array.from({ length: total }, (_, i) =>
      formatLabel('2025-06-15', i, total, 'month', SYSTEM),
    );
    const shown = labels.filter((l) => l.length > 0);
    expect(shown.length).toBeGreaterThanOrEqual(3);
    expect(shown.length).toBeLessThanOrEqual(7);
    expect(labels[0]).toMatch(/\d+\/\d+/);
    expect(labels[total - 1]).toMatch(/\d+\/\d+/);
    expect(labels[1]).toBe('');
  });

  it('emits month + 2-digit year for year/alltime endpoints', () => {
    // First and last index are always labelled, and include the year so
    // adjacent years are distinguishable (e.g. "Jan '25" vs "Jan '26").
    const yearFirst = formatLabel('2025-06-15', 0, 365, 'year', SYSTEM);
    const allFirst = formatLabel('2025-01-10', 0, 500, 'alltime', SYSTEM);
    expect(yearFirst).toMatch(/^[A-Za-z]{3} '\d{2}$/);
    expect(allFirst).toBe("Jan '25");
  });

  it('distinguishes the same month across different years', () => {
    const jan25 = formatLabel('2025-01-10', 0, 500, 'alltime', SYSTEM);
    const jan26 = formatLabel('2026-01-10', 499, 500, 'alltime', SYSTEM);
    expect(jan25).toBe("Jan '25");
    expect(jan26).toBe("Jan '26");
    expect(jan25).not.toBe(jan26);
  });

  it('blanks most points and shows only a handful of evenly-spaced labels', () => {
    const total = 365;
    const labels = Array.from({ length: total }, (_, i) =>
      formatLabel('2025-06-15', i, total, 'year', SYSTEM),
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
      formatLabel('2025-06-15', i, 4, 'alltime', SYSTEM),
    );
    expect(labels.every((l) => l.length > 0)).toBe(true);
  });

  it('produces sparse labels for the 3months timeframe', () => {
    const total = 90;
    const labels = Array.from({ length: total }, (_, i) =>
      formatLabel('2025-06-15', i, total, '3months', SYSTEM),
    );
    const shown = labels.filter((l) => l.length > 0);
    expect(shown.length).toBeGreaterThanOrEqual(3);
    expect(shown.length).toBeLessThanOrEqual(7);
    expect(labels[0]).toMatch(/\d+\/\d+/);
    expect(labels[total - 1]).toMatch(/\d+\/\d+/);
    expect(labels[1]).toBe('');
  });
});

describe('formatLabel honours the date-format preference', () => {
  // The bug a 5-star Play reviewer reported: this axis label was hardcoded to US
  // MM/DD for every user on earth ("is there a way I can change the MM/DD format
  // to DD/MM? I'm from a different country").
  const JUNE_15 = '2025-06-15';

  it('orders the month/day label per the preference', () => {
    expect(formatLabel(JUNE_15, 0, 30, 'month', 'mdy')).toBe('06/15');
    expect(formatLabel(JUNE_15, 0, 30, 'month', 'dmy')).toBe('15/06');
    expect(formatLabel(JUNE_15, 0, 30, 'month', 'ymd')).toBe('06-15');
  });

  it('applies the preference on the 3months axis too', () => {
    expect(formatLabel(JUNE_15, 0, 90, '3months', 'dmy')).toBe('15/06');
    expect(formatLabel(JUNE_15, 0, 90, '3months', 'mdy')).toBe('06/15');
  });

  it('leaves blanked (non-sparse) positions blank whatever the preference', () => {
    for (const pref of ['system', 'mdy', 'dmy', 'ymd'] as DateFormatPref[]) {
      expect(formatLabel(JUNE_15, 1, 30, 'month', pref)).toBe('');
    }
  });

  it('does not touch weekday or month-name labels', () => {
    // A weekday name has no day/month ORDER to get wrong, and the year axis
    // labels by month name, so both are preference-independent.
    for (const pref of ['system', 'mdy', 'dmy', 'ymd'] as DateFormatPref[]) {
      expect(formatLabel(JUNE_15, 0, 7, 'week', pref)).toBe(
        formatLabel(JUNE_15, 0, 7, 'week', 'system'),
      );
      expect(formatLabel('2025-01-10', 0, 500, 'alltime', pref)).toBe("Jan '25");
    }
  });

  it('threads the preference through buildWeeklyMoodChartData to the labels', () => {
    const rows: MoodAvgRow[] = Array.from({ length: 30 }, (_, i) => ({
      date: `2025-06-${String(i + 1).padStart(2, '0')}`,
      avgMood: 5,
    }));
    expect(buildWeeklyMoodChartData(rows, 'month', 'dmy').labels[0]).toBe('01/06');
    expect(buildWeeklyMoodChartData(rows, 'month', 'mdy').labels[0]).toBe('06/01');
  });
});
