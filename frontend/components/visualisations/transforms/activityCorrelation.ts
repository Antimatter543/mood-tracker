// activityCorrelation.ts
//
// Pure transform: rigorous with-vs-without activity correlation.
//
// Replaces the activityImpact "delta-from-overall-mean" approach, which is
// misleading — if a user does yoga only on their best days, delta-from-mean
// inflates yoga's apparent effect. The correct causal framing compares the
// average mood on DAYS THE ACTIVITY WAS LOGGED against the average mood on
// DAYS IT WAS NOT.
//
// DAY-KEYING: the SQL used to do the whole with/without computation, keying
// days with `date(e.date)` in UTC — so a late-evening / backdated entry counted
// toward the wrong calendar day's average and the wrong activity-day set. SQL
// now returns RAW rows (one per entry×activity, plus a NULL-activity row for
// activity-less entries); `aggregateActivityCorrelation` keys every entry to
// its LOCAL day via `localDateString`, builds the per-day averages and
// per-activity day sets in JS, then does the with-vs-without split.
// `computeActivityCorrelation` applies the sample-size gate and sorts by effect.

import { localDateString } from '@/databases/dateHelpers';
import type { Window } from './windowHelpers';

export type ActivityCorrelationRow = {
    activity_name: string;
    avg_with: number | null; // AVG(mood) on days the activity was logged
    avg_without: number | null; // AVG(mood) on days it was NOT logged
    count_with: number; // sample size when present
    count_without: number; // sample size when absent
};

/** A raw joined row from ACTIVITY_CORRELATION: one per (entry × activity). */
export type ActivityCorrelationRawRow = {
    entry_id: number;
    date: string; // UTC ISO instant
    mood: number;
    activity_id: number | null; // null for an entry with no activities
    activity_name: string | null; // null for an entry with no activities
};

// ---------------------------------------------------------------------------
// Activity CARRYOVER — a logged activity plausibly affects mood beyond the exact
// entry it's attached to (later entries that day, and the next day), with fading
// strength. `carryoverWeight` is the decay curve; `aggregateActivityCorrelation`
// applies it when the `carryover` option is on. When off, exposure is the
// original binary same-day membership and the output is numerically identical to
// the pre-carryover model (pinned by an OFF-mode parity regression test).
// ---------------------------------------------------------------------------

/** Hours at which the carryover weight reaches 0 (the forward lookback horizon). */
export const CARRYOVER_MAX_HOURS = 36;

/**
 * The carryover weight of an activity `hoursSince` after it was logged.
 *
 *   h <= 0        -> 1.0   (same instant)
 *   0 <  h < 24   -> 1.0 linearly down to 0.3   (1 - 0.7·h/24)
 *   24 <= h < 36  -> 0.3 linearly down to 0     (0.3·(1 - (h-24)/12))
 *   h >= 36       -> 0
 *
 * Total function: a non-finite input (NaN / ±Infinity) returns 0. Monotone
 * non-increasing and continuous at the 24h and 36h knots.
 */
export const carryoverWeight = (hoursSince: number): number => {
    if (!Number.isFinite(hoursSince)) return 0;
    if (hoursSince <= 0) return 1;
    if (hoursSince < 24) return 1 - 0.7 * (hoursSince / 24);
    if (hoursSince < CARRYOVER_MAX_HOURS) return 0.3 * (1 - (hoursSince - 24) / 12);
    return 0;
};

/**
 * The forward-decay exposure of an entry at instant `tE` to an activity with the
 * given ascending instance timestamps: the max carryover weight over instances
 * at or before `tE`. Because `carryoverWeight` is non-increasing, the closest
 * prior instance dominates, but we scan all `<= tE` to stay total. Future
 * instances (tA > tE) contribute nothing. Empty / all-future -> 0.
 */
const forwardExposure = (ascInstances: readonly number[], tE: number): number => {
    let best = 0;
    for (let i = 0; i < ascInstances.length; i++) {
        const tA = ascInstances[i];
        if (tA > tE) break; // sorted ascending: the rest are future instances
        const w = carryoverWeight((tE - tA) / 3_600_000);
        if (w > best) best = w;
    }
    return best;
};

/** Shared empty instance array so the OFF path allocates nothing per activity. */
const EMPTY_INSTANCES: readonly number[] = [];

export type AggregateActivityCorrelationOptions = {
    /**
     * When true, an activity's influence carries forward in time via
     * `carryoverWeight` (a day the activity isn't logged still gets partial
     * "with" credit from a recent prior logging). When false (the default),
     * exposure is binary same-day membership — numerically identical to the
     * pre-carryover model.
     */
    carryover?: boolean;
    /**
     * UTC ISO instant marking the TRUE window start. Rows earlier than this are
     * treated as activity INSTANCES only — they feed forward decay into the
     * window but are excluded from the day-mood samples and from the with/without
     * day universe. Undefined ⇒ every row is in-window (the OFF-mode default and
     * the correct value when the query wasn't extended backwards).
     */
    windowStart?: string;
};

/**
 * Build per-activity with/without rows from RAW joined rows, keying every entry
 * to its LOCAL day. Replaces the UTC `date(e.date)` grouping the SQL used to do.
 *
 * Unified model (parameterised by `carryover`):
 *   - dayMood(D)     — mean mood of local day D's entries (de-duped by entry_id).
 *   - exposure(E,A)  — how much entry E is "under" activity A, in [0,1]:
 *       max( sameDayTerm, forwardTerm )
 *       sameDayTerm = 1 if A is logged on E's local day (whole-day co-occurrence,
 *                     independent of intra-day order); else 0.
 *       forwardTerm = max carryoverWeight over A's instances at/before E (0 when
 *                     carryover is OFF).
 *   - dayExposure(D,A) = mean of exposure(E,A) over D's entries.
 *   - avg_with    = Σ dayExposure·dayMood / Σ dayExposure
 *     avg_without = Σ (1−dayExposure)·dayMood / Σ (1−dayExposure)
 *     count_with  = Σ dayExposure, count_without = Σ (1−dayExposure)  (fractional
 *     when carryover is on; the >= MIN_SAMPLES gate compares on these sums).
 *
 * With carryover OFF, exposure collapses to binary same-day membership, so
 * dayExposure ∈ {0,1} and every quantity above reduces EXACTLY to the legacy
 * "average the per-day means over with-days vs without-days" split.
 *
 * The per-entry rows repeat the (entry_id, date, mood) tuple once per activity,
 * so we de-dupe entries by id when building the day universe.
 */
export const aggregateActivityCorrelation = (
    rows: ActivityCorrelationRawRow[],
    opts: AggregateActivityCorrelationOptions = {}
): ActivityCorrelationRow[] => {
    const carryover = opts.carryover === true;
    // Rows strictly before windowStart are activity instances only (pre-window).
    const windowLowerMs =
        typeof opts.windowStart === 'string' && !Number.isNaN(new Date(opts.windowStart).getTime())
            ? new Date(opts.windowStart).getTime()
            : Number.NEGATIVE_INFINITY;

    // In-window entries, de-duped by id: id -> { t, mood, day }.
    const entries = new Map<number, { t: number; mood: number; day: string }>();
    // Activity name -> set of LOCAL days it appears on (ALL rows: pre + in-window).
    const activityDays = new Map<string, Set<string>>();
    // Activity name -> instance timestamps (ALL rows), keyed by entry id so each
    // (entry × activity) contributes at most one instant.
    const activityInstances = new Map<string, Map<number, number>>();
    const activityNames = new Set<string>();

    for (const row of rows ?? []) {
        if (!row || typeof row.date !== 'string') continue;
        if (typeof row.mood !== 'number' || !Number.isFinite(row.mood)) continue;
        const t = new Date(row.date).getTime();
        if (Number.isNaN(t)) continue;

        const day = localDateString(row.date);
        const inWindow = t >= windowLowerMs;

        // Day-mood universe: IN-WINDOW entries only, de-duped by id (the join
        // repeats an entry once per activity it has).
        if (inWindow && !entries.has(row.entry_id)) {
            entries.set(row.entry_id, { t, mood: row.mood, day });
        }

        // Activity day-membership + forward-decay instances: ALL rows.
        if (row.activity_name != null && row.activity_id != null) {
            activityNames.add(row.activity_name);

            let days = activityDays.get(row.activity_name);
            if (!days) {
                days = new Set<string>();
                activityDays.set(row.activity_name, days);
            }
            days.add(day);

            let inst = activityInstances.get(row.activity_name);
            if (!inst) {
                inst = new Map<number, number>();
                activityInstances.set(row.activity_name, inst);
            }
            if (!inst.has(row.entry_id)) inst.set(row.entry_id, t);
        }
    }

    // Per local day: mean mood + the day's entry instants (for dayExposure).
    const daySum = new Map<string, { sum: number; count: number }>();
    const dayEntries = new Map<string, { t: number }[]>();
    for (const { t, mood, day } of entries.values()) {
        const acc = daySum.get(day);
        if (acc) {
            acc.sum += mood;
            acc.count += 1;
        } else {
            daySum.set(day, { sum: mood, count: 1 });
        }
        let list = dayEntries.get(day);
        if (!list) {
            list = [];
            dayEntries.set(day, list);
        }
        list.push({ t });
    }
    const dayMood = new Map<string, number>();
    for (const [day, { sum, count }] of daySum) dayMood.set(day, sum / count);
    const allDays = [...dayMood.keys()];

    // Ascending instance timestamps per activity — only needed with carryover on.
    const sortedInstances = new Map<string, number[]>();
    if (carryover) {
        for (const [name, inst] of activityInstances) {
            sortedInstances.set(name, [...inst.values()].sort((a, b) => a - b));
        }
    }

    const out: ActivityCorrelationRow[] = [];
    for (const name of activityNames) {
        const withDays = activityDays.get(name);
        const instances = sortedInstances.get(name) ?? EMPTY_INSTANCES;

        let sumWith = 0; // Σ dayExposure · dayMood
        let sumWithout = 0; // Σ (1 − dayExposure) · dayMood
        let weightWith = 0; // Σ dayExposure          == count_with
        let weightWithout = 0; // Σ (1 − dayExposure)  == count_without

        for (const day of allDays) {
            const mood = dayMood.get(day)!;
            const sameDay = withDays?.has(day) ? 1 : 0;
            let dayExposure: number;
            if (!carryover) {
                // Binary same-day membership — identical to the legacy model.
                dayExposure = sameDay;
            } else {
                // Mean over the day's entries of max(sameDayTerm, forwardTerm).
                const list = dayEntries.get(day)!;
                let acc = 0;
                for (const e of list) {
                    acc += Math.max(sameDay, forwardExposure(instances, e.t));
                }
                dayExposure = acc / list.length;
            }
            sumWith += dayExposure * mood;
            weightWith += dayExposure;
            sumWithout += (1 - dayExposure) * mood;
            weightWithout += 1 - dayExposure;
        }

        out.push({
            activity_name: name,
            avg_with: weightWith > 0 ? Math.round((sumWith / weightWith) * 100) / 100 : null,
            avg_without:
                weightWithout > 0 ? Math.round((sumWithout / weightWithout) * 100) / 100 : null,
            count_with: weightWith,
            count_without: weightWithout,
        });
    }
    return out;
};

/**
 * Query bounds for the correlation chart given a timeframe window and the
 * carryover toggle. With carryover ON the query lower bound is extended
 * `CARRYOVER_MAX_HOURS` earlier so activities logged just before the window can
 * decay forward INTO it; `windowStart` carries the TRUE window start so the
 * transform excludes those earlier rows from the day universe. With carryover
 * OFF the bounds are the window verbatim and `windowStart` is undefined.
 */
export const carryoverQueryBounds = (
    window: Window,
    carryover: boolean
): { queryStart: string; queryEnd: string; windowStart?: string } => {
    if (!carryover) {
        return { queryStart: window.start, queryEnd: window.end };
    }
    const extended = new Date(
        new Date(window.start).getTime() - CARRYOVER_MAX_HOURS * 3_600_000
    ).toISOString();
    return { queryStart: extended, queryEnd: window.end, windowStart: window.start };
};

export type ActivityCorrelationResult = {
    activity_name: string;
    avg_with: number;
    avg_without: number;
    delta: number; // avg_with - avg_without
    count_with: number;
    count_without: number;
    /** True if both sides have >= MIN_SAMPLES days — enough for signal. */
    isMeaningful: boolean;
};

export type ActivityCorrelationData = {
    items: ActivityCorrelationResult[]; // all, sorted by |delta| desc
    meaningful: ActivityCorrelationResult[]; // isMeaningful=true only
};

/** Minimum days on EACH side required to call a correlation meaningful. */
export const MIN_SAMPLES = 5;

const num = (v: number | null): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : 0;

/**
 * Apply the sample-size gate, compute delta, and sort by effect size.
 *
 * Edge cases:
 *  - avg_with / avg_without NULL (no days on that side) -> coerced to 0; the
 *    item is not meaningful because the corresponding count is 0.
 *  - Activity logged every single day (count_without = 0) -> not meaningful.
 *  - Empty input -> empty result.
 */
export const computeActivityCorrelation = (
    rows: ActivityCorrelationRow[]
): ActivityCorrelationData => {
    const items: ActivityCorrelationResult[] = rows.map((r) => {
        const avgWith = num(r.avg_with);
        const avgWithout = num(r.avg_without);
        const countWith = num(r.count_with);
        const countWithout = num(r.count_without);
        return {
            activity_name: r.activity_name,
            avg_with: avgWith,
            avg_without: avgWithout,
            delta: avgWith - avgWithout,
            count_with: countWith,
            count_without: countWithout,
            isMeaningful:
                countWith >= MIN_SAMPLES && countWithout >= MIN_SAMPLES,
        };
    });

    items.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

    return {
        items,
        meaningful: items.filter((i) => i.isMeaningful),
    };
};

// ---------------------------------------------------------------------------
// View selection: top-N positive / top-N negative, with per-activity exclusion.
//
// These are the pure transforms that back the chart's "show top 5 best/worst by
// default, expand to see all, and exclude an activity so the next-strongest
// fills its slot" behavior. They are deliberately framework-free so the chart
// component is a thin renderer over them and the logic is fully unit-tested.
// ---------------------------------------------------------------------------

/** Default number of items shown per side (positive / negative) when collapsed. */
export const DEFAULT_TOP_N = 5;

export type CorrelationView = {
    /** delta >= 0, sorted by delta DESC (strongest lift first). */
    positive: ActivityCorrelationResult[];
    /** delta < 0, sorted by delta ASC (most draining first). */
    negative: ActivityCorrelationResult[];
    /** How many items were hidden purely by the collapse slice (0 when expanded). */
    hiddenByCollapse: number;
};

export type SelectCorrelationViewOptions = {
    /** Activity names to exclude entirely (filtered out before splitting). */
    excluded?: Iterable<string>;
    /** When true, return all items per side and hiddenByCollapse = 0. */
    expanded?: boolean;
    /** Items shown per side when collapsed. Defaults to DEFAULT_TOP_N. */
    topN?: number;
};

/**
 * Split meaningful correlations into positive / negative buckets, after removing
 * any excluded activities (so the next-strongest fills the vacated slot), then
 * optionally collapse each bucket to the top N.
 *
 *  - Exclusion happens FIRST, so excluded items never occupy a top-N slot.
 *  - delta >= 0 -> positive (matches the chart's `delta >= 0` color convention,
 *    so a delta of exactly 0 lands in positive, never lost between buckets).
 *  - positive sorted by delta DESC, negative by delta ASC (most draining first).
 *  - expanded -> full buckets, hiddenByCollapse 0; collapsed -> sliced to topN,
 *    hiddenByCollapse = total items dropped by the slice across both sides.
 */
export const selectCorrelationView = (
    meaningful: ActivityCorrelationResult[],
    opts: SelectCorrelationViewOptions = {}
): CorrelationView => {
    const { excluded, expanded = false, topN = DEFAULT_TOP_N } = opts;
    const excludedSet = new Set<string>(excluded ?? []);

    const visible = meaningful.filter((i) => !excludedSet.has(i.activity_name));

    const positiveAll = visible
        .filter((i) => i.delta >= 0)
        .sort((a, b) => b.delta - a.delta);
    const negativeAll = visible
        .filter((i) => i.delta < 0)
        .sort((a, b) => a.delta - b.delta);

    if (expanded) {
        return { positive: positiveAll, negative: negativeAll, hiddenByCollapse: 0 };
    }

    const positive = positiveAll.slice(0, topN);
    const negative = negativeAll.slice(0, topN);
    const hiddenByCollapse =
        positiveAll.length - positive.length + (negativeAll.length - negative.length);

    return { positive, negative, hiddenByCollapse };
};

/**
 * Parse the persisted excluded-activities setting (a JSON string array of names)
 * tolerantly: empty / null / corrupt / non-array / non-string members all yield
 * `[]`. Never throws — it gates rendering, so a bad value must degrade to "nothing
 * excluded" rather than crash the chart.
 */
export const parseExcludedActivities = (
    raw: string | null | undefined
): string[] => {
    if (typeof raw !== 'string' || raw.trim() === '') return [];
    try {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((v): v is string => typeof v === 'string');
    } catch {
        return [];
    }
};

/** Serialize excluded activity names to a JSON string array, de-duplicated. */
export const serializeExcludedActivities = (names: Iterable<string>): string =>
    JSON.stringify([...new Set(names)]);
