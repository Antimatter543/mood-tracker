import {
    buildMoodState,
    MAX_GAP_DAYS,
    STABLE_SWING,
    VOLATILE_SWING,
    MIN_STATE_DAYS,
    type MoodState,
} from '@/components/visualisations/transforms/moodState';
import { SLOPE_THRESHOLD } from '@/components/visualisations/transforms/statSummary';
import type { DailyAverage } from '@/components/visualisations/transforms/dailyAverages';

/** Consecutive recorded days starting at 2026-01-01, one per `avgs` entry. */
const consecutive = (avgs: number[], startDay = 1): DailyAverage[] =>
    avgs.map((avg, i) => ({
        day: `2026-01-${String(startDay + i).padStart(2, '0')}`,
        avg,
        count: 1,
    }));

const D = (day: string, avg: number): DailyAverage => ({ day, avg, count: 1 });

describe('buildMoodState — data gate', () => {
    it('returns building for empty input (never throws)', () => {
        const s = buildMoodState([]);
        expect(s.state).toBe('building');
        expect(s.trend).toBeNull();
        expect(s.volatility).toBeNull();
        expect(s.swing).toBeNull();
        expect(s.slope).toBeNull();
        expect(s.label).toBe('Keep logging to reveal your pattern');
    });

    it('returns building for a single day', () => {
        expect(buildMoodState(consecutive([5])).state).toBe('building');
    });

    it('returns building just below MIN_STATE_DAYS recorded days', () => {
        expect(buildMoodState(consecutive([5, 5, 5, 5])).state).toBe('building');
        expect(consecutive([5, 5, 5, 5])).toHaveLength(MIN_STATE_DAYS - 1);
    });

    it('classifies once MIN_STATE_DAYS with >= 3 transitions are present', () => {
        const s = buildMoodState(consecutive([5, 5, 5, 5, 5]));
        expect(s.state).toBe('classified');
    });

    it('returns building when enough days but too few near-adjacent transitions', () => {
        // 5 recorded days but every pair is > MAX_GAP_DAYS apart -> 0 valid transitions.
        const sparse: DailyAverage[] = [
            D('2026-01-01', 5),
            D('2026-01-10', 6),
            D('2026-01-20', 4),
            D('2026-02-01', 7),
            D('2026-02-15', 5),
        ];
        expect(buildMoodState(sparse).state).toBe('building');
    });

    it('drops non-finite avgs before the gate (NaN day ignored)', () => {
        const withBad: DailyAverage[] = [
            ...consecutive([5, 5, 5, 5]),
            { day: '2026-01-05', avg: NaN, count: 1 },
        ];
        // The NaN day is filtered, leaving only 4 valid days -> building.
        expect(buildMoodState(withBad).state).toBe('building');
    });
});

describe('buildMoodState — trend axis', () => {
    it('flags rising for a clear upward least-squares slope', () => {
        const s = buildMoodState(consecutive([3, 4, 5, 6, 7]));
        expect(s.trend).toBe('rising');
    });

    it('flags falling for a clear downward slope', () => {
        const s = buildMoodState(consecutive([7, 6, 5, 4, 3]));
        expect(s.trend).toBe('falling');
    });

    it('flags steady for a flat series (|slope| < threshold)', () => {
        const s = buildMoodState(consecutive([5, 5, 5, 5, 5]));
        expect(s.trend).toBe('steady');
        expect(s.slope).toBe(0);
    });

    it('honours a precomputed opts.slope (matches the chart line)', () => {
        const flat = consecutive([5, 5, 5, 5, 5]);
        expect(buildMoodState(flat, { slope: 0.5 }).trend).toBe('rising');
        expect(buildMoodState(flat, { slope: -0.5 }).trend).toBe('falling');
        expect(
            buildMoodState(flat, { slope: SLOPE_THRESHOLD - 0.001 }).trend
        ).toBe('steady');
    });

    it('treats a NaN/Infinite opts.slope as steady (computes its own)', () => {
        // Flat data -> own slope 0 -> steady regardless of the bad override.
        expect(buildMoodState(consecutive([5, 5, 5, 5, 5]), { slope: NaN }).trend).toBe(
            'steady'
        );
        expect(
            buildMoodState(consecutive([5, 5, 5, 5, 5]), { slope: Infinity }).trend
        ).toBe('steady');
    });
});

describe('buildMoodState — volatility axis', () => {
    it('flags stable for tiny day-to-day swings', () => {
        // swings of 0.2 each -> well below STABLE_SWING.
        const s = buildMoodState(consecutive([5.0, 5.2, 5.0, 5.2, 5.0]));
        expect(s.volatility).toBe('stable');
        expect(s.swing).toBeLessThan(STABLE_SWING);
    });

    it('flags variable for mid-sized swings', () => {
        // swings ~1.0 each.
        const s = buildMoodState(consecutive([4, 5, 4, 5, 4]));
        expect(s.volatility).toBe('variable');
        expect(s.swing).toBeGreaterThanOrEqual(STABLE_SWING);
        expect(s.swing).toBeLessThan(VOLATILE_SWING);
    });

    it('flags volatile for large swings', () => {
        // swings ~4 each.
        const s = buildMoodState(consecutive([2, 8, 2, 8, 2, 8]));
        expect(s.volatility).toBe('volatile');
        expect(s.swing).toBeGreaterThanOrEqual(VOLATILE_SWING);
    });

    it('excludes diffs across a large logging gap from the swing', () => {
        // Four tight days (small swings) then one day a fortnight later with a
        // big jump. The big jump's diff crosses a > MAX_GAP_DAYS gap, so it must
        // NOT inflate the swing -> stays stable.
        const series: DailyAverage[] = [
            D('2026-01-01', 5.0),
            D('2026-01-02', 5.1),
            D('2026-01-03', 5.0),
            D('2026-01-04', 5.1),
            D('2026-01-20', 10.0), // 16-day gap, |Δ| ~4.9 — excluded
        ];
        const s = buildMoodState(series);
        expect(s.state).toBe('classified');
        expect(s.volatility).toBe('stable');
    });
});

describe('buildMoodState — labels & description', () => {
    const matrix: [number[], MoodState['trend'], MoodState['volatility'], string][] = [
        [[5.0, 5.3, 5.6, 5.9, 6.2], 'rising', 'stable', 'Steadily lifting'],
        [[6.2, 5.9, 5.6, 5.3, 5.0], 'falling', 'stable', 'Gently dipping'],
        [[5, 5, 5, 5, 5], 'steady', 'stable', 'Settled'],
        [[2, 8, 2, 8, 2], 'steady', 'volatile', 'Up and down'],
    ];

    it.each(matrix)(
        'maps %j -> trend %s, volatility %s, label "%s"',
        (avgs, trend, volatility, label) => {
            const s = buildMoodState(consecutive(avgs));
            expect(s.trend).toBe(trend);
            expect(s.volatility).toBe(volatility);
            expect(s.label).toBe(label);
        }
    );

    it('writes a one-sentence description carrying the swing number', () => {
        const s = buildMoodState(consecutive([5, 5, 5, 5, 5]));
        expect(s.description).toContain('Settled');
        expect(s.description).toContain('pts day to day');
        expect(s.description).toMatch(/~0\.0 pts/);
    });

    it('drops the "only" qualifier for a turbulent patch', () => {
        const s = buildMoodState(consecutive([2, 8, 2, 8, 2]));
        expect(s.volatility).toBe('volatile');
        expect(s.description).not.toContain('only');
        expect(s.description).toContain('Up and down');
    });

    it('rounds swing and slope to 1dp', () => {
        const s = buildMoodState(consecutive([4, 5, 4, 5, 4]));
        expect(s.swing).toBeCloseTo(Math.round(s.swing! * 10) / 10);
        expect(s.slope).toBeCloseTo(Math.round(s.slope! * 10) / 10);
    });
});

describe('buildMoodState — constants sanity', () => {
    it('keeps the documented thresholds', () => {
        expect(MAX_GAP_DAYS).toBe(3);
        expect(STABLE_SWING).toBe(0.8);
        expect(VOLATILE_SWING).toBe(1.8);
        expect(MIN_STATE_DAYS).toBe(5);
    });
});
