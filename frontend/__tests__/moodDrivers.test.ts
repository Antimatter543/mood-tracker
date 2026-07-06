import {
    buildMoodDrivers,
    buildDayModel,
    FWD_MAX_GAP,
    STEADY_BAND,
    MIN_DRIVER_SAMPLES,
    MIN_RECOVERY_LIFT,
    DIP_DROP_THRESHOLD,
    MIN_STABILITY_RISK_REDUCTION,
    type DayModel,
} from '@/components/visualisations/transforms/moodDrivers';
import { DIP_THRESHOLD } from '@/components/visualisations/transforms/recoveryPatterns';
import type { ActivityCorrelationRawRow } from '@/components/visualisations/transforms/activityCorrelation';

// ---------------------------------------------------------------------------
// Fixture builder. One entry per consecutive local day starting 2026-03-01.
// Mid-day UTC instants land unambiguously on the same local day in any of the
// app's supported timezones (the suite is pinned to Australia/Brisbane UTC+10).
// ---------------------------------------------------------------------------

let entryId = 1;

type DaySpec = { mood: number; activities?: string[]; gapBefore?: number };

const ACT_ID: Record<string, number> = {};
const activityId = (name: string): number => {
    if (!(name in ACT_ID)) ACT_ID[name] = Object.keys(ACT_ID).length + 1;
    return ACT_ID[name];
};

/** Build raw rows for a sequence of days. `gapBefore` skips N extra days. */
const buildRows = (specs: DaySpec[]): ActivityCorrelationRawRow[] => {
    const rows: ActivityCorrelationRawRow[] = [];
    // Start from a fixed date; advance a JS Date in UTC by whole days.
    const cursor = new Date(Date.UTC(2026, 2, 1, 12, 0, 0)); // 2026-03-01T12:00Z
    for (const spec of specs) {
        if (spec.gapBefore) cursor.setUTCDate(cursor.getUTCDate() + spec.gapBefore);
        const id = entryId++;
        const date = cursor.toISOString();
        const acts = spec.activities ?? [];
        if (acts.length === 0) {
            rows.push({
                entry_id: id,
                date,
                mood: spec.mood,
                activity_id: null,
                activity_name: null,
            });
        } else {
            for (const a of acts) {
                rows.push({
                    entry_id: id,
                    date,
                    mood: spec.mood,
                    activity_id: activityId(a),
                    activity_name: a,
                });
            }
        }
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return rows;
};

const addIsolatedPair = (
    specs: DaySpec[],
    first: Omit<DaySpec, 'gapBefore'>,
    second: Omit<DaySpec, 'gapBefore'>
) => {
    specs.push({ ...first, gapBefore: specs.length === 0 ? 0 : FWD_MAX_GAP + 3 });
    specs.push(second);
};

beforeEach(() => {
    entryId = 1;
});

describe('buildDayModel', () => {
    it('keys days locally, de-dupes entries by id, builds activity sets', () => {
        const rows = buildRows([
            { mood: 6, activities: ['Walk', 'Read'] },
            { mood: 4, activities: ['Walk'] },
            { mood: 8 },
        ]);
        const model = buildDayModel(rows);
        expect(model.days).toHaveLength(3);
        // sorted ascending
        expect([...model.days]).toEqual([...model.days].sort());
        // de-duped: the two-activity day still averages to its single mood
        expect(model.dayAvg.get(model.days[0])).toBe(6);
        expect(model.activityNames).toEqual(new Set(['Walk', 'Read']));
        expect(model.activityDays.get('Walk')!.size).toBe(2);
    });

    it('skips unparseable dates and non-finite moods without throwing', () => {
        const model = buildDayModel([
            { entry_id: 1, date: 'not-a-date', mood: 5, activity_id: null, activity_name: null },
            { entry_id: 2, date: '2026-03-01T12:00:00.000Z', mood: NaN, activity_id: null, activity_name: null },
            { entry_id: 3, date: '2026-03-02T12:00:00.000Z', mood: 7, activity_id: null, activity_name: null },
        ]);
        expect(model.days).toHaveLength(1);
        expect(model.dayAvg.get(model.days[0])).toBe(7);
    });

    it('handles empty input', () => {
        const model: DayModel = buildDayModel([]);
        expect(model.days).toEqual([]);
        expect(model.activityNames.size).toBe(0);
    });
});

describe('buildMoodDrivers — edge cases never throw', () => {
    it('empty rows -> EMPTY', () => {
        const d = buildMoodDrivers([]);
        expect(d.recoveryDrivers).toEqual([]);
        expect(d.stabilityAnchors).toEqual([]);
        expect(d.hasRecoverySignal).toBe(false);
        expect(d.hasStabilitySignal).toBe(false);
        expect(d.lowDayCount).toBe(0);
        expect(d.steadyDayCount).toBe(0);
    });

    it('all entries on the same day -> no forward signal -> EMPTY', () => {
        const sameDay: ActivityCorrelationRawRow[] = [
            { entry_id: 1, date: '2026-03-01T08:00:00.000Z', mood: 3, activity_id: 1, activity_name: 'Walk' },
            { entry_id: 2, date: '2026-03-01T20:00:00.000Z', mood: 4, activity_id: 1, activity_name: 'Walk' },
        ];
        const d = buildMoodDrivers(sameDay);
        expect(d.recoveryDrivers).toEqual([]);
        expect(d.steadyDayCount).toBe(0);
    });

    it('large gaps between every day kill the forward signal -> EMPTY', () => {
        // Every day a week apart -> gap > FWD_MAX_GAP for every transition.
        const rows = buildRows([
            { mood: 3, activities: ['Walk'] },
            { mood: 7, activities: ['Walk'], gapBefore: 6 },
            { mood: 3, activities: ['Walk'], gapBefore: 6 },
            { mood: 7, activities: ['Walk'], gapBefore: 6 },
        ]);
        const d = buildMoodDrivers(rows);
        expect(d.lowDayCount).toBe(0);
        expect(d.steadyDayCount).toBe(0);
        expect(d.recoveryDrivers).toEqual([]);
    });

    it('below-gate sample sizes -> empty arrays + false flags', () => {
        // Only 2 low days with Walk -> below MIN_DRIVER_SAMPLES.
        const rows = buildRows([
            { mood: 3, activities: ['Walk'] },
            { mood: 7 },
            { mood: 3, activities: ['Walk'] },
            { mood: 7 },
            { mood: 8 },
            { mood: 8 },
        ]);
        const d = buildMoodDrivers(rows);
        expect(d.hasRecoverySignal).toBe(false);
        expect(d.recoveryDrivers).toEqual([]);
    });
});

describe('buildMoodDrivers — recovery drivers (low-day regime)', () => {
    it('surfaces an activity followed by a bigger lift on low days', () => {
        // Pattern: low day (mood 3). On low days WITH Walk the next day jumps to
        // 8 (+5); on low days WITHOUT Walk the next day only reaches 4 (+1).
        // Need >= 4 low-with and >= 4 low-without, each with a forward signal.
        const specs: DaySpec[] = [];
        // 4 low+Walk -> lift blocks
        for (let i = 0; i < 4; i++) {
            specs.push({ mood: 3, activities: ['Walk'] }); // low day d
            specs.push({ mood: 8 }); // next day: big lift
        }
        // 4 low+noWalk -> small lift blocks
        for (let i = 0; i < 4; i++) {
            specs.push({ mood: 3 }); // low day d (no Walk)
            specs.push({ mood: 4 }); // next day: small lift
        }
        const d = buildMoodDrivers(buildRows(specs));
        expect(d.hasRecoverySignal).toBe(true);
        const walk = d.recoveryDrivers.find((x) => x.activity_name === 'Walk');
        expect(walk).toBeDefined();
        expect(walk!.effect).toBeGreaterThan(0);
        expect(walk!.withMean).toBeGreaterThan(walk!.withoutMean);
        expect(walk!.withCount).toBeGreaterThanOrEqual(MIN_DRIVER_SAMPLES);
        expect(walk!.withoutCount).toBeGreaterThanOrEqual(MIN_DRIVER_SAMPLES);
        expect(walk!.isMeaningful).toBe(true);
    });

    it('sorts recovery drivers by effect descending', () => {
        const specs: DaySpec[] = [];
        // Walk: low day -> +5; Read: low day -> +3; baseline without -> +1.
        for (let i = 0; i < 4; i++) {
            specs.push({ mood: 3, activities: ['Walk'] });
            specs.push({ mood: 8 });
        }
        for (let i = 0; i < 4; i++) {
            specs.push({ mood: 3, activities: ['Read'] });
            specs.push({ mood: 6 });
        }
        for (let i = 0; i < 4; i++) {
            specs.push({ mood: 3 });
            specs.push({ mood: 4 });
        }
        const d = buildMoodDrivers(buildRows(specs));
        const names = d.recoveryDrivers.map((x) => x.activity_name);
        // Walk (bigger lift) should come before Read.
        expect(names.indexOf('Walk')).toBeLessThan(names.indexOf('Read'));
        for (let i = 1; i < d.recoveryDrivers.length; i++) {
            expect(d.recoveryDrivers[i - 1].effect).toBeGreaterThanOrEqual(
                d.recoveryDrivers[i].effect
            );
        }
    });

    it('an activity logged on every low day (withoutCount 0) is not meaningful', () => {
        const specs: DaySpec[] = [];
        for (let i = 0; i < 5; i++) {
            specs.push({ mood: 3, activities: ['Walk'] }); // every low day has Walk
            specs.push({ mood: 8 });
        }
        const d = buildMoodDrivers(buildRows(specs));
        // Walk is on EVERY low day -> withoutCount 0 -> filtered out.
        expect(d.recoveryDrivers.find((x) => x.activity_name === 'Walk')).toBeUndefined();
    });
});

describe('buildMoodDrivers — stability anchors (ordinary-day regime)', () => {
    it('surfaces an activity that makes a real next-day dip less likely', () => {
        // Ordinary baseline ~6. With Routine, the next day stays at 6. Without
        // Routine, the next day falls to the dip line (4). Isolated pairs keep
        // the filler days from becoming extra "without" samples.
        const specs: DaySpec[] = [];
        for (let i = 0; i < 4; i++) {
            addIsolatedPair(
                specs,
                { mood: 6, activities: ['Routine'] },
                { mood: 6 }
            );
        }
        for (let i = 0; i < 4; i++) {
            addIsolatedPair(specs, { mood: 6 }, { mood: 4 });
        }
        const d = buildMoodDrivers(buildRows(specs));
        expect(d.hasStabilitySignal).toBe(true);
        const routine = d.stabilityAnchors.find((x) => x.activity_name === 'Routine');
        expect(routine).toBeDefined();
        expect(routine!.withDipRate).toBe(0);
        expect(routine!.withoutDipRate).toBe(1);
        expect(routine!.riskReduction).toBe(1);
        expect(routine!.isMeaningful).toBe(true);
    });

    it('sorts stability anchors by risk reduction descending', () => {
        const specs: DaySpec[] = [];
        for (let i = 0; i < 4; i++) {
            addIsolatedPair(specs, { mood: 6, activities: ['Strong'] }, { mood: 6 });
        }
        for (let i = 0; i < 4; i++) {
            addIsolatedPair(
                specs,
                { mood: 6, activities: ['Soft'] },
                { mood: i === 0 ? 4 : 6 }
            );
        }
        for (let i = 0; i < 4; i++) {
            addIsolatedPair(specs, { mood: 6 }, { mood: 4 });
        }
        const d = buildMoodDrivers(buildRows(specs));
        const names = d.stabilityAnchors.map((x) => x.activity_name);
        expect(names.indexOf('Strong')).toBeLessThan(names.indexOf('Soft'));
        for (let i = 1; i < d.stabilityAnchors.length; i++) {
            expect(d.stabilityAnchors[i - 1].riskReduction).toBeGreaterThanOrEqual(
                d.stabilityAnchors[i].riskReduction
            );
        }
    });

    it('does not treat high-day comedowns as useful negative insights', () => {
        // Celebration only appears on unusually high days. The next day cools
        // back to baseline, but that is not a "destabilizer" or an anchor.
        const specs: DaySpec[] = [];
        for (let i = 0; i < 5; i++) {
            addIsolatedPair(
                specs,
                { mood: 9, activities: ['Celebration'] },
                { mood: 6 }
            );
        }
        for (let i = 0; i < 5; i++) {
            addIsolatedPair(specs, { mood: 6 }, { mood: 6 });
        }
        const d = buildMoodDrivers(buildRows(specs));
        expect(d.stabilityAnchors.find((x) => x.activity_name === 'Celebration')).toBeUndefined();
        expect(d.recoveryDrivers.find((x) => x.activity_name === 'Celebration')).toBeUndefined();
    });
});

describe('buildMoodDrivers — constants & honesty', () => {
    it('keeps documented thresholds and reuses DIP_THRESHOLD', () => {
        expect(FWD_MAX_GAP).toBe(3);
        expect(STEADY_BAND).toBe(1.0);
        expect(MIN_DRIVER_SAMPLES).toBe(4);
        expect(MIN_RECOVERY_LIFT).toBe(0.5);
        expect(DIP_DROP_THRESHOLD).toBe(1.5);
        expect(MIN_STABILITY_RISK_REDUCTION).toBe(0.2);
        expect(DIP_THRESHOLD).toBe(4.0);
    });

    it('does not call smaller losses a recovery helper', () => {
        // Act is "better" than the no-activity days (-1 vs -2), but still not
        // a bounce-back. The card should not tell the user this helps recovery.
        const specs: DaySpec[] = [];
        for (let i = 0; i < 4; i++) {
            addIsolatedPair(specs, { mood: 3, activities: ['Act'] }, { mood: 2 });
        }
        for (let i = 0; i < 4; i++) {
            addIsolatedPair(specs, { mood: 3 }, { mood: 1 });
        }
        const d = buildMoodDrivers(buildRows(specs));
        expect(d.recoveryDrivers.find((x) => x.activity_name === 'Act')).toBeUndefined();
    });
});
