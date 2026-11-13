import {
  startOfLocalDay,
  endOfLocalDay,
  convertStringToDate,
  localDateString,
  localDateTimeString,
  daysBetween,
  getDefaultEntryDate,
  localDateTimeString,
  calendarDaysSpanned,
  convertStringToDate,
} from '@/databases/dateHelpers';
import { freezeNow } from '@/testing/clock';

describe('startOfLocalDay', () => {
  it('returns 00:00:00.000 local time for the given day', () => {
    const date = new Date('2025-05-19T13:42:00');
    const start = new Date(startOfLocalDay(date));
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    expect(start.getSeconds()).toBe(0);
    expect(start.getMilliseconds()).toBe(0);
  });

  it('does not mutate the input', () => {
    const date = new Date('2025-05-19T13:42:00');
    const beforeMs = date.getTime();
    startOfLocalDay(date);
    expect(date.getTime()).toBe(beforeMs);
  });

  it('keeps the same local calendar date even just before midnight', () => {
    // 23:59:59 should still map back to that same day's 00:00:00
    const date = new Date('2025-05-19T23:59:59');
    const start = new Date(startOfLocalDay(date));
    expect(start.getDate()).toBe(date.getDate());
    expect(start.getMonth()).toBe(date.getMonth());
    expect(start.getFullYear()).toBe(date.getFullYear());
  });
});

describe('endOfLocalDay', () => {
  it('returns 23:59:59.999 local time for the given day', () => {
    const date = new Date('2025-05-19T08:00:00');
    const end = new Date(endOfLocalDay(date));
    expect(end.getHours()).toBe(23);
    expect(end.getMinutes()).toBe(59);
    expect(end.getSeconds()).toBe(59);
    expect(end.getMilliseconds()).toBe(999);
  });

  it('start and end of same day differ by exactly one day minus 1ms', () => {
    const date = new Date('2025-05-19T12:00:00');
    const startMs = new Date(startOfLocalDay(date)).getTime();
    const endMs = new Date(endOfLocalDay(date)).getTime();
    expect(endMs - startMs).toBe(86_400_000 - 1);
  });
});

describe('convertStringToDate', () => {
  it('passes Date objects as is', () => {
    const date = new Date(2025, 4, 19, 12, 0, 0);
    expect(convertStringToDate(date)).toStrictEqual(date);
  });

  it('converts UTC date only strings to Date object with time set to UTC midnight', () => {
    const date = '2025-05-19Z';
    expect(convertStringToDate(date)).toStrictEqual(new Date(2025, 4, 19, 10, 0, 0));
  });

  it('converts UTC date time strings to Date objects', () => {
    let date = '2025-05-19T02:15:30Z';
    expect(convertStringToDate(date)).toStrictEqual(new Date(2025, 4, 19, 12, 15, 30));

    date = '2025-05-19T02:10Z';
    expect(convertStringToDate(date)).toStrictEqual(new Date(2025, 4, 19, 12, 10, 0));
  });

  it('converts local date only strings to Date object with time set to midnight', () => {
    const date = '2025-05-19';
    expect(convertStringToDate(date)).toStrictEqual(new Date(2025, 4, 19, 0, 0, 0));
  });

  it('converts local date time strings to Date objects', () => {
    let date = '2025-05-19T02:15:30';
    expect(convertStringToDate(date)).toStrictEqual(new Date(2025, 4, 19, 2, 15, 30));

    date = '2025-05-19T02:10';
    expect(convertStringToDate(date)).toStrictEqual(new Date(2025, 4, 19, 2, 10, 0));
  });

  it('fails for non-ISO8610 formatted date and date time strings', () => {
    let date = '2025-05-19 02:15:30';
    expect(convertStringToDate(date).getTime()).toBeNaN();

    date = '2025-05-19 02:10';
    expect(convertStringToDate(date).getTime()).toBeNaN();

    date = '19/95/2025';
    expect(convertStringToDate(date).getTime()).toBeNaN();

    date = '19/95/2025 12 PM';
    expect(convertStringToDate(date).getTime()).toBeNaN();
  });

  it('fails for invalid input strings', () => {
    expect(convertStringToDate('not a date at all').getTime()).toBeNaN();
    expect(convertStringToDate('').getTime()).toBeNaN();
    expect(convertStringToDate('1345').getTime()).toBeNaN();
  });
})

describe('localDateString', () => {
  it('formats a Date as YYYY-MM-DD in local TZ', () => {
    const date = new Date(2025, 4, 19, 12, 0, 0); // local May 19
    expect(localDateString(date)).toBe('2025-05-19');
  });

  it('pads month and day to two digits', () => {
    const date = new Date(2025, 0, 5, 12, 0, 0); // local Jan 5
    expect(localDateString(date)).toBe('2025-01-05');
  });

  it('accepts an ISO string and reformats it', () => {
    // Use a local-time string (no Z/offset) so it's interpreted as local
    let result = localDateString('2025-12-31T15:00:00');
    expect(result).toBe('2025-12-31');

    // Use an UTC string
    result = localDateString('2025-12-31T05:00:00Z');
    expect(result).toBe('2025-12-31');
  });

  it('properly handles day changes due to TZ offsets', () => {
    let result = localDateString('2025-12-31T15:00:00Z');
    expect(result).toBe('2026-01-01');
  });

  it('throws on invalid input', () => {
    expect(() => localDateString('not a date')).toThrow();
  });
});

describe('localDateTimeString', () => {
  it('formats a Date as YYYY-MM-DD\'T\'HHM:mm:ss in local TZ', () => {
    const date = new Date(2025, 4, 19, 12, 13, 30, 15); // local May 19
    expect(localDateTimeString(date)).toBe('2025-05-19T12:13:30');
  });

  it('formats an UTC date-time string as YYYY-MM-DD\'T\'HHM:mm:ss in local TZ', () => {
    expect(localDateTimeString('2025-05-19T12:13:15Z')).toBe('2025-05-19T22:13:15');
  });

  it('formats an UTC Date as YYYY-MM-DD\'T\'HHM:mm:ss in local TZ', () => {
    const date = new Date('2025-05-19T12:13:15Z'); // local May 19
    expect(localDateTimeString(date)).toBe('2025-05-19T22:13:15');
  });

  it('properly handles day changes due to TZ offsets', () => {
    let result = localDateTimeString('2025-12-31T15:00:00Z');
    expect(result).toBe('2026-01-01T01:00:00');
  });

  it('pads month, day, hour, minute and second to two digits', () => {
    const date = new Date(2025, 0, 5, 1, 5, 0); // local Jan 5
    expect(localDateTimeString(date)).toBe('2025-01-05T01:05:00');
  });

  it('accepts an ISO date-time string and reformats it', () => {
    // Use a local-time string (no Z/offset) so it's interpreted as local
    const result = localDateTimeString('2025-12-31T15:25:30');
    expect(result).toBe('2025-12-31T15:25:30');
  });

  it('accepts an ISO date-time string without seconds and returns 00 as seconds', () => {
    // Local time
    let result = localDateTimeString('2025-12-31T15:25');
    expect(result).toBe('2025-12-31T15:25:00');
    // UTC time
    result = localDateTimeString('2025-12-31T05:25Z');
    expect(result).toBe('2025-12-31T15:25:00');
  });

  it('accepts an ISO date-time string with milliseconds and ignores them', () => {
    // Local time
    let result = localDateTimeString('2025-12-31T15:25');
    expect(result).toBe('2025-12-31T15:25:00');
    // UTC time
    result = localDateTimeString('2025-12-31T05:25Z');
    expect(result).toBe('2025-12-31T15:25:00');
  });

  it('doesn\'t accept an ISO date-time string without minutes AND seconds', () => {
    // Local time
    expect(() => localDateTimeString('2025-12-31T15')).toThrow();
    // UTC time
    expect(() => localDateTimeString('2025-12-31T05Z')).toThrow();
  });

  it('accepts an ISO date only string', () => {
    // Use a local-time string (no Z/offset) so it's interpreted as local
    const result = localDateTimeString('2025-12-31');
    expect(result).toBe('2025-12-31T00:00:00');
  });

  it('throws on invalid input', () => {
    expect(() => localDateTimeString('not a date')).toThrow();
  });
});

describe('daysBetween', () => {
  it('returns 0 for two times on the same local day', () => {
    const a = '2025-05-19T01:00:00';
    const b = '2025-05-19T23:00:00';
    expect(daysBetween(a, b)).toBe(0);
  });

  it('returns 0 for two date-only times on the same local day', () => {
    const a = '2025-05-19';
    const b = '2025-05-19';
    expect(daysBetween(a, b)).toBe(0);
  });

  it('returns 0 for two times in UTC on the same local day', () => {
    const a = '2025-05-18T15:00:00Z';
    const b = '2025-05-19T12:00:00Z';
    expect(daysBetween(a, b)).toBe(0);
  });

  it('returns 0 for two date-only times in UTC on the same day', () => {
    const a = '2025-05-19Z';
    const b = '2025-05-19Z';
    expect(daysBetween(a, b)).toBe(0);
  });

  it('when inclusive = true, returns 1 for two times in UTC on the same local day', () => {
    const a = '2025-05-18T15:00:00Z';
    const b = '2025-05-19T12:00:00Z';
    expect(daysBetween(a, b, true)).toBe(1);
  });

  it('returns 1 for consecutive local days even across only minutes', () => {
    const a = '2025-05-19T23:59:00';
    const b = '2025-05-20T00:01:00';
    expect(daysBetween(a, b)).toBe(1);
  });

  it('when inclusive = true, returns 2 for consecutive local days even across only minutes', () => {
    const a = '2025-05-19T23:59:00';
    const b = '2025-05-20T00:01:00';
    expect(daysBetween(a, b, true)).toBe(2);
  });

  it('is signed (positive when b > a, negative when b < a)', () => {
    // Local time
    let a = '2025-05-19T12:00:00';
    let b = '2025-05-22T12:00:00';
    expect(daysBetween(a, b)).toBe(3);
    expect(daysBetween(b, a)).toBe(-3);

    a = '2025-05-19';
    b = '2025-05-22';
    expect(daysBetween(a, b)).toBe(3);
    expect(daysBetween(b, a)).toBe(-3);

    // UTC time
    a = '2025-05-19T12:00:00Z';
    b = '2025-05-22T12:00:00Z';

    expect(daysBetween(a, b)).toBe(3);
    expect(daysBetween(b, a)).toBe(-3);

    a = '2025-05-19Z';
    b = '2025-05-22Z';

    expect(daysBetween(a, b)).toBe(3);
    expect(daysBetween(b, a)).toBe(-3);
  });

  it('when inclusive = true, is signed (positive when b > a, negative when b < a)', () => {
    const a = '2025-05-19T12:00:00';
    const b = '2025-05-22T12:00:00';
    expect(daysBetween(a, b, true)).toBe(4);
    expect(daysBetween(b, a, true)).toBe(-4);
  });

  it('counts calendar days correctly across a typical week', () => {
    expect(daysBetween('2025-05-12T08:00:00', '2025-05-19T08:00:00')).toBe(7);
    expect(daysBetween('2025-05-12', '2025-05-19')).toBe(7);

    // Inclusive
    expect(daysBetween('2025-05-12T08:00:00', '2025-05-19T08:00:00', true)).toBe(8);
    expect(daysBetween('2025-05-12', '2025-05-19', true)).toBe(8);
  });

  it('handles DST-style transitions by rounding to nearest whole day', () => {
    // Spring forward in US is the 2nd Sunday of March. Picking 2025-03-09.
    // Even with a 23-hour calendar day, two midnights one local-day apart
    // should still report as 1 day.
    let a = '2025-03-08T12:00:00';
    let b = '2025-03-09T12:00:00';
    expect(daysBetween(a, b)).toBe(1);

    // Inclusive version
    a = '2025-03-08T12:00:00';
    b = '2025-03-09T12:00:00';
    expect(daysBetween(a, b, true)).toBe(2);
  });
});

describe('calendarDaysSpanned', () => {
  it('counts both ends: the same local day is 1', () => {
    expect(calendarDaysSpanned('2025-05-18T15:00:00Z', '2025-05-19T12:00:00Z')).toBe(1);
    expect(calendarDaysSpanned('2025-05-19', '2025-05-19')).toBe(1);
  });

  it('is 2 for consecutive local days a few minutes apart', () => {
    expect(calendarDaysSpanned('2025-05-19T23:59:00', '2025-05-20T00:01:00')).toBe(2);
  });

  it('does not depend on argument order', () => {
    expect(calendarDaysSpanned('2025-05-19T12:00:00', '2025-05-22T12:00:00')).toBe(4);
    expect(calendarDaysSpanned('2025-05-22T12:00:00', '2025-05-19T12:00:00')).toBe(4);
  });

  it('counts a week inclusively, across a DST change', () => {
    expect(calendarDaysSpanned('2025-05-12', '2025-05-19')).toBe(8);
    expect(calendarDaysSpanned('2025-03-08T12:00:00', '2025-03-09T12:00:00')).toBe(2);
  });
});

describe('convertStringToDate', () => {
  it('reads a bare day key as LOCAL midnight', () => {
    const d = convertStringToDate('2025-06-01');
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2025, 5, 1, 0]);
  });

  it('parses every other string exactly like new Date(string)', () => {
    for (const s of [
      '2025-06-01T09:00:00',
      '2025-06-01T09:00:00.000Z',
      '2025-06-01 09:00:00',
      '2025-05-31T23:30:00Z',
    ]) {
      expect(convertStringToDate(s).getTime()).toBe(new Date(s).getTime());
    }
  });

  it('returns a Date unchanged', () => {
    const d = new Date(2025, 5, 1);
    expect(convertStringToDate(d)).toBe(d);
  });
});

describe('localDateString keeps its meaning for non-day-key strings', () => {
  it('h5: a SQLite-style "YYYY-MM-DD HH:MM:SS" stamp keys to its local day', () => {
    expect(localDateString('2025-06-01 09:00:00')).toBe('2025-06-01');
  });

  it('keys stored UTC instants by the local day, as before', () => {
    for (const s of ['2025-05-31T23:30:00Z', '2025-06-01T13:59:00.000Z', '2025-06-01T14:00:00.000Z']) {
      const d = new Date(s);
      const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      expect(localDateString(s)).toBe(expected);
    }
  });
});

describe('getDefaultEntryDate', () => {
  it('returns a valid ISO 8601 UTC string', () => {
    const stamp = getDefaultEntryDate();
    expect(stamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(new Date(stamp).toISOString()).toBe(stamp);
  });

  it('stamps the current instant from the app clock', () => {
    const now = freezeNow();
    expect(getDefaultEntryDate()).toBe(now.toISOString());
  });
});
