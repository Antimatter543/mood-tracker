/**
 * Home dashboard summary math (components/visualisations/transforms/homeSummary.ts).
 *
 * These lock the falsy-ZERO fixes: a legitimate mood of 0 is falsy, and the old
 * Home code (`today?.mood || null`, `stats.average ? … : '-- / 10'`) mistook a
 * real 0 for "no data". A 0 mood must render as an entry; a 0.0 average must
 * render "0.0 / 10", not "-- / 10".
 */
import {
    todaysMoodValue,
    monthlyOverview,
    formatAverageDisplay,
} from '@/components/visualisations/transforms/homeSummary';

describe('todaysMoodValue', () => {
    it('returns null when there is no row', () => {
        expect(todaysMoodValue(null)).toBeNull();
        expect(todaysMoodValue(undefined)).toBeNull();
    });

    it('returns a real 0 mood (NOT null) — a 0 is an entry, not "no entry"', () => {
        expect(todaysMoodValue({ mood: 0 })).toBe(0);
    });

    it('passes a normal mood through', () => {
        expect(todaysMoodValue({ mood: 6.5 })).toBe(6.5);
    });
});

describe('monthlyOverview', () => {
    it('returns null average (NOT 0) for an empty window', () => {
        const out = monthlyOverview([]);
        expect(out.average).toBeNull();
        expect(out.totalEntries).toBe(0);
        expect(out.bestDay).toBe('');
    });

    it('computes a real 0.0 average distinctly from no-data', () => {
        // Two entries both at mood 0 → a genuine 0.0 average (not null).
        const rows = [
            { date: '2026-07-10T10:00:00.000Z', mood: 0 },
            { date: '2026-07-11T10:00:00.000Z', mood: 0 },
        ];
        const out = monthlyOverview(rows);
        expect(out.average).toBe(0);
        expect(out.totalEntries).toBe(2);
    });

    it('averages to 1 dp and counts entries', () => {
        const rows = [
            { date: '2026-07-10T10:00:00.000Z', mood: 5 },
            { date: '2026-07-10T12:00:00.000Z', mood: 8 },
            { date: '2026-07-11T10:00:00.000Z', mood: 6 },
        ];
        const out = monthlyOverview(rows);
        expect(out.average).toBeCloseTo(6.3, 5);
        expect(out.totalEntries).toBe(3);
    });
});

describe('formatAverageDisplay', () => {
    it('renders a real 0.0 average as "0.0 / 10" (not the no-data sentinel)', () => {
        expect(formatAverageDisplay(0)).toBe('0.0 / 10');
    });

    it('renders null (no data) as "-- / 10"', () => {
        expect(formatAverageDisplay(null)).toBe('-- / 10');
    });

    it('renders a normal average to 1 dp', () => {
        expect(formatAverageDisplay(6.3)).toBe('6.3 / 10');
    });
});
