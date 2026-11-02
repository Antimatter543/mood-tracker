/**
 * Issue #7: Home and Statistics showed "61-day streak / best 61" while Insights
 * showed 90 for the same 90 days, because each screen fed the streak transform a
 * different slice of history. `loadStreakStats` is now the only way a screen gets
 * the user's streak, and it takes no window. Two layers: the loader (mock db) and
 * a source scan that keeps the screens on it (a class-level invariant, like
 * queriesNoDateBucketing).
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { createMockDatabase } from 'expo-sqlite';
import { loadStreakStats } from '@/components/visualisations/loadStreakStats';
import { ALL_ENTRY_INSTANTS } from '@/components/visualisations/queries';
import { localDateString } from '@/databases/dateHelpers';

jest.mock('expo-sqlite');

const fakeDb = (rows: { date: string }[]) => {
  const db = createMockDatabase();
  db.getAllAsync.mockResolvedValue(rows);
  return db;
};

/** 90 consecutive local days from Apr 1 2026, one entry each, as DB rows. */
const ninetyDays = (): { date: string }[] =>
  Array.from({ length: 90 }, (_, i) => ({
    date: new Date(2026, 3, 1 + i, 12).toISOString(),
  }));
const TODAY = localDateString(new Date(2026, 3, 90, 12)); // day 90 of the run

describe('loadStreakStats', () => {
  it('reads every live entry with NO bound parameters (no lookback window)', async () => {
    const db = fakeDb(ninetyDays());
    await loadStreakStats(db as never, TODAY);
    expect(db.getAllAsync).toHaveBeenCalledTimes(1);
    // Exactly one argument: the SQL. A window would arrive as a params array.
    expect(db.getAllAsync).toHaveBeenCalledWith(ALL_ENTRY_INSTANTS);
  });

  it('90 consecutive days -> current 90 and best 90 (was 61 / 61 on Home and Stats)', async () => {
    const s = await loadStreakStats(fakeDb(ninetyDays()) as never, TODAY);
    expect(s.current).toBe(90);
    expect(s.longest).toBe(90);
  });

  it('a fresh install (no rows) is zeros', async () => {
    const s = await loadStreakStats(fakeDb([]) as never, TODAY);
    expect(s).toEqual({ current: 0, longest: 0, days: [] });
  });
});

describe('every surface gets its streak from loadStreakStats', () => {
  const ROOT = join(__dirname, '..');
  const SCAN_DIRS = ['app', 'components', 'context', 'databases', 'hooks', 'lib'];

  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) return walk(p);
      return /\.tsx?$/.test(name) ? [p] : [];
    });

  const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

  const sources = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d))).map((file) => ({
    file: relative(ROOT, file),
    code: stripComments(readFileSync(file, 'utf8')),
  }));

  // Who may call what. The day-string primitives are private to the transform.
  // `streakStats` is reached through the loader (all history), with ONE sanctioned
  // exception: Statistics' past-period "Best streak" is a statistic OF the viewed
  // period, so it feeds `streakStats` that period's own rows on purpose.
  const STREAK = join('components', 'visualisations', 'transforms', 'streak.ts');
  const LOADER = join('components', 'visualisations', 'loadStreakStats.ts');
  const STATS_CARD = join('components', 'visualisations', 'StatSummaryCard.tsx');

  const filesCalling = (call: RegExp, allowed: string[]): string[] =>
    sources
      .filter(({ file, code }) => !allowed.includes(file) && call.test(code))
      .map(({ file }) => file);

  it('scans a real source tree (guards against an empty scan)', () => {
    expect(sources.length).toBeGreaterThan(50);
  });

  it('currentStreak / longestStreak are private to the transform', () => {
    expect(filesCalling(/\b(?:currentStreak|longestStreak)\s*\(/, [STREAK])).toEqual([]);
  });

  it('streakStats is called only by the loader and the Statistics period-best', () => {
    expect(filesCalling(/\bstreakStats\s*\(/, [STREAK, LOADER, STATS_CARD])).toEqual([]);
  });

  it.each([
    join('app', '(tabs)', 'index.tsx'),
    join('app', '(tabs)', 'insights.tsx'),
    join('app', '(tabs)', '_layout.tsx'),
    join('components', 'visualisations', 'StatSummaryCard.tsx'),
  ])('%s reads its streak through loadStreakStats', (file) => {
    const entry = sources.find((s) => s.file === file);
    expect(entry?.code).toMatch(/\bloadStreakStats\s*\(/);
  });
});
