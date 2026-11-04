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
import { localIso } from '@/testing/builders';

describe('aggregateDailyAverages', () => {
  it('keys each entry to its LOCAL day and averages (1 dp)', () => {
    const rows = [
      { date: localIso('2026-06-11', 0), mood: 6 }, // Thu 11th local (Wed UTC)
      { date: localIso('2026-06-11', 18), mood: 8 }, // Thu 11th evening
      { date: localIso('2026-06-12', 0), mood: 4 }, // Fri 12th
    ];
    expect(aggregateDailyAverages(rows)).toEqual([
      { day: '2026-06-11', avg: 7, min: 6, max: 8, count: 2 },
      { day: '2026-06-12', avg: 4, min: 4, max: 4, count: 1 },
    ]);
  });

  it('returns days sorted ascending regardless of input order', () => {
    const rows = [
      { date: localIso('2026-01-05', 0), mood: 5 },
      { date: localIso('2026-01-01', 0), mood: 5 },
      { date: localIso('2026-01-03', 0), mood: 5 },
    ];
    expect(aggregateDailyAverages(rows).map((d) => d.day)).toEqual([
      '2026-01-01',
      '2026-01-03',
      '2026-01-05',
    ]);
  });

  it('tracks the lowest and highest mood per local day, in any row order', () => {
    const rows = [
      { date: localIso('2026-06-11', 20), mood: 5 },
      { date: localIso('2026-06-11', 8), mood: 9 },
      { date: localIso('2026-06-11', 12), mood: 2 },
    ];
    expect(aggregateDailyAverages(rows)[0]).toMatchObject({ min: 2, max: 9, count: 3 });
  });

  it('a single-entry day has min == max == its mood (a real value, not null)', () => {
    const [d] = aggregateDailyAverages([{ date: localIso('2026-06-11', 0), mood: 7 }]);
    expect(d.min).toBe(7);
    expect(d.max).toBe(7);
  });

  it('rounds to 1 dp like the old ROUND(AVG(mood),1)', () => {
    const rows = [
      { date: localIso('2026-03-01', 0), mood: 5 },
      { date: localIso('2026-03-01', 0), mood: 6 },
      { date: localIso('2026-03-01', 0), mood: 6 },
    ]; // 17/3 = 5.666... -> 5.7
    expect(aggregateDailyAverages(rows)[0]).toEqual({ day: '2026-03-01', avg: 5.7, min: 5, max: 6, count: 3 });
  });

  it('never throws on degenerate input (empty / null date / non-finite mood)', () => {
    expect(aggregateDailyAverages([])).toEqual([]);
    expect(
      aggregateDailyAverages([
        { date: 'not-a-date', mood: 5 } as any,
        { date: null as any, mood: 5 },
        { date: localIso('2026-06-11', 0), mood: NaN as any },
        { date: localIso('2026-06-11', 0), mood: Infinity as any },
      ]),
    ).toEqual([]);
  });

  it('drops invalid moods but keeps a day that has at least one valid mood', () => {
    const rows = [
      { date: localIso('2026-06-11', 0), mood: NaN as any },
      { date: localIso('2026-06-11', 0), mood: 9 },
    ];
    expect(aggregateDailyAverages(rows)).toEqual([
      { day: '2026-06-11', avg: 9, min: 9, max: 9, count: 1 },
    ]);
  });
});

describe('dailyAverageMap', () => {
  it('maps local day -> average', () => {
    const map = dailyAverageMap([
      { date: localIso('2026-06-11', 0), mood: 6 },
      { date: localIso('2026-06-12', 0), mood: 8 },
    ]);
    expect(map.get('2026-06-11')).toBe(6);
    expect(map.get('2026-06-12')).toBe(8);
    expect(map.get('2026-06-10')).toBeUndefined(); // not the UTC day
  });
});

describe('dailyAverageRows', () => {
  it('produces {date, avgMood} rows (the chart-transform shape), local-day-keyed', () => {
    const rows = dailyAverageRows([
      { date: localIso('2026-06-11', 0), mood: 6 }, // Thu local / Wed UTC
      { date: localIso('2026-06-12', 0), mood: 8 },
    ]);
    expect(rows).toEqual([
      { date: '2026-06-11', avgMood: 6, minMood: 6, maxMood: 6 },
      { date: '2026-06-12', avgMood: 8, minMood: 8, maxMood: 8 },
    ]);
  });

  it('returns [] for empty input', () => {
    expect(dailyAverageRows([])).toEqual([]);
  });
});

describe('bestDayLocal', () => {
  it('returns the local day with the highest average', () => {
    const rows = [
      { date: localIso('2026-06-11', 0), mood: 4 },
      { date: localIso('2026-06-12', 0), mood: 9 }, // best
      { date: localIso('2026-06-13', 0), mood: 7 },
    ];
    expect(bestDayLocal(rows)).toBe('2026-06-12');
  });

  it('resolves ties to the EARLIEST day (matches old ORDER BY day LIMIT 1)', () => {
    const rows = [
      { date: localIso('2026-06-13', 0), mood: 9 },
      { date: localIso('2026-06-11', 0), mood: 9 }, // tie, earlier
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
      { date: localIso('2026-06-11', 0), mood: 10 }, // Thu local / Wed UTC, best
      { date: localIso('2026-06-12', 0), mood: 3 },
    ];
    expect(bestDayLocal(rows)).toBe('2026-06-11');
  });
});
