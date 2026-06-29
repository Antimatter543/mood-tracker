// moodDrivers.ts
//
// Pure transform: STATE-CONDITIONED, FORWARD-LOOKING activity correlation.
//
// `activityCorrelation.ts` answers "on days I log X, is my mood higher?" — a
// same-day, unconditioned comparison. That is useful but can't separate
// "X cheers me up" from "I only log X when I already feel good". This transform
// asks the two questions that actually help:
//
//   Recovery drivers — when I'm in a DIP, which activities tend to be FOLLOWED
//                       by a lift the next day?
//   Destabilizers    — when I'm usually STEADY, which activities tend to PRECEDE
//                       a dip the next day?
//
// "Forward delta" (what my mood did the day AFTER) is the honest local proxy
// for "did this lift / drain me", and conditioning on the regime (low vs steady)
// removes the "I only do yoga on good days" confound.
//
// DOCTRINE: built from the SAME RAW `ActivityCorrelationRawRow[]` the Insights
// tab already fetches. Day-keying goes through `localDateString` (via the shared
// `buildDayModel`), NEVER through SQL. Forward-gap is measured with `daysBetween`
// (the one local-day-distance authority), so a multi-day logging gap is NOT
// treated as "the next day".

import { localDateString, daysBetween } from '@/databases/dateHelpers';
import { DIP_THRESHOLD } from './recoveryPatterns';
import type { ActivityCorrelationRawRow } from './activityCorrelation';

// ---------------------------------------------------------------------------
// Shared day-model (DRY): the local-day-keyed view of the raw rows. This is the
// same structure `aggregateActivityCorrelation` computes internally; extracted
// here so both transforms day-key once, through `localDateString`.
// ---------------------------------------------------------------------------
export type DayModel = {
    days: string[]; // sorted ASC local "YYYY-MM-DD"
    dayAvg: Map<string, number>; // local day -> avg mood that day
    activityDays: Map<string, Set<string>>; // activity name -> local days it appears on
    activityNames: Set<string>;
};

/**
 * Build a local-day-keyed `DayModel` from raw (entry × activity) rows.
 *
 * The join repeats each entry once per activity, so entries are de-duped by id
 * when averaging per day. Rows with an unparseable date or non-finite mood are
 * skipped (degenerate input must never throw). `days` is sorted ascending.
 */
export const buildDayModel = (rows: ActivityCorrelationRawRow[]): DayModel => {
    const seenEntry = new Set<number>();
    const daySum = new Map<string, { sum: number; count: number }>();
    const activityDays = new Map<string, Set<string>>();
    const activityNames = new Set<string>();

    for (const row of rows ?? []) {
        if (!row || typeof row.date !== 'string') continue;
        if (typeof row.mood !== 'number' || !Number.isFinite(row.mood)) continue;
        if (Number.isNaN(new Date(row.date).getTime())) continue;

        const day = localDateString(row.date);

        if (!seenEntry.has(row.entry_id)) {
            seenEntry.add(row.entry_id);
            const acc = daySum.get(day);
            if (acc) {
                acc.sum += row.mood;
                acc.count += 1;
            } else {
                daySum.set(day, { sum: row.mood, count: 1 });
            }
        }

        if (row.activity_name != null && row.activity_id != null) {
            activityNames.add(row.activity_name);
            let set = activityDays.get(row.activity_name);
            if (!set) {
                set = new Set<string>();
                activityDays.set(row.activity_name, set);
            }
            set.add(day);
        }
    }

    const dayAvg = new Map<string, number>();
    for (const [day, { sum, count }] of daySum) dayAvg.set(day, sum / count);

    const days = [...dayAvg.keys()].sort((a, b) =>
        a < b ? -1 : a > b ? 1 : 0
    );

    return { days, dayAvg, activityDays, activityNames };
};

// ---------------------------------------------------------------------------
// Thresholds (tunable). DIP_THRESHOLD (4) is reused from recoveryPatterns.
// ---------------------------------------------------------------------------

/** A day's forward signal only counts if the next recorded day is this close. */
export const FWD_MAX_GAP = 3;

/**
 * "Steady" = above the dip line AND within this band of the user's OWN typical
 * level (the median of their day-averages) — i.e. their normal, not someone
 * else's. 1.0 pt either side.
 */
export const STEADY_BAND = 1.0;

/** Minimum days on EACH side (with vs without the activity) to call a driver real. */
export const MIN_DRIVER_SAMPLES = 4;

export type MoodDriver = {
    activity_name: string;
    effect: number; // signed, 2dp: withMean - withoutMean (of forward deltas)
    withMean: number; // mean forward delta on regime-days the activity was logged, 2dp
    withoutMean: number; // mean forward delta on regime-days it was not, 2dp
    withCount: number;
    withoutCount: number;
    isMeaningful: boolean;
};

export type MoodDriversData = {
    recoveryDrivers: MoodDriver[]; // meaningful, effect > 0, sorted desc (biggest lift first)
    destabilizers: MoodDriver[]; // meaningful, effect < 0, sorted asc (most draining first)
    lowDayCount: number; // recorded low days with a forward signal (for empty-state copy)
    steadyDayCount: number; // recorded steady days with a forward signal
    hasRecoverySignal: boolean;
    hasDestabilizerSignal: boolean;
};

const EMPTY: MoodDriversData = {
    recoveryDrivers: [],
    destabilizers: [],
    lowDayCount: 0,
    steadyDayCount: 0,
    hasRecoverySignal: false,
    hasDestabilizerSignal: false,
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

const median = (values: number[]): number => {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
};

/** One regime-day: its avg, its forward delta, and which activities it carried. */
type RegimeDay = { fwd: number; activities: Set<string> };

/**
 * For every recorded day with a valid forward signal, compute its forward delta
 * (avg of the next near-adjacent day minus this day's avg) and the set of
 * activities logged that day. Days whose next recorded day is more than
 * FWD_MAX_GAP away (or which are the last recorded day) have no forward signal
 * and are dropped.
 */
const forwardDays = (
    model: DayModel
): Map<string, RegimeDay> => {
    const { days, dayAvg, activityDays } = model;
    // Invert activityDays -> per-day activity set for O(1) lookup.
    const dayActivities = new Map<string, Set<string>>();
    for (const [name, daySet] of activityDays) {
        for (const day of daySet) {
            let set = dayActivities.get(day);
            if (!set) {
                set = new Set<string>();
                dayActivities.set(day, set);
            }
            set.add(name);
        }
    }

    const out = new Map<string, RegimeDay>();
    for (let i = 0; i < days.length - 1; i++) {
        const d = days[i];
        const next = days[i + 1];
        const gap = daysBetween(d + 'T00:00:00.000Z', next + 'T00:00:00.000Z');
        if (gap > FWD_MAX_GAP) continue;
        out.set(d, {
            fwd: dayAvg.get(next)! - dayAvg.get(d)!,
            activities: dayActivities.get(d) ?? new Set<string>(),
        });
    }
    return out;
};

/**
 * Run the with-vs-without forward-delta split for one regime over one set of
 * activity names. Returns the (signed-effect) driver list before sign/sort
 * filtering.
 */
const analyzeRegime = (
    regimeDays: RegimeDay[],
    activityNames: Set<string>
): MoodDriver[] => {
    const out: MoodDriver[] = [];
    for (const name of activityNames) {
        let sumWith = 0;
        let countWith = 0;
        let sumWithout = 0;
        let countWithout = 0;
        for (const rd of regimeDays) {
            if (rd.activities.has(name)) {
                sumWith += rd.fwd;
                countWith += 1;
            } else {
                sumWithout += rd.fwd;
                countWithout += 1;
            }
        }
        const withMean = countWith > 0 ? sumWith / countWith : 0;
        const withoutMean = countWithout > 0 ? sumWithout / countWithout : 0;
        out.push({
            activity_name: name,
            effect: round2(withMean - withoutMean),
            withMean: round2(withMean),
            withoutMean: round2(withoutMean),
            withCount: countWith,
            withoutCount: countWithout,
            isMeaningful:
                countWith >= MIN_DRIVER_SAMPLES &&
                countWithout >= MIN_DRIVER_SAMPLES,
        });
    }
    return out;
};

/**
 * Build the state-conditioned, forward-looking drivers from RAW activity rows.
 *
 * Edge cases (never throws):
 *  - empty rows / all-same-day -> EMPTY (no forward signal possible).
 *  - an activity logged every regime-day (withoutCount 0) -> not meaningful.
 *  - large gaps killing the forward signal -> those days drop out; if the gate
 *    isn't met the arrays come back empty with false flags.
 *  - below-gate sample sizes -> empty arrays + false flags (honest "keep logging").
 */
export const buildMoodDrivers = (
    rows: ActivityCorrelationRawRow[]
): MoodDriversData => {
    const model = buildDayModel(rows);
    if (model.days.length < 2) return EMPTY;

    const fwd = forwardDays(model);
    if (fwd.size === 0) return EMPTY;

    const baseline = median([...model.dayAvg.values()]);

    const lowDays: RegimeDay[] = [];
    const steadyDays: RegimeDay[] = [];
    for (const [day, rd] of fwd) {
        const avg = model.dayAvg.get(day)!;
        if (avg <= DIP_THRESHOLD) {
            lowDays.push(rd);
        } else if (Math.abs(avg - baseline) <= STEADY_BAND) {
            steadyDays.push(rd);
        }
    }

    const recoveryDrivers = analyzeRegime(lowDays, model.activityNames)
        .filter((d) => d.isMeaningful && d.effect > 0)
        .sort((a, b) => b.effect - a.effect);

    const destabilizers = analyzeRegime(steadyDays, model.activityNames)
        .filter((d) => d.isMeaningful && d.effect < 0)
        .sort((a, b) => a.effect - b.effect);

    return {
        recoveryDrivers,
        destabilizers,
        lowDayCount: lowDays.length,
        steadyDayCount: steadyDays.length,
        hasRecoverySignal: recoveryDrivers.length > 0,
        hasDestabilizerSignal: destabilizers.length > 0,
    };
};
