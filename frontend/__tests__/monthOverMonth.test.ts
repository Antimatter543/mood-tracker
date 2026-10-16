import {
  computeMonthOverMonth,
  FLAT_THRESHOLD,
  monthOverMonthLabels,
  type MonthMoodRow,
} from '@/components/visualisations/transforms/monthOverMonth';
import { DATE_FORMAT_PREFS, type DateFormatPref } from '@/lib/dateFormat';

const m = (avg: number | null, count: number): MonthMoodRow => ({
  avg_mood: avg,
  entry_count: count,
});

describe('computeMonthOverMonth', () => {
  it('computes delta as current - previous', () => {
    const out = computeMonthOverMonth(m(7.1, 22), m(6.8, 18), 30, 31);
    expect(out.delta).toBeCloseTo(0.3, 5);
  });

  it('classifies trend up when delta exceeds the flat threshold', () => {
    const out = computeMonthOverMonth(m(7.5, 10), m(6.0, 10), 30, 30);
    expect(out.trend).toBe('up');
  });

  it('classifies trend down for a clear decrease', () => {
    const out = computeMonthOverMonth(m(5.0, 10), m(7.0, 10), 30, 30);
    expect(out.trend).toBe('down');
  });

  it('classifies trend flat when |delta| < FLAT_THRESHOLD', () => {
    const out = computeMonthOverMonth(
      m(6.2, 10),
      m(6.0, 10), // delta 0.2 < 0.3
      30,
      30,
    );
    expect(Math.abs(out.delta)).toBeLessThan(FLAT_THRESHOLD);
    expect(out.trend).toBe('flat');
  });

  it('caps consistency at 100%', () => {
    // 40 entries in a 30-day month -> would be 133%, capped to 100
    const out = computeMonthOverMonth(m(7, 40), m(6, 15), 30, 31);
    expect(out.currentConsistencyPct).toBe(100);
  });

  it('computes consistency as entries / daysInMonth * 100', () => {
    const out = computeMonthOverMonth(m(7, 15), m(6, 10), 30, 31);
    expect(out.currentConsistencyPct).toBeCloseTo(50);
    expect(out.previousConsistencyPct).toBeCloseTo((10 / 31) * 100);
  });

  it('coerces null averages to 0 (empty month)', () => {
    const out = computeMonthOverMonth(m(null, 0), m(6.5, 10), 30, 31);
    expect(out.currentAvg).toBe(0);
    expect(out.previousAvg).toBeCloseTo(6.5);
    expect(out.currentEntryCount).toBe(0);
  });

  it('avoids division by zero when daysInMonth is 0', () => {
    const out = computeMonthOverMonth(m(7, 5), m(6, 5), 0, 0);
    expect(out.currentConsistencyPct).toBe(0);
    expect(out.previousConsistencyPct).toBe(0);
  });
});

/**
 * THE BUG: the Stats "Month over Month" card captioned its two columns from a
 * private hardcoded month table, so a user who picked ISO in Settings still read
 * "January (this month)" over a screen of "2026-01-05" dates.
 *
 * A month name has no day/month order, so MM/DD and DD/MM legitimately agree
 * here; only ISO differs. And `system` must keep the card's pre-setting bytes,
 * which were ENGLISH month names (a hardcoded table, not the device locale),
 * so it is checked against that table rather than against `toLocaleDateString`.
 */
describe('monthOverMonthLabels', () => {
  // The table this fix deleted from MonthOverMonthCard, verbatim.
  const LEGACY_MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  // June 2026 against May 2026: nothing special about the year.
  const JUNE = new Date(2026, 5, 1);
  const MAY = new Date(2026, 4, 1);
  // January against December: the previous month lives in the PREVIOUS YEAR.
  const JANUARY = new Date(2026, 0, 1);
  const DECEMBER = new Date(2025, 11, 1);

  it.each([
    ['system', 'June', 'May'],
    ['mdy', 'June', 'May'],
    ['dmy', 'June', 'May'],
    ['ymd', '2026-06', '2026-05'],
  ] as Array<[DateFormatPref, string, string]>)(
    'captions June / May under %s -> %s / %s',
    (pref, current, previous) => {
      expect(monthOverMonthLabels(JUNE, MAY, pref)).toEqual({ current, previous });
    },
  );

  it.each([
    ['system', 'January', 'December'],
    ['mdy', 'January', 'December'],
    ['dmy', 'January', 'December'],
    ['ymd', '2026-01', '2025-12'],
  ] as Array<[DateFormatPref, string, string]>)(
    'carries the year back across New Year under %s -> %s / %s',
    (pref, current, previous) => {
      expect(monthOverMonthLabels(JANUARY, DECEMBER, pref)).toEqual({ current, previous });
    },
  );

  it('mdy and dmy agree for every month (a month alone has no day/month order)', () => {
    for (let month = 0; month < 12; month++) {
      const cur = new Date(2026, month, 1);
      const prev = new Date(2026, month - 1, 1);
      expect(monthOverMonthLabels(cur, prev, 'dmy')).toEqual(
        monthOverMonthLabels(cur, prev, 'mdy'),
      );
    }
  });

  it("keeps `system` byte-identical to the card's old MONTH_NAMES lookup, all 12 months", () => {
    for (let month = 0; month < 12; month++) {
      // How the card used to derive its two headings from `now`'s month index.
      const legacy = {
        current: LEGACY_MONTH_NAMES[month],
        previous: LEGACY_MONTH_NAMES[(month + 11) % 12],
      };
      const cur = new Date(2026, month, 1);
      const prev = new Date(2026, month - 1, 1);
      expect(monthOverMonthLabels(cur, prev, 'system')).toEqual(legacy);
    }
  });

  it('writes every ISO heading as a full YYYY-MM', () => {
    for (let month = 0; month < 12; month++) {
      const { current, previous } = monthOverMonthLabels(
        new Date(2026, month, 1),
        new Date(2026, month - 1, 1),
        'ymd',
      );
      expect(current).toMatch(/^\d{4}-\d{2}$/);
      expect(previous).toMatch(/^\d{4}-\d{2}$/);
    }
  });

  it('names a month from any day inside it (the card passes the 1st; a later day agrees)', () => {
    for (const pref of DATE_FORMAT_PREFS) {
      expect(monthOverMonthLabels(new Date(2026, 5, 30), new Date(2026, 4, 31), pref)).toEqual(
        monthOverMonthLabels(JUNE, MAY, pref),
      );
    }
  });
});
