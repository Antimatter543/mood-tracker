import {
  monthKey,
  gridWindowBounds,
  visibleMonthOf,
  monthCurrentString,
  CALENDAR_FIRST_DAY,
} from '@/components/visualisations/transforms/monthWindow';
import { localDateString } from '@/databases/dateHelpers';

// Brisbane pin (UTC+10). Bounds are UTC ISO instants of LOCAL grid edges. The
// window is the WHOLE week-aligned grid react-native-calendars renders for a
// month — the month PLUS the leading/trailing adjacent-month days that share the
// first/last rendered week — so every drawn cell has data on first render (the
// Bug A fix). firstDay defaults to Monday (CALENDAR_FIRST_DAY).
//
// The calendar dates used below are fixed facts (a given Y-M-D's weekday is the
// same in every timezone): July 1 2026 = Wed, June 1 2026 = Mon, Feb 1 2026 =
// Sun, Dec 1 2026 = Tue.
describe('gridWindowBounds — week-aligned rendered grid', () => {
  it('a month starting mid-week spills into BOTH neighbours (July 2026)', () => {
    // July 1 2026 is a Wednesday → the first Monday-week row leads with Jun 29,
    // Jun 30 (Bug A repro: those cells must be fetched). July 31 is a Friday →
    // the last row trails into Aug 1, Aug 2 (Sunday).
    const { start, end } = gridWindowBounds({ year: 2026, month: 7 });
    expect(localDateString(start)).toBe('2026-06-29'); // Monday of the first row
    expect(localDateString(end)).toBe('2026-08-02'); // Sunday of the last row
    // The QA-reported leading spill-over day (Jun 30) is INSIDE the window.
    expect(localDateString(start) <= '2026-06-30' && '2026-06-30' <= localDateString(end)).toBe(true);
    // Exact instants: local midnight/23:59:59.999 shifted -10h to UTC.
    expect(start).toBe('2026-06-28T14:00:00.000Z');
    expect(end).toBe('2026-08-02T13:59:59.999Z');
  });

  it('a month whose 1st IS the week-start has no LEADING spill (June 2026)', () => {
    // June 1 2026 is a Monday → the grid starts exactly on the 1st.
    const { start, end } = gridWindowBounds({ year: 2026, month: 6 });
    expect(localDateString(start)).toBe('2026-06-01');
    // June 30 is a Tuesday → the last row trails to Sunday July 5.
    expect(localDateString(end)).toBe('2026-07-05');
  });

  it('handles a non-leap February (Feb 2026, 28 days)', () => {
    // Feb 1 2026 = Sunday → leads back to Jan 26; Feb 28 = Saturday → trails to Mar 1.
    const { start, end } = gridWindowBounds({ year: 2026, month: 2 });
    expect(localDateString(start)).toBe('2026-01-26');
    expect(localDateString(end)).toBe('2026-03-01');
  });

  it('handles a leap February — Feb 29 falls INSIDE the window (Feb 2028)', () => {
    // Feb 1 2028 = Tuesday → leads back to Jan 31; Feb 29 = Tuesday → trails to Mar 5.
    const { start, end } = gridWindowBounds({ year: 2028, month: 2 });
    expect(localDateString(start)).toBe('2028-01-31');
    expect(localDateString(end)).toBe('2028-03-05');
    expect(localDateString(start) <= '2028-02-29' && '2028-02-29' <= localDateString(end)).toBe(true);
  });

  it('handles December year-rollover on BOTH grid edges (Dec 2026)', () => {
    // Dec 1 2026 = Tuesday → leads back to Nov 30; Dec 31 = Thursday → trails into 2027.
    const { start, end } = gridWindowBounds({ year: 2026, month: 12 });
    expect(localDateString(start)).toBe('2026-11-30');
    expect(localDateString(end)).toBe('2027-01-03');
  });

  it('respects firstDay — Sunday-start shifts the grid by a day (July 2026)', () => {
    const monday = gridWindowBounds({ year: 2026, month: 7 }, 1); // default
    const sunday = gridWindowBounds({ year: 2026, month: 7 }, 0);
    expect(localDateString(sunday.start)).toBe('2026-06-28'); // Sunday of the first row
    expect(localDateString(sunday.end)).toBe('2026-08-01'); // Saturday of the last row
    expect(sunday.start).not.toBe(monday.start);
  });

  it('defaults firstDay to CALENDAR_FIRST_DAY (Monday)', () => {
    expect(CALENDAR_FIRST_DAY).toBe(1);
    expect(gridWindowBounds({ year: 2026, month: 7 })).toEqual(
      gridWindowBounds({ year: 2026, month: 7 }, CALENDAR_FIRST_DAY),
    );
  });

  it('the window always contains the whole calendar month and start < end', () => {
    for (let m = 1; m <= 12; m++) {
      const { start, end } = gridWindowBounds({ year: 2026, month: m });
      expect(start < end).toBe(true);
      const mm = String(m).padStart(2, '0');
      const lastDay = new Date(2026, m, 0).getDate();
      // Grid start is on/before the 1st, grid end is on/after the last day.
      expect(localDateString(start) <= `2026-${mm}-01`).toBe(true);
      expect(localDateString(end) >= `2026-${mm}-${String(lastDay).padStart(2, '0')}`).toBe(true);
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
