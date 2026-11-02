/**
 * `streakStats` is THE streak authority (issue #7). It takes the raw stored
 * instants (UTC ISO strings) and owns local-day keying + the rule, so these tests
 * feed it INSTANTS, never pre-keyed day strings, built with the LOCAL Date
 * constructor (`at`) so a UTC-keyed implementation lands on the wrong day.
 */
import { streakStats } from '@/components/visualisations/transforms/streak';
import { localDateString } from '@/databases/dateHelpers';

/** Stored instant for LOCAL time y-m-d h:mi (month is 1-based). */
const at = (y: number, m: number, d: number, h = 12, mi = 0): string =>
  new Date(y, m - 1, d, h, mi).toISOString();

/** `n` consecutive local days starting at the given day, one noon entry each. */
const run = (y: number, m: number, d: number, n: number): string[] =>
  Array.from({ length: n }, (_, i) => at(y, m, d + i));

describe('streakStats: the rule', () => {
  it('empty data is a zero streak, not a crash', () => {
    expect(streakStats([], '2026-06-15')).toEqual({ current: 0, longest: 0, days: [] });
  });

  it('a single entry today is a 1-day streak', () => {
    expect(streakStats([at(2026, 6, 15)], '2026-06-15')).toEqual({
      current: 1,
      longest: 1,
      days: ['2026-06-15'],
    });
  });

  it('a missing day breaks the run: nothing bridges a gap', () => {
    // Jun 1-4, GAP Jun 5, Jun 6-7. Today is Jun 7.
    const entries = [...run(2026, 6, 1, 4), ...run(2026, 6, 6, 2)];
    const s = streakStats(entries, '2026-06-07');
    expect(s.current).toBe(2);
    expect(s.longest).toBe(4);
  });

  it('today not logged yet keeps yesterday\'s streak alive (no break in the morning)', () => {
    const entries = run(2026, 6, 12, 3); // Jun 12, 13, 14
    expect(streakStats(entries, '2026-06-15').current).toBe(3);
  });

  it('but two days without an entry ends the current streak (best is kept)', () => {
    const entries = run(2026, 6, 12, 3); // last entry Jun 14
    const s = streakStats(entries, '2026-06-16');
    expect(s.current).toBe(0);
    expect(s.longest).toBe(3);
  });

  it('several entries on one day count as one day', () => {
    const entries = [
      at(2026, 6, 15, 7),
      at(2026, 6, 15, 13),
      at(2026, 6, 15, 22),
      at(2026, 6, 14, 9),
      at(2026, 6, 14, 21),
    ];
    const s = streakStats(entries, '2026-06-15');
    expect(s.current).toBe(2);
    expect(s.longest).toBe(2);
    expect(s.days).toEqual(['2026-06-14', '2026-06-15']);
  });

  it('is order-independent', () => {
    const entries = run(2026, 6, 10, 6);
    const shuffled = [entries[3], entries[0], entries[5], entries[2], entries[4], entries[1]];
    expect(streakStats(shuffled, '2026-06-15')).toEqual(streakStats(entries, '2026-06-15'));
  });

  it('skips unparseable instants instead of throwing', () => {
    const s = streakStats(['not a date', '', at(2026, 6, 15)], '2026-06-15');
    expect(s.current).toBe(1);
    expect(s.days).toEqual(['2026-06-15']);
  });
});

describe('streakStats: issue #7 regression (no history window)', () => {
  const DAYS = 90;
  const last = new Date(2026, 3, 1 + DAYS - 1, 12); // Apr 1 + 89 days
  const today = localDateString(last);

  it('90 consecutive days is a 90-day streak and best 90, not a 61 cap', () => {
    const s = streakStats(run(2026, 4, 1, DAYS), today);
    expect(s.current).toBe(90);
    expect(s.longest).toBe(90);
  });

  it('a 1-day gap inside the history splits it honestly', () => {
    // Drop the 60th day: 59 days, GAP, 30 days (the last 30 end today).
    const all = run(2026, 4, 1, DAYS);
    const withGap = all.filter((_, i) => i !== 59);
    const s = streakStats(withGap, today);
    expect(s.current).toBe(30);
    expect(s.longest).toBe(59);
  });
});

describe('streakStats: local-day keying around midnight (the timezone-gap case)', () => {
  it('23:30 and 00:30 across local midnight are two different days, not a gap', () => {
    // In UTC+10 (the pinned zone) 23:30 Jun 8 = 13:30Z and 00:30 Jun 9 = 14:30Z:
    // the SAME UTC date, so UTC-keying collapses them and then sees a hole at Jun 9.
    const entries = [at(2026, 6, 8, 23, 30), at(2026, 6, 9, 0, 30), at(2026, 6, 10, 12)];
    const s = streakStats(entries, '2026-06-10');
    expect(s.days).toEqual(['2026-06-08', '2026-06-09', '2026-06-10']);
    expect(s.current).toBe(3);
  });

  it('an entry just after local midnight is TODAY, an entry just before stays on its day', () => {
    const entries = [at(2026, 6, 8, 23, 59), at(2026, 6, 9, 12), at(2026, 6, 10, 0, 5)];
    const s = streakStats(entries, '2026-06-10');
    expect(s.days).toEqual(['2026-06-08', '2026-06-09', '2026-06-10']);
    expect(s.current).toBe(3);
  });
});

describe('streakStats: DST changes do not break or double a day', () => {
  // Entries at 00:30 and 23:30 local on four consecutive days spanning a
  // transition. A day-length shortcut (`diff / 24h`) breaks on the 23h / 25h day;
  // calendar-day keying must see one unbroken 4-day run. Months are 1-based.
  //
  // NOTE: jest.tz.js pins the suite to Australia/Brisbane (no DST), where these
  // are ordinary days. The 23h/25h days are real when this file is run under a
  // DST zone: `TZ=America/New_York npx jest __tests__/streakStats.test.ts` (and
  // `TZ=Australia/Sydney`), which is how the DST behaviour was verified.
  it.each([
    ['US spring-forward (23h day, 2025-03-09)', [2025, 3, 8]],
    ['US fall-back (25h day, 2025-11-02)', [2025, 11, 1]],
    ['AU spring-forward (23h day, 2025-10-05)', [2025, 10, 4]],
    ['AU fall-back (25h day, 2026-04-05)', [2026, 4, 4]],
  ] as const)('%s', (_label, [y, m, d]) => {
    const entries = Array.from({ length: 4 }, (_, i) => [
      at(y, m, d + i, 0, 30),
      at(y, m, d + i, 23, 30),
    ]).flat();
    const lastDay = localDateString(new Date(y, m - 1, d + 3, 12));
    const s = streakStats(entries, lastDay);
    expect(s.days).toHaveLength(4);
    expect(s.current).toBe(4);
    expect(s.longest).toBe(4);
  });
});
