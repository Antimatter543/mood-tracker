import {
  buildDowPatternData,
  DAY_LABELS_MON_FIRST,
  type DowRow,
} from '@/components/visualisations/transforms/dayOfWeekPattern';

const row = (
  dow: number,
  avg: number,
  count: number,
  best = avg,
  worst = avg,
): DowRow => ({
  day_of_week: dow,
  avg_mood: avg,
  entry_count: count,
  best_mood: best,
  worst_mood: worst,
});

describe('buildDowPatternData', () => {
  it('returns a Monday-first zero-filled shape on empty input', () => {
    const out = buildDowPatternData([]);
    expect(out.labels).toEqual([...DAY_LABELS_MON_FIRST]);
    expect(out.avgMood).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(out.entryCount).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(out.bestDay).toBe('');
    expect(out.worstDay).toBe('');
    expect(out.totalEntries).toBe(0);
    expect(out.hasEnoughData).toBe(false);
  });

  it('reorders %w rows into Monday-first slots', () => {
    const rows = [
      row(0, 5, 1), // Sun -> slot 6
      row(1, 7, 1), // Mon -> slot 0
      row(6, 3, 1), // Sat -> slot 5
    ];
    const out = buildDowPatternData(rows);
    expect(out.avgMood[0]).toBe(7); // Mon
    expect(out.avgMood[5]).toBe(3); // Sat
    expect(out.avgMood[6]).toBe(5); // Sun
  });

  it('leaves missing days as 0', () => {
    const rows = [row(3, 6, 2)]; // Wed -> Mon-first slot 2
    const out = buildDowPatternData(rows);
    expect(out.avgMood[2]).toBe(6);
    expect(out.avgMood.filter((_, i) => i !== 2)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('selects best and worst day among days with entries', () => {
    const rows = [
      row(1, 8, 3), // Mon best
      row(2, 4, 3), // Tue worst
      row(3, 6, 3), // Wed mid
    ];
    const out = buildDowPatternData(rows);
    expect(out.bestDay).toBe('Mon');
    expect(out.worstDay).toBe('Tue');
  });

  it('respects minEntriesPerDay for best/worst selection', () => {
    const rows = [
      row(1, 9, 1), // Mon, only 1 entry — excluded when min=2
      row(2, 5, 5), // Tue, 5 entries
      row(3, 7, 5), // Wed, 5 entries
    ];
    const out = buildDowPatternData(rows, 2);
    // Mon's 9 is ignored; best is Wed (7), worst is Tue (5)
    expect(out.bestDay).toBe('Wed');
    expect(out.worstDay).toBe('Tue');
  });

  it('flags hasEnoughData at >= 14 total entries', () => {
    const few = buildDowPatternData([row(1, 6, 10)]);
    expect(few.hasEnoughData).toBe(false);
    const many = buildDowPatternData([row(1, 6, 14)]);
    expect(many.hasEnoughData).toBe(true);
    expect(many.totalEntries).toBe(14);
  });

  it('ignores out-of-range day_of_week values', () => {
    const rows = [row(-1, 9, 1), row(7, 9, 1), row(4, 6, 2)];
    const out = buildDowPatternData(rows);
    // %w 4 = Thu -> Mon-first slot 3
    expect(out.avgMood[3]).toBe(6);
    expect(out.totalEntries).toBe(2);
  });
});
