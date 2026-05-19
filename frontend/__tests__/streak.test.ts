import {
  currentStreak,
  longestStreak,
} from '@/components/visualisations/transforms/streak';

describe('currentStreak', () => {
  it('returns 0 for empty input', () => {
    expect(currentStreak([], '2025-06-15')).toBe(0);
  });

  it('counts a single-day streak ending today', () => {
    expect(currentStreak(['2025-06-15'], '2025-06-15')).toBe(1);
  });

  it('counts a continuous 3-day streak ending today', () => {
    const dates = ['2025-06-13', '2025-06-14', '2025-06-15'];
    expect(currentStreak(dates, '2025-06-15')).toBe(3);
  });

  it('counts the streak ending yesterday (one-day grace)', () => {
    // User hasn\'t logged today yet but logged yesterday + the day before.
    const dates = ['2025-06-13', '2025-06-14'];
    expect(currentStreak(dates, '2025-06-15')).toBe(2);
  });

  it('returns 0 when the most recent entry is older than yesterday', () => {
    const dates = ['2025-06-10'];
    expect(currentStreak(dates, '2025-06-15')).toBe(0);
  });

  it('breaks on a gap day', () => {
    // gap on 2025-06-13 -> streak ending today is just today + yesterday + ...
    const dates = ['2025-06-10', '2025-06-11', '2025-06-14', '2025-06-15'];
    expect(currentStreak(dates, '2025-06-15')).toBe(2);
  });

  it('handles duplicate entries on the same day', () => {
    const dates = ['2025-06-15', '2025-06-15', '2025-06-14'];
    expect(currentStreak(dates, '2025-06-15')).toBe(2);
  });

  it('is DST-safe across 2025-03-09 (US spring-forward)', () => {
    const dates = ['2025-03-07', '2025-03-08', '2025-03-09', '2025-03-10'];
    expect(currentStreak(dates, '2025-03-10')).toBe(4);
  });
});

describe('longestStreak', () => {
  it('returns 0 for empty input', () => {
    expect(longestStreak([])).toBe(0);
  });

  it('returns 1 for a single entry', () => {
    expect(longestStreak(['2025-06-15'])).toBe(1);
  });

  it('finds the longest streak in a sparse history', () => {
    // Two streaks: 2-day, 4-day. Should return 4.
    const dates = [
      '2025-06-01', '2025-06-02',
      '2025-06-10', '2025-06-11', '2025-06-12', '2025-06-13',
    ];
    expect(longestStreak(dates)).toBe(4);
  });

  it('ignores duplicates', () => {
    const dates = ['2025-06-01', '2025-06-01', '2025-06-02'];
    expect(longestStreak(dates)).toBe(2);
  });
});
