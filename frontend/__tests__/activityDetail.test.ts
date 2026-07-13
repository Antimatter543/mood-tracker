import {
    activityMoodStats,
    classifyVariability,
    activityMoodImpact,
    moodTrendForActivity,
    sparklinePoints,
    topCoOccurring,
    withEntryCounts,
    filterActivitiesByQuery,
    MIN_VARIABILITY_SAMPLES,
    LOW_THIRD,
    HIGH_THIRD,
    POLAR_TAIL_SHARE,
    POSITIVE_MEAN,
    LOW_MEAN,
    type CoOccurringRow,
} from '@/components/visualisations/transforms/activityDetail';

// A local-noon instant for a given Y-M-D, so day-keying is TZ-robust under the
// non-UTC jest pin (jest.tz.js = Australia/Brisbane). Mirrors dailyAverages tests.
const at = (y: number, m: number, d: number, mood: number) => ({
    date: new Date(y, m - 1, d, 12, 0, 0).toISOString(),
    mood,
});

describe('activityMoodStats', () => {
    it('is all-zeros (never NaN) on empty input', () => {
        expect(activityMoodStats([])).toEqual({
            count: 0,
            mean: 0,
            stdev: 0,
            min: 0,
            max: 0,
            median: 0,
        });
    });

    it('handles a single value (stdev 0, median = the value)', () => {
        expect(activityMoodStats([7])).toEqual({
            count: 1,
            mean: 7,
            stdev: 0,
            min: 7,
            max: 7,
            median: 7,
        });
    });

    it('computes mean/min/max over a spread', () => {
        const s = activityMoodStats([1, 3, 5, 9]);
        expect(s.count).toBe(4);
        expect(s.mean).toBe(4.5);
        expect(s.min).toBe(1);
        expect(s.max).toBe(9);
    });

    it('computes population stdev correctly (√5 → 2.2)', () => {
        // moods [2,4,6,8]: mean 5, variance (9+1+1+9)/4 = 5, stdev √5 ≈ 2.236 → 2.2
        expect(activityMoodStats([2, 4, 6, 8]).stdev).toBe(2.2);
    });

    it('median = average of the two middles on an even count', () => {
        expect(activityMoodStats([2, 4, 6, 8]).median).toBe(5); // (4+6)/2
    });

    it('median = the middle value on an odd count', () => {
        expect(activityMoodStats([1, 2, 9]).median).toBe(2);
    });

    it('ignores non-finite moods', () => {
        const s = activityMoodStats([NaN, 5, Infinity, 5]);
        expect(s.count).toBe(2);
        expect(s.mean).toBe(5);
        expect(s.stdev).toBe(0);
    });
});

describe('classifyVariability', () => {
    const label = 'Gym';

    it('is insufficient below the sample gate, with calm low-data copy', () => {
        const r = classifyVariability([5, 5, 5, 5], { label }); // 4 < 5
        expect(r.kind).toBe('insufficient');
        expect(r.headline).toBe('Not enough yet');
        expect(r.detail).toContain('Gym');
    });

    it('detects a polarizing / bimodal set (some very low, some very high)', () => {
        const r = classifyVariability([0, 1, 9, 10, 5], { label });
        expect(r.kind).toBe('polarizing');
        expect(r.headline).toBe('Hit or miss');
        expect(r.detail).toContain('swings');
    });

    it('classifies a consistently high set as reliably good', () => {
        const r = classifyVariability([7, 7, 8, 8, 9], { label });
        expect(r.kind).toBe('consistent_positive');
        expect(r.headline).toBe('Reliably good');
    });

    it('classifies a consistently low set as consistently tough', () => {
        const r = classifyVariability([1, 2, 2, 3, 3], { label });
        expect(r.kind).toBe('consistent_low');
        expect(r.headline).toBe('Consistently tough');
    });

    it('classifies a steady mid set as steady middle', () => {
        const r = classifyVariability([4, 5, 5, 5, 6], { label });
        expect(r.kind).toBe('consistent_neutral');
        expect(r.headline).toBe('Steady middle');
    });

    it('falls back to "this activity" when no label is given', () => {
        expect(classifyVariability([1, 2, 3], {}).detail).toContain('this activity');
    });

    // --- boundary thresholds ---

    it('POLAR_TAIL_SHARE boundary: exactly 2 low + 2 high of 8 (share 0.25 each) is polarizing', () => {
        // 8 entries: low={0,1}, high={9,10}, mid={5,5,5,5}. Each tail share = 2/8 = 0.25.
        expect(classifyVariability([0, 1, 9, 10, 5, 5, 5, 5]).kind).toBe('polarizing');
    });

    it('below POLAR_TAIL_SHARE on one tail is NOT polarizing (only one extreme populated)', () => {
        // 8 entries: only 1 low, 2 high → lowShare 0.125 < 0.25 → not bimodal.
        // mean = (1+9+10+6+6+6+6+6)/8 = 6.25 → neutral (between LOW_MEAN and POSITIVE_MEAN).
        const r = classifyVariability([1, 9, 10, 6, 6, 6, 6, 6]);
        expect(r.kind).not.toBe('polarizing');
    });

    it('POSITIVE_MEAN boundary: mean exactly 6.5 (not bimodal) is consistent_positive', () => {
        // [6, 6.5, 6.5, 6.5, 7]: sum 32.5, mean 6.5. Only 7 is ≥ HIGH_THIRD (1/5=0.2<0.25),
        // no lows → not polarizing → mean ≥ 6.5 → consistent_positive.
        expect(classifyVariability([6, 6.5, 6.5, 6.5, 7]).kind).toBe('consistent_positive');
    });

    it('LOW_MEAN boundary: mean exactly 4.0 (not bimodal) is consistent_low', () => {
        // [3, 3, 4, 5, 5]: sum 20, mean 4.0. Lows {3,3}, no highs (5 < HIGH_THIRD 6.667)
        // → not polarizing → mean ≤ 4 → consistent_low.
        expect(classifyVariability([3, 3, 4, 5, 5]).kind).toBe('consistent_low');
    });

    it('just above LOW_MEAN (not bimodal) is neutral, not low', () => {
        // [3, 4, 4, 5, 5]: mean 4.2 (> 4.0), no highs, lows {3} share 0.2 → neutral.
        expect(classifyVariability([3, 4, 4, 5, 5]).kind).toBe('consistent_neutral');
    });

    it('honours a custom minSamples gate', () => {
        expect(classifyVariability([5, 5], { minSamples: 3 }).kind).toBe('insufficient');
        expect(classifyVariability([5, 5, 5], { minSamples: 3 }).kind).not.toBe('insufficient');
    });

    it('exports sane threshold constants', () => {
        expect(MIN_VARIABILITY_SAMPLES).toBe(5);
        expect(LOW_THIRD).toBeCloseTo(3.333, 2);
        expect(HIGH_THIRD).toBeCloseTo(6.667, 2);
        expect(POLAR_TAIL_SHARE).toBe(0.25);
        expect(POSITIVE_MEAN).toBe(6.5);
        expect(LOW_MEAN).toBe(4.0);
    });
});

describe('activityMoodImpact', () => {
    it('splits with-vs-without by local day and gates on sample size', () => {
        // 12 days total. Activity logged on 6 of them, all high (8); the other 6 low (2).
        const activityEntries = [
            at(2026, 1, 1, 8),
            at(2026, 1, 2, 8),
            at(2026, 1, 3, 8),
            at(2026, 1, 4, 8),
            at(2026, 1, 5, 8),
            at(2026, 1, 6, 8),
        ];
        const otherEntries = [
            at(2026, 1, 7, 2),
            at(2026, 1, 8, 2),
            at(2026, 1, 9, 2),
            at(2026, 1, 10, 2),
            at(2026, 1, 11, 2),
            at(2026, 1, 12, 2),
        ];
        const all = [...activityEntries, ...otherEntries];
        const r = activityMoodImpact(all, activityEntries);
        expect(r.withAvg).toBe(8);
        expect(r.withoutAvg).toBe(2);
        expect(r.delta).toBe(6);
        expect(r.withDays).toBe(6);
        expect(r.withoutDays).toBe(6);
        expect(r.isMeaningful).toBe(true);
    });

    it('averages the per-DAY averages (a busy day counts once)', () => {
        // Day 1 has two "other" entries (mood 2 and 4 → day avg 3); day 2 is the activity (mood 9).
        const activityEntries = [at(2026, 2, 2, 9)];
        const all = [at(2026, 2, 1, 2), at(2026, 2, 1, 4), at(2026, 2, 2, 9)];
        const r = activityMoodImpact(all, activityEntries);
        expect(r.withAvg).toBe(9);
        expect(r.withoutAvg).toBe(3); // (2+4)/2, one day
        expect(r.withDays).toBe(1);
        expect(r.withoutDays).toBe(1);
        expect(r.isMeaningful).toBe(false); // < MIN_SAMPLES on each side
    });

    it('is null-safe when a side is empty', () => {
        const only = [at(2026, 3, 1, 7)];
        const r = activityMoodImpact(only, only); // every day is a "with" day
        expect(r.withAvg).toBe(7);
        expect(r.withoutAvg).toBeNull();
        expect(r.delta).toBeNull();
        expect(r.isMeaningful).toBe(false);
    });

    it('does not throw on empty input', () => {
        expect(() => activityMoodImpact([], [])).not.toThrow();
        expect(activityMoodImpact([], []).withAvg).toBeNull();
    });
});

describe('moodTrendForActivity', () => {
    it('returns per-local-day averages oldest→newest', () => {
        const rows = [
            at(2026, 4, 2, 6),
            at(2026, 4, 1, 4),
            at(2026, 4, 1, 8), // day 1 avg = 6
        ];
        expect(moodTrendForActivity(rows)).toEqual([
            { day: '2026-04-01', avg: 6 },
            { day: '2026-04-02', avg: 6 },
        ]);
    });

    it('is empty on empty input', () => {
        expect(moodTrendForActivity([])).toEqual([]);
    });
});

describe('sparklinePoints', () => {
    it('is empty on empty values or non-positive dims', () => {
        expect(sparklinePoints([], 100, 40)).toEqual([]);
        expect(sparklinePoints([5], 0, 40)).toEqual([]);
        expect(sparklinePoints([5], 100, 0)).toEqual([]);
    });

    it('centres a single point and maps mood→y (10=top, 0=bottom)', () => {
        expect(sparklinePoints([10], 100, 40)).toEqual([{ x: 50, y: 0 }]);
        expect(sparklinePoints([0], 100, 40)).toEqual([{ x: 50, y: 40 }]);
    });

    it('spreads points to both ends and never overshoots [0, height]', () => {
        const pts = sparklinePoints([0, 5, 10, 12, -3], 100, 40);
        expect(pts[0].x).toBe(0);
        expect(pts[pts.length - 1].x).toBe(100);
        for (const p of pts) {
            expect(p.y).toBeGreaterThanOrEqual(0);
            expect(p.y).toBeLessThanOrEqual(40);
        }
    });
});

describe('topCoOccurring', () => {
    const rows: CoOccurringRow[] = [
        { id: 3, name: 'Gym', icon_family: 'Feather', icon_name: 'activity', n: 5 },
        { id: 2, name: 'Work', icon_family: 'Feather', icon_name: 'briefcase', n: 2 },
        { id: 9, name: 'Empty', icon_family: 'Feather', icon_name: 'circle', n: 0 },
    ];

    it('drops zero-count rows and caps to the limit', () => {
        expect(topCoOccurring(rows, 1)).toEqual([rows[0]]);
        expect(topCoOccurring(rows).map((r) => r.id)).toEqual([3, 2]); // n=0 dropped
    });

    it('is empty-safe', () => {
        expect(topCoOccurring([])).toEqual([]);
        expect(topCoOccurring(rows, 0)).toEqual([]);
    });
});

describe('withEntryCounts', () => {
    const activities = [
        { id: 1, name: 'Running' },
        { id: 2, name: 'Work' },
        { id: 3, name: 'Aardvark' },
    ];

    it('decorates with counts and sorts most-logged first, then name', () => {
        const out = withEntryCounts(activities, [
            { activity_id: 1, n: 3 },
            { activity_id: 2, n: 3 },
            // id 3 has no count row → 0
        ]);
        // ties (Running 3, Work 3) resolve by name; Aardvark (0) last.
        expect(out.map((a) => a.name)).toEqual(['Running', 'Work', 'Aardvark']);
        expect(out.map((a) => a.entryCount)).toEqual([3, 3, 0]);
    });

    it('defaults missing counts to 0 and never throws on nullish input', () => {
        expect(withEntryCounts(activities, [])[0].entryCount).toBe(0);
        expect(() => withEntryCounts([], [])).not.toThrow();
    });
});

describe('filterActivitiesByQuery', () => {
    const activities = [{ name: 'Running' }, { name: 'Reading' }, { name: 'Gym' }];

    it('returns all on an empty / whitespace query', () => {
        expect(filterActivitiesByQuery(activities, '')).toHaveLength(3);
        expect(filterActivitiesByQuery(activities, '   ')).toHaveLength(3);
    });

    it('filters case-insensitively by name substring', () => {
        expect(filterActivitiesByQuery(activities, 'r').map((a) => a.name)).toEqual([
            'Running',
            'Reading',
        ]);
        expect(filterActivitiesByQuery(activities, 'GYM').map((a) => a.name)).toEqual(['Gym']);
    });

    it('returns empty when nothing matches', () => {
        expect(filterActivitiesByQuery(activities, 'zzz')).toEqual([]);
    });
});
