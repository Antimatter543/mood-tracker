import {
  buildDailyBarData,
  DAY_LABELS_SUN_FIRST,
  type DailyMoodRow,
} from '@/components/visualisations/transforms/dailyBar';

describe('buildDailyBarData', () => {
  it('returns a length-7 zero-filled shape on empty input', () => {
    const out = buildDailyBarData([]);
    expect(out.labels).toHaveLength(7);
    expect(out.data).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(out.counts).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(out.labels).toEqual([...DAY_LABELS_SUN_FIRST]);
  });

  it('places days using the Sunday-first convention (SQLite %w)', () => {
    const rows: DailyMoodRow[] = [
      { day_of_week: 0, avg_mood: 5, entry_count: 2 },   // Sun
      { day_of_week: 1, avg_mood: 7, entry_count: 4 },   // Mon
      { day_of_week: 6, avg_mood: 3, entry_count: 1 },   // Sat
    ];
    const out = buildDailyBarData(rows);
    expect(out.data[0]).toBe(5);
    expect(out.data[1]).toBe(7);
    expect(out.data[6]).toBe(3);
    expect(out.counts[0]).toBe(2);
    expect(out.counts[1]).toBe(4);
    expect(out.counts[6]).toBe(1);
  });

  it('ignores out-of-range day_of_week values', () => {
    const rows: DailyMoodRow[] = [
      { day_of_week: -1, avg_mood: 9, entry_count: 1 },
      { day_of_week: 7, avg_mood: 9, entry_count: 1 },
      { day_of_week: 3, avg_mood: 6, entry_count: 2 },
    ];
    const out = buildDailyBarData(rows);
    expect(out.data[3]).toBe(6);
    // unaffected slots remain zero
    expect(out.data.filter((_, i) => i !== 3)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('handles single entry on a single day', () => {
    const rows: DailyMoodRow[] = [
      { day_of_week: 4, avg_mood: 8, entry_count: 1 },
    ];
    const out = buildDailyBarData(rows);
    expect(out.data[4]).toBe(8);
    expect(out.counts[4]).toBe(1);
  });
});
