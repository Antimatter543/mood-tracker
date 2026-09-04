// moodSeries.test.ts — gap filling + down-sampling for the mood-trend chart.
//
// These two transforms decide what the x axis MEANS. Before them the chart
// plotted logged days consecutively, so a three-month silence and a one-day
// silence were the same width and a "14-day moving average" was really a
// 14-ENTRY average. Nothing about that is visible in a screenshot, which is
// exactly why it is pinned here.
//
// TZ is Australia/Brisbane for the whole suite (jest.tz.js) — day keying is
// local, never UTC.

import {
    fillDailyGaps,
    sampleIndices,
} from '@/components/visualisations/transforms/moodSeries';
import type { DayAvgRow } from '@/components/visualisations/transforms/dailyAverages';

const row = (date: string, avgMood: number): DayAvgRow => ({ date, avgMood });

describe('fillDailyGaps', () => {
    it('returns nothing for no rows — the caller renders its empty state', () => {
        expect(fillDailyGaps([])).toEqual([]);
    });

    it('leaves a contiguous run untouched', () => {
        const rows = [row('2026-09-01', 5), row('2026-09-02', 6), row('2026-09-03', 7)];
        expect(fillDailyGaps(rows)).toEqual([
            { date: '2026-09-01', value: 5 },
            { date: '2026-09-02', value: 6 },
            { date: '2026-09-03', value: 7 },
        ]);
    });

    it('inserts a null slot for every unlogged day between two entries', () => {
        const filled = fillDailyGaps([row('2026-09-01', 5), row('2026-09-05', 9)]);
        expect(filled.map((p) => p.date)).toEqual([
            '2026-09-01',
            '2026-09-02',
            '2026-09-03',
            '2026-09-04',
            '2026-09-05',
        ]);
        expect(filled.map((p) => p.value)).toEqual([5, null, null, null, 9]);
    });

    it('spans month and year boundaries by calendar days, not by arithmetic on the string', () => {
        const filled = fillDailyGaps([row('2026-12-30', 4), row('2027-01-02', 8)]);
        expect(filled.map((p) => p.date)).toEqual([
            '2026-12-30',
            '2026-12-31',
            '2027-01-01',
            '2027-01-02',
        ]);
    });

    it('is bounded by the DATA, never padding before the first or after the last entry', () => {
        const filled = fillDailyGaps([row('2026-09-10', 6), row('2026-09-12', 6)]);
        expect(filled[0].date).toBe('2026-09-10');
        expect(filled[filled.length - 1].date).toBe('2026-09-12');
        expect(filled[0].value).not.toBeNull();
        expect(filled[filled.length - 1].value).not.toBeNull();
    });

    it('a single logged day stays a single point', () => {
        expect(fillDailyGaps([row('2026-09-04', 7)])).toEqual([
            { date: '2026-09-04', value: 7 },
        ]);
    });

    it('every real value survives the fill, at the right day', () => {
        const rows = [row('2026-01-01', 3), row('2026-02-14', 8), row('2026-03-01', 5)];
        const byDay = new Map(fillDailyGaps(rows).map((p) => [p.date, p.value]));
        for (const r of rows) expect(byDay.get(r.date)).toBe(r.avgMood);
    });

    it('refuses to generate an absurd range, returning the logged days instead', () => {
        // ~30 years apart: filling would be ~11k slots of pure noise on the
        // render path. The cap degrades to a compressed axis, never a freeze.
        const filled = fillDailyGaps([row('1996-01-01', 5), row('2026-01-01', 5)]);
        expect(filled).toHaveLength(2);
    });

    it('does not throw on an unparseable day', () => {
        expect(() => fillDailyGaps([row('not-a-date', 5), row('2026-09-02', 6)])).not.toThrow();
    });
});

describe('sampleIndices', () => {
    it('keeps everything when the series already fits', () => {
        expect(sampleIndices(5, 90)).toEqual([0, 1, 2, 3, 4]);
        expect(sampleIndices(0, 90)).toEqual([]);
    });

    it('keeps everything when no cap is asked for', () => {
        expect(sampleIndices(4, 0)).toEqual([0, 1, 2, 3]);
    });

    it('never exceeds the cap by more than the mandatory final point', () => {
        for (const length of [91, 100, 365, 1000, 4000]) {
            const idx = sampleIndices(length, 90);
            expect(idx.length).toBeLessThanOrEqual(91);
        }
    });

    it('always includes the FIRST and the LAST index', () => {
        for (const length of [91, 137, 365, 999]) {
            const idx = sampleIndices(length, 90);
            expect(idx[0]).toBe(0);
            expect(idx[idx.length - 1]).toBe(length - 1);
        }
    });

    it('is strictly increasing and in range — the alignment guarantee', () => {
        // Three arrays (raw, overlay, labels) are mapped through this list; a
        // duplicate or out-of-range index would silently misalign them.
        for (const length of [91, 200, 733]) {
            const idx = sampleIndices(length, 90);
            for (let i = 1; i < idx.length; i++) expect(idx[i]).toBeGreaterThan(idx[i - 1]);
            for (const i of idx) {
                expect(i).toBeGreaterThanOrEqual(0);
                expect(i).toBeLessThan(length);
            }
        }
    });
});
