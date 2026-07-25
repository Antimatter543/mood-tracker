import {
  monthKey,
  monthWindowBounds,
  visibleMonthOf,
  monthCurrentString,
} from '@/components/visualisations/transforms/monthWindow';
import { localDateString } from '@/databases/dateHelpers';

// Brisbane pin (UTC+10). Bounds are UTC ISO instants of LOCAL month edges, for
// ANY visible month the user navigates to — not just today's.
describe('monthWindowBounds — arbitrary visible month', () => {
  it('spans the whole local month (first 00:00 local .. last 23:59:59.999 local)', () => {
    const { start, end } = monthWindowBounds({ year: 2026, month: 2 }); // Feb 2026
    // Local days of the bounds are Feb 1 and Feb 28 (2026 is not a leap year).
    expect(localDateString(start)).toBe('2026-02-01');
    expect(localDateString(end)).toBe('2026-02-28');
    // Exact instants: local midnight/23:59:59.999 shifted -10h to UTC.
    expect(start).toBe('2026-01-31T14:00:00.000Z');
    expect(end).toBe('2026-02-28T13:59:59.999Z');
  });

  it('handles 31-day months and December year-rollover', () => {
    expect(localDateString(monthWindowBounds({ year: 2026, month: 7 }).end)).toBe('2026-07-31');
    const dec = monthWindowBounds({ year: 2026, month: 12 });
    expect(localDateString(dec.start)).toBe('2026-12-01');
    expect(localDateString(dec.end)).toBe('2026-12-31');
  });

  it('handles a leap-year February (29 days)', () => {
    expect(localDateString(monthWindowBounds({ year: 2028, month: 2 }).end)).toBe('2028-02-29');
  });

  it('start < end for every month', () => {
    for (let m = 1; m <= 12; m++) {
      const { start, end } = monthWindowBounds({ year: 2026, month: m });
      expect(start < end).toBe(true);
    }
  });
});

describe('monthKey / monthCurrentString / visibleMonthOf', () => {
  it('monthKey zero-pads the month', () => {
    expect(monthKey({ year: 2026, month: 3 })).toBe('2026-03');
    expect(monthKey({ year: 2026, month: 11 })).toBe('2026-11');
  });

  it('monthCurrentString is the first of the month', () => {
    expect(monthCurrentString({ year: 2026, month: 3 })).toBe('2026-03-01');
  });

  it('visibleMonthOf reads the LOCAL year/month (1-indexed)', () => {
    // 14:00Z Dec 31 = 00:00 Jan 1 (next year) local -> {2027, 1}.
    expect(visibleMonthOf(new Date('2026-12-31T14:00:00.000Z'))).toEqual({
      year: 2027,
      month: 1,
    });
  });
});
