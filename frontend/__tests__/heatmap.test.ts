import {
  buildHeatmapGrid,
  mirrorWeekIndex,
  type HeatmapInput,
} from '@/components/visualisations/transforms/heatmap';
import { DATE_FORMAT_PREFS, type DateFormatPref } from '@/lib/dateFormat';

// The grid tests below are about layout, not labels: they run under the default
// preference, which is what an existing user has.
const SYSTEM: DateFormatPref = 'system';

describe('buildHeatmapGrid', () => {
  it('returns an empty grid for empty input', () => {
    const out = buildHeatmapGrid([], SYSTEM);
    expect(out.cells).toEqual([]);
    expect(out.monthLabels).toEqual([]);
    expect(out.totalWeeks).toBe(0);
  });

  // Regression: empty `entries` table → heatmap SQL returns a single row with
  // date: null, which previously reached `new Date("nullT00:00:00Z")` and threw
  // `RangeError: Date value out of bounds`, white-screening the Stats screen.
  it('returns an empty grid (does not throw) for a single null-date row', () => {
    const rows = [{ date: null, mood: null }] as unknown as HeatmapInput[];
    let out: ReturnType<typeof buildHeatmapGrid>;
    expect(() => {
      out = buildHeatmapGrid(rows, SYSTEM);
    }).not.toThrow();
    expect(out!.cells).toEqual([]);
    expect(out!.monthLabels).toEqual([]);
    expect(out!.totalWeeks).toBe(0);
  });

  it('returns an empty grid (does not throw) for a garbage date string', () => {
    const rows = [{ date: 'garbage', mood: 5 }] as unknown as HeatmapInput[];
    let out: ReturnType<typeof buildHeatmapGrid>;
    expect(() => {
      out = buildHeatmapGrid(rows, SYSTEM);
    }).not.toThrow();
    expect(out!.cells).toEqual([]);
    expect(out!.totalWeeks).toBe(0);
  });

  it('drops degenerate rows but keeps valid ones', () => {
    const rows = [
      { date: null, mood: null },
      { date: '2025-06-16', mood: 5 },
      { date: 'garbage', mood: 9 },
    ] as unknown as HeatmapInput[];
    const out = buildHeatmapGrid(rows, SYSTEM);
    const cell = out.cells.find((c) => c.date === '2025-06-16');
    expect(cell?.mood).toBe(5);
    expect(out.cells.length).toBeGreaterThan(0);
  });

  it('produces cells in Monday-start week ordering (day 0 = Mon)', () => {
    // 2025-06-15 is a Sunday → dayIndex 6 under Monday-start convention
    const rows: HeatmapInput[] = [
      { date: '2025-06-15', mood: 7 },
    ];
    const out = buildHeatmapGrid(rows, SYSTEM);
    const cell = out.cells.find((c) => c.date === '2025-06-15');
    expect(cell?.dayIndex).toBe(6);
  });

  it('aligns Monday to dayIndex 0', () => {
    // 2025-06-16 is a Monday
    const rows: HeatmapInput[] = [{ date: '2025-06-16', mood: 5 }];
    const out = buildHeatmapGrid(rows, SYSTEM);
    const cell = out.cells.find((c) => c.date === '2025-06-16');
    expect(cell?.dayIndex).toBe(0);
    expect(cell?.weekIndex).toBe(0); // starts the grid
  });

  it('snaps the grid start back to the previous Monday', () => {
    // 2025-06-15 is a Sunday. The grid should start on Monday 2025-06-09.
    const rows: HeatmapInput[] = [{ date: '2025-06-15', mood: 7 }];
    const out = buildHeatmapGrid(rows, SYSTEM);
    expect(out.cells[0].date).toBe('2025-06-09');
    expect(out.cells[0].dayIndex).toBe(0);
  });

  it('produces a full month of cells (sparse mood lookup)', () => {
    // Build 30 days of data, but mood only on every 3rd day.
    const rows: HeatmapInput[] = Array.from({ length: 30 }, (_, i) => {
      const day = String(i + 1).padStart(2, '0');
      return { date: `2025-06-${day}`, mood: i % 3 === 0 ? 7 : null };
    });
    const out = buildHeatmapGrid(rows, SYSTEM);
    // Every cell in [June 1..June 30] should have a mood lookup; gaps elsewhere stay null.
    const within = out.cells.filter(
      (c) => c.date >= '2025-06-01' && c.date <= '2025-06-30',
    );
    expect(within.length).toBe(30);
    const withMood = within.filter((c) => c.mood === 7);
    expect(withMood.length).toBe(10);
  });

  it('emits one month label per distinct month', () => {
    const rows: HeatmapInput[] = [
      { date: '2025-05-15', mood: 5 },
      { date: '2025-06-15', mood: 6 },
      { date: '2025-07-15', mood: 7 },
    ];
    const out = buildHeatmapGrid(rows, SYSTEM);
    const months = out.monthLabels.map((m) => m.month);
    // First label carries the 2-digit year (year boundary / first label);
    // subsequent same-year months are bare. Verify all 3 are present.
    expect(months[0]).toMatch(/^[A-Za-z]{3} \d{2}$/); // e.g. "May 25"
    expect(months).toEqual(expect.arrayContaining(['Jun', 'Jul']));
  });

  it('tags January (year boundary) with the 2-digit year', () => {
    // Span Dec 2025 → Feb 2026: January gets the year so columns are unambiguous.
    const rows: HeatmapInput[] = [
      { date: '2025-12-15', mood: 5 },
      { date: '2026-01-15', mood: 6 },
      { date: '2026-02-15', mood: 7 },
    ];
    const out = buildHeatmapGrid(rows, SYSTEM);
    const months = out.monthLabels.map((m) => m.month);
    // January of the new year is labelled "Jan 26"; Feb stays bare.
    expect(months).toEqual(expect.arrayContaining(['Jan 26', 'Feb']));
  });
});

/**
 * THE BUG: the heatmap's month-column labels ignored the `date_format` setting.
 * They were hardcoded `toLocaleDateString('en-US', ...)`, so a user who picked
 * ISO still read "Jan 26" over the columns while every other date said
 * "2026-01-05".
 *
 * Month-name labels have no day/month order, so MM/DD and DD/MM legitimately
 * agree; only ISO differs. `system` must keep the pre-setting bytes (English
 * short month), which is why it is checked against the OLD implementation below
 * rather than against a string typed from memory.
 */
describe('buildHeatmapGrid — month labels follow the date format setting', () => {
  const monthsOf = (rows: HeatmapInput[], pref: DateFormatPref) =>
    buildHeatmapGrid(rows, pref).monthLabels.map((m) => m.month);

  // Mon 2025-12-15 .. Sun 2026-02-15: the first Mondays of Dec / Jan / Feb are
  // 12-15, 01-05, 02-02, so the labels sit at weeks 0, 3, 7.
  const ACROSS_NEW_YEAR: HeatmapInput[] = [
    { date: '2025-12-15', mood: 5 },
    { date: '2026-01-15', mood: 6 },
    { date: '2026-02-15', mood: 7 },
  ];

  it.each([
    ['system', ['Dec 25', 'Jan 26', 'Feb']],
    ['mdy', ['Dec 25', 'Jan 26', 'Feb']],
    ['dmy', ['Dec 25', 'Jan 26', 'Feb']],
    ['ymd', ['2025-12', '2026-01', '2026-02']],
  ] as Array<[DateFormatPref, string[]]>)(
    'labels the columns for %s -> %j',
    (pref, expected) => {
      expect(monthsOf(ACROSS_NEW_YEAR, pref)).toEqual(expected);
    },
  );

  it('mdy and dmy agree for every month (a month alone has no day/month order)', () => {
    const rows: HeatmapInput[] = [
      { date: '2025-03-10', mood: 5 },
      { date: '2026-04-20', mood: 6 },
    ];
    expect(monthsOf(rows, 'dmy')).toEqual(monthsOf(rows, 'mdy'));
  });

  it("keeps `system` byte-identical to the heatmap's pre-setting labels, across 14 months", () => {
    // The implementation this PR replaced, verbatim, as the oracle.
    const legacy = (dateStr: string, isYearStart: boolean): string => {
      const d = new Date(`${dateStr}T00:00:00Z`);
      const month = d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
      return isYearStart ? `${month} ${String(d.getUTCFullYear()).slice(-2)}` : month;
    };
    const grid = buildHeatmapGrid(
      [
        { date: '2025-05-15', mood: 5 },
        { date: '2026-07-15', mood: 7 },
      ],
      'system',
    );
    expect(grid.monthLabels.length).toBeGreaterThanOrEqual(14);
    grid.monthLabels.forEach((label, i) => {
      // The label's own column: the Monday cell at that week.
      const monday = grid.cells.find((c) => c.weekIndex === label.weekIndex && c.dayIndex === 0)!;
      const isYearStart = i === 0 || monday.date.slice(5, 7) === '01';
      expect(label.month).toBe(legacy(monday.date, isYearStart));
    });
  });

  it('carries the year on the FIRST label even when it is not January, and on every January', () => {
    const labels = monthsOf(
      [
        { date: '2025-09-10', mood: 5 },
        { date: '2026-03-10', mood: 6 },
      ],
      'mdy',
    );
    expect(labels[0]).toBe('Sep 25');
    expect(labels).toContain('Jan 26');
    // Everything else is bare.
    expect(labels.filter((l) => /\d/.test(l))).toEqual(['Sep 25', 'Jan 26']);
  });

  it('writes every ISO label as a full YYYY-MM (the year is part of the numeric month)', () => {
    const labels = monthsOf(
      [
        { date: '2025-09-10', mood: 5 },
        { date: '2026-03-10', mood: 6 },
      ],
      'ymd',
    );
    expect(labels.length).toBeGreaterThan(2);
    for (const label of labels) expect(label).toMatch(/^\d{4}-\d{2}$/);
  });

  it('names the month of a Monday that is the 1st of the month (no UTC day slip)', () => {
    // 2026-06-01 is a Monday. The label has to come from the day KEY: formatting
    // the grid's internal UTC-midnight instant with local getters names May 31
    // (so "May", not "Jun") for anyone west of UTC. The suite runs east of UTC
    // and in UTC, where that bug is invisible — run it with
    // `TZ=America/Los_Angeles npx jest __tests__/heatmap.test.ts` to see it bite.
    const rows: HeatmapInput[] = [
      { date: '2026-05-20', mood: 5 },
      { date: '2026-06-20', mood: 6 },
    ];
    expect(monthsOf(rows, 'mdy')).toEqual(['May 26', 'Jun']);
    expect(monthsOf(rows, 'ymd')).toEqual(['2026-05', '2026-06']);
  });

  it('only changes the label TEXT: the cells and the label columns are identical for every preference', () => {
    const base = buildHeatmapGrid(ACROSS_NEW_YEAR, 'system');
    for (const pref of DATE_FORMAT_PREFS) {
      const grid = buildHeatmapGrid(ACROSS_NEW_YEAR, pref);
      expect(grid.cells).toEqual(base.cells);
      expect(grid.totalWeeks).toBe(base.totalWeeks);
      expect(grid.monthLabels.map((m) => m.weekIndex)).toEqual([0, 3, 7]);
    }
  });

  it('an empty grid stays empty under every preference', () => {
    for (const pref of DATE_FORMAT_PREFS) {
      expect(buildHeatmapGrid([], pref)).toEqual({ cells: [], monthLabels: [], totalWeeks: 0 });
    }
  });
});

describe('mirrorWeekIndex', () => {
  // The heatmap mirrors its chronological week columns so the NEWEST week
  // renders on the LEFT edge (mirrored index 0) and older weeks extend right.
  it('maps the newest week (weekIndex = totalWeeks-1) to the leftmost column (0)', () => {
    expect(mirrorWeekIndex(9, 10)).toBe(0);
  });

  it('maps the oldest week (weekIndex 0) to the rightmost column (totalWeeks-1)', () => {
    expect(mirrorWeekIndex(0, 10)).toBe(9);
  });

  it('maps a middle week symmetrically', () => {
    // 11 columns (0..10): the centre column 5 maps to itself.
    expect(mirrorWeekIndex(5, 11)).toBe(5);
    // An off-centre column mirrors to its reflected position.
    expect(mirrorWeekIndex(3, 11)).toBe(7);
    expect(mirrorWeekIndex(7, 11)).toBe(3);
  });

  it('is its own inverse (mirroring twice is identity)', () => {
    const totalWeeks = 8;
    for (let w = 0; w < totalWeeks; w++) {
      expect(mirrorWeekIndex(mirrorWeekIndex(w, totalWeeks), totalWeeks)).toBe(w);
    }
  });

  it('maps the only column to 0 when totalWeeks = 1', () => {
    expect(mirrorWeekIndex(0, 1)).toBe(0);
  });

  it('is defensive on degenerate totalWeeks (<= 0 → 0)', () => {
    expect(mirrorWeekIndex(0, 0)).toBe(0);
  });
});
