/**
 * The single day-keying authority for the visualisations. Runs under the
 * Brisbane TZ pin (jest.tz.js, UTC+10) so the local-vs-UTC distinction is real.
 */
import {
  aggregateDailyAverages,
  dailyAverageMap,
  dailyAverageRows,
  bestDayLocal,
} from '@/components/visualisations/transforms/dailyAverages';

// A few stored UTC instants for known LOCAL (Brisbane, UTC+10) days.
const localMidnight = (y: number, m0: number, d: number) =>
  new Date(y, m0, d, 0, 0, 0).toISOString();

describe('aggregateDailyAverages', () => {
  it('keys each entry to its LOCAL day and averages (1 dp)', () => {
    const rows = [
      { date: localMidnight(2026, 5, 11), mood: 6 }, // Thu 11th local (Wed UTC)
      { date: new Date(2026, 5, 11, 18, 0, 0).toISOString(), mood: 8 }, // Thu 11th evening
      { date: localMidnight(2026, 5, 12), mood: 4 }, // Fri 12th
    ];
    expect(aggregateDailyAverages(rows)).toEqual([
      { day: '2026-06-11', avg: 7, count: 2 },
      { day: '2026-06-12', avg: 4, count: 1 },
    ]);
  });

  it('returns days sorted ascending regardless of input order', () => {
    const rows = [
      { date: localMidnight(2026, 0, 5), mood: 5 },
      { date: localMidnight(2026, 0, 1), mood: 5 },
      { date: localMidnight(2026, 0, 3), mood: 5 },
    ];
    expect(aggregateDailyAverages(rows).map((d) => d.day)).toEqual([
      '2026-01-01',
      '2026-01-03',
      '2026-01-05',
    ]);
  });

  it('rounds to 1 dp like the old ROUND(AVG(mood),1)', () => {
    const rows = [
      { date: localMidnight(2026, 2, 1), mood: 5 },
      { date: localMidnight(2026, 2, 1), mood: 6 },
      { date: localMidnight(2026, 2, 1), mood: 6 },
    ]; // 17/3 = 5.666... -> 5.7
    expect(aggregateDailyAverages(rows)[0]).toEqual({ day: '2026-03-01', avg: 5.7, count: 3 });
  });

  it('never throws on degenerate input (empty / null date / non-finite mood)', () => {
    expect(aggregateDailyAverages([])).toEqual([]);
    expect(
      aggregateDailyAverages([
        { date: 'not-a-date', mood: 5 } as any,
        { date: null as any, mood: 5 },
        { date: localMidnight(2026, 5, 11), mood: NaN as any },
        { date: localMidnight(2026, 5, 11), mood: Infinity as any },
      ]),
    ).toEqual([]);
  });

  it('drops invalid moods but keeps a day that has at least one valid mood', () => {
    const rows = [
      { date: localMidnight(2026, 5, 11), mood: NaN as any },
      { date: localMidnight(2026, 5, 11), mood: 9 },
    ];
    expect(aggregateDailyAverages(rows)).toEqual([
      { day: '2026-06-11', avg: 9, count: 1 },
    ]);
  });
});

describe('dailyAverageMap', () => {
  it('maps local day -> average', () => {
    const map = dailyAverageMap([
      { date: localMidnight(2026, 5, 11), mood: 6 },
      { date: localMidnight(2026, 5, 12), mood: 8 },
    ]);
    expect(map.get('2026-06-11')).toBe(6);
    expect(map.get('2026-06-12')).toBe(8);
    expect(map.get('2026-06-10')).toBeUndefined(); // not the UTC day
  });
});

describe('dailyAverageRows', () => {
  it('produces {date, avgMood} rows (the chart-transform shape), local-day-keyed', () => {
    const rows = dailyAverageRows([
      { date: localMidnight(2026, 5, 11), mood: 6 }, // Thu local / Wed UTC
      { date: localMidnight(2026, 5, 12), mood: 8 },
    ]);
    expect(rows).toEqual([
      { date: '2026-06-11', avgMood: 6 },
      { date: '2026-06-12', avgMood: 8 },
    ]);
  });

  it('returns [] for empty input', () => {
    expect(dailyAverageRows([])).toEqual([]);
  });
});

describe('bestDayLocal', () => {
  it('returns the local day with the highest average', () => {
    const rows = [
      { date: localMidnight(2026, 5, 11), mood: 4 },
      { date: localMidnight(2026, 5, 12), mood: 9 }, // best
      { date: localMidnight(2026, 5, 13), mood: 7 },
    ];
    expect(bestDayLocal(rows)).toBe('2026-06-12');
  });

  it('resolves ties to the EARLIEST day (matches old ORDER BY day LIMIT 1)', () => {
    const rows = [
      { date: localMidnight(2026, 5, 13), mood: 9 },
      { date: localMidnight(2026, 5, 11), mood: 9 }, // tie, earlier
    ];
    expect(bestDayLocal(rows)).toBe('2026-06-11');
  });

  it('returns empty string for no entries', () => {
    expect(bestDayLocal([])).toBe('');
  });

  it('picks the correct best day even when a backdated entry would mis-key in UTC', () => {
    // The best day is the backdated local Thursday; under UTC keying it would
    // have been attributed to Wednesday.
    const rows = [
      { date: localMidnight(2026, 5, 11), mood: 10 }, // Thu local / Wed UTC, best
      { date: localMidnight(2026, 5, 12), mood: 3 },
    ];
    expect(bestDayLocal(rows)).toBe('2026-06-11');
  });
});
