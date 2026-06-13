/**
 * aggregateDowRows — the LOCAL-day-of-week aggregation that replaced SQLite's
 * `strftime('%w', date)` (which extracted the weekday in UTC and drifted by one
 * for late-evening/backdated entries). Runs under the Brisbane pin (UTC+10).
 */
import {
  aggregateDowRows,
  buildDowPatternData,
} from '@/components/visualisations/transforms/dayOfWeekPattern';

const localMidnight = (y: number, m0: number, d: number) =>
  new Date(y, m0, d, 0, 0, 0).toISOString();

describe('aggregateDowRows', () => {
  it('keys each entry to its LOCAL weekday (0=Sun..6=Sat)', () => {
    // 2026-06-11 is a Thursday (getDay() === 4). The instant is Wednesday in
    // UTC, so strftime would have said Wednesday (3) — this proves we use local.
    const rows = aggregateDowRows([{ date: localMidnight(2026, 5, 11), mood: 7 }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].day_of_week).toBe(4); // Thursday, not 3 (Wednesday)
    expect(rows[0].avg_mood).toBe(7);
    expect(rows[0].entry_count).toBe(1);
    expect(rows[0].best_mood).toBe(7);
    expect(rows[0].worst_mood).toBe(7);
  });

  it('aggregates multiple entries on the same weekday (avg/min/max/count)', () => {
    const rows = aggregateDowRows([
      { date: localMidnight(2026, 5, 11), mood: 4 }, // Thu
      { date: localMidnight(2026, 5, 18), mood: 8 }, // Thu (next week)
      { date: localMidnight(2026, 5, 12), mood: 6 }, // Fri
    ]);
    const thu = rows.find((r) => r.day_of_week === 4)!;
    expect(thu.entry_count).toBe(2);
    expect(thu.avg_mood).toBe(6); // (4+8)/2
    expect(thu.best_mood).toBe(8);
    expect(thu.worst_mood).toBe(4);
    const fri = rows.find((r) => r.day_of_week === 5)!;
    expect(fri.entry_count).toBe(1);
  });

  it('feeds buildDowPatternData correctly (Monday-first labels)', () => {
    const rows = aggregateDowRows([
      { date: localMidnight(2026, 5, 11), mood: 9 }, // Thu
    ]);
    const pattern = buildDowPatternData(rows, 1);
    // Mon-first labels: index 3 == Thursday.
    expect(pattern.labels[3]).toBe('Thu');
    expect(pattern.avgMood[3]).toBe(9);
    expect(pattern.entryCount[3]).toBe(1);
    expect(pattern.bestDay).toBe('Thu');
    expect(pattern.totalEntries).toBe(1);
  });

  it('never throws on degenerate input', () => {
    expect(aggregateDowRows([])).toEqual([]);
    expect(
      aggregateDowRows([
        { date: 'garbage', mood: 5 } as any,
        { date: localMidnight(2026, 5, 11), mood: NaN as any },
      ]),
    ).toEqual([]);
  });
});
