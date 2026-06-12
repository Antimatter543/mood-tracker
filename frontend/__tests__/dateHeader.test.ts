/**
 * Unit tests for the Timeline date-header helpers. The labelling must be
 * timezone-correct: bucketing and "Today"/"Yesterday" run on the viewer's LOCAL
 * calendar day, never via UTC string slicing. These tests pin a fixed `now` so
 * they're deterministic regardless of the machine clock, and exercise a
 * local-midnight edge to prove we don't UTC-slice.
 */
import {
    localDayKey,
    sectionKeyForDate,
    formatSectionTitle,
} from '@/components/timeline/dateHeader';

describe('localDayKey', () => {
    it('formats a date as local YYYY-MM-DD with zero-padding', () => {
        // Local constructor (year, monthIndex, day) — Jan is 0.
        expect(localDayKey(new Date(2025, 0, 5))).toBe('2025-01-05');
        expect(localDayKey(new Date(2026, 11, 31))).toBe('2026-12-31');
    });
});

describe('sectionKeyForDate', () => {
    it('buckets two timestamps on the same local day under one key', () => {
        // Build two ISO strings on the same LOCAL day (morning + night) from a
        // local date, so the assertion holds in any timezone.
        const morning = new Date(2025, 5, 9, 8, 0, 0); // Jun 9, 08:00 local
        const night = new Date(2025, 5, 9, 23, 30, 0); // Jun 9, 23:30 local
        expect(sectionKeyForDate(morning.toISOString())).toBe('2025-06-09');
        expect(sectionKeyForDate(night.toISOString())).toBe('2025-06-09');
        expect(sectionKeyForDate(morning.toISOString())).toBe(
            sectionKeyForDate(night.toISOString())
        );
    });

    it('falls back to the raw string for an unparseable date (never throws)', () => {
        expect(sectionKeyForDate('not-a-date')).toBe('not-a-date');
        expect(sectionKeyForDate('')).toBe('');
    });
});

describe('formatSectionTitle', () => {
    // Fixed reference point: Tuesday, June 10, 2025, 15:00 LOCAL.
    const now = new Date(2025, 5, 10, 15, 0, 0);

    it('labels the same local day as "Today"', () => {
        expect(formatSectionTitle('2025-06-10', now)).toBe('Today');
    });

    it('labels the previous local day as "Yesterday"', () => {
        expect(formatSectionTitle('2025-06-09', now)).toBe('Yesterday');
    });

    it('labels an older day with the long-form date', () => {
        const title = formatSectionTitle('2025-06-08', now);
        // toLocaleDateString output varies by environment locale, but it must NOT
        // be the relative labels and must include the year + a weekday word.
        expect(title).not.toBe('Today');
        expect(title).not.toBe('Yesterday');
        expect(title).toMatch(/2025/);
    });

    it('crosses a month boundary correctly (1st -> "Today", last of prev -> "Yesterday")', () => {
        const julyFirst = new Date(2025, 6, 1, 9, 0, 0); // Jul 1, 2025 local
        expect(formatSectionTitle('2025-07-01', julyFirst)).toBe('Today');
        expect(formatSectionTitle('2025-06-30', julyFirst)).toBe('Yesterday');
    });

    it('crosses a year boundary correctly', () => {
        const newYears = new Date(2026, 0, 1, 0, 30, 0); // Jan 1, 2026, 00:30 local
        expect(formatSectionTitle('2026-01-01', newYears)).toBe('Today');
        expect(formatSectionTitle('2025-12-31', newYears)).toBe('Yesterday');
    });

    it('handles the local-midnight edge without UTC drift', () => {
        // 00:05 LOCAL on Jun 10. A UTC-slicing impl would, for zones behind UTC,
        // bucket this as Jun 9 and mislabel it "Yesterday". Local-day logic keeps
        // it "Today".
        const justAfterMidnight = new Date(2025, 5, 10, 0, 5, 0);
        const key = sectionKeyForDate(justAfterMidnight.toISOString());
        expect(key).toBe('2025-06-10');
        expect(formatSectionTitle(key, justAfterMidnight)).toBe('Today');
    });

    it('returns a non-date key verbatim (degenerate fallback)', () => {
        expect(formatSectionTitle('garbage', now)).toBe('garbage');
    });
});
