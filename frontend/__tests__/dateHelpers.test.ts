import {
  startOfLocalDay,
  endOfLocalDay,
  localDateString,
  daysBetween,
  getDefaultEntryDate,
} from '@/databases/dateHelpers';

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
    const result = localDateString('2025-12-31T15:00:00');
    expect(result).toBe('2025-12-31');
  });

  it('throws on invalid input', () => {
    expect(() => localDateString('not a date')).toThrow();
  });
});

describe('daysBetween', () => {
  it('returns 0 for two times on the same local day', () => {
    const a = '2025-05-19T01:00:00';
    const b = '2025-05-19T23:00:00';
    expect(daysBetween(a, b)).toBe(0);
  });

  it('returns 1 for consecutive local days even across only minutes', () => {
    const a = '2025-05-19T23:59:00';
    const b = '2025-05-20T00:01:00';
    expect(daysBetween(a, b)).toBe(1);
  });

  it('is signed (positive when b > a, negative when b < a)', () => {
    const a = '2025-05-19T12:00:00';
    const b = '2025-05-22T12:00:00';
    expect(daysBetween(a, b)).toBe(3);
    expect(daysBetween(b, a)).toBe(-3);
  });

  it('counts calendar days correctly across a typical week', () => {
    expect(daysBetween('2025-05-12T08:00:00', '2025-05-19T08:00:00')).toBe(7);
  });

  it('handles DST-style transitions by rounding to nearest whole day', () => {
    // Spring forward in US is the 2nd Sunday of March. Picking 2025-03-09.
    // Even with a 23-hour calendar day, two midnights one local-day apart
    // should still report as 1 day.
    const a = '2025-03-08T12:00:00';
    const b = '2025-03-09T12:00:00';
    expect(daysBetween(a, b)).toBe(1);
  });
});

describe('getDefaultEntryDate', () => {
  it('returns a valid ISO 8601 UTC string', () => {
    const stamp = getDefaultEntryDate();
    expect(stamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(new Date(stamp).toISOString()).toBe(stamp);
  });

  it('returns a stamp within a few ms of now', () => {
    const before = Date.now();
    const stamp = new Date(getDefaultEntryDate()).getTime();
    const after = Date.now();
    expect(stamp).toBeGreaterThanOrEqual(before);
    expect(stamp).toBeLessThanOrEqual(after);
  });
});
