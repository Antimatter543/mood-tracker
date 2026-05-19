import {
  localDateString,
  startOfLocalDay,
  endOfLocalDay,
  daysBetween,
  addDays,
} from '@/components/visualisations/transforms/dateHelpers';

describe('dateHelpers — local-timezone correctness', () => {
  // These tests use real timers; we don't pin TZ because the helpers are
  // documented to follow the *runtime* local timezone. Jest's default node
  // env on most CI is UTC, which is fine — the helpers should be correct
  // there too.

  describe('localDateString', () => {
    it('formats a Date to YYYY-MM-DD using local components', () => {
      const d = new Date(2025, 0, 15, 14, 30); // 15 Jan 2025, local
      expect(localDateString(d)).toBe('2025-01-15');
    });

    it('zero-pads single-digit months and days', () => {
      const d = new Date(2025, 0, 5);
      expect(localDateString(d)).toBe('2025-01-05');
    });

    it('accepts an ISO string', () => {
      // 2025-06-15T12:00:00Z falls on 2025-06-15 in UTC and in nearly all TZs
      const out = localDateString('2025-06-15T12:00:00Z');
      expect(out).toMatch(/^2025-06-1[45]$/);
    });
  });

  describe('startOfLocalDay / endOfLocalDay', () => {
    it('produces SQLite-comparable boundary strings for the same date', () => {
      const start = startOfLocalDay('2025-01-15');
      const end = endOfLocalDay('2025-01-15');
      expect(start).toBe('2025-01-15 00:00:00');
      expect(end).toBe('2025-01-15 23:59:59');
      expect(start < end).toBe(true);
    });
  });

  describe('daysBetween', () => {
    it('returns 0 for identical dates', () => {
      expect(daysBetween('2025-01-15', '2025-01-15')).toBe(0);
    });

    it('returns a positive count when b is after a', () => {
      expect(daysBetween('2025-01-01', '2025-01-05')).toBe(4);
    });

    it('returns negative when b is before a', () => {
      expect(daysBetween('2025-01-05', '2025-01-01')).toBe(-4);
    });

    it('is DST-safe across a US DST boundary (2025-03-09)', () => {
      // 2025-03-09 is the spring-forward day in the US (lose 1 hour).
      // The helper anchors to UTC midnights so it ignores DST.
      expect(daysBetween('2025-03-08', '2025-03-10')).toBe(2);
    });
  });

  describe('addDays', () => {
    it('adds positive days', () => {
      expect(addDays('2025-01-01', 5)).toBe('2025-01-06');
    });

    it('subtracts negative days', () => {
      expect(addDays('2025-01-10', -3)).toBe('2025-01-07');
    });

    it('wraps month boundaries', () => {
      expect(addDays('2025-01-31', 1)).toBe('2025-02-01');
    });

    it('wraps year boundaries', () => {
      expect(addDays('2025-12-31', 1)).toBe('2026-01-01');
    });

    it('survives a DST transition (2025-03-09 US)', () => {
      // From the day before DST through the day after — should be exactly 2 days.
      expect(addDays('2025-03-08', 2)).toBe('2025-03-10');
    });
  });
});
