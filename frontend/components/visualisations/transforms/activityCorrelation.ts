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

/**
 * Build per-activity with/without rows from RAW joined rows, keying every entry
 * to its LOCAL day. Replaces the UTC `date(e.date)` grouping the SQL used to do.
 *
 * Algorithm (mirrors the old SQL's CTEs, but local-day-keyed):
 *   1. day_avg       — average mood per LOCAL day (over all entries that day).
 *   2. activity_days — the set of LOCAL days each activity appears on.
 *   3. For each activity: split every day in day_avg into "with" (day in the
 *      activity's set) vs "without", averaging the per-day averages.
 *
 * The per-entry rows repeat the (entry_id, date, mood) tuple once per activity,
 * so we de-dupe entries by id when building day_avg.
 */
export const aggregateActivityCorrelation = (
    rows: ActivityCorrelationRawRow[]
): ActivityCorrelationRow[] => {
    // 1. day_avg: one mood-average per local day. De-dupe entries by id (the
    //    join repeats an entry once per activity it has).
    const seenEntry = new Set<number>();
    const daySum = new Map<string, { sum: number; count: number }>();
    // 2. activity_days: activity name -> set of local days it appears on.
    const activityDays = new Map<string, Set<string>>();
    const activityNames = new Set<string>();

    for (const row of rows ?? []) {
        if (!row || typeof row.date !== 'string') continue;
        if (typeof row.mood !== 'number' || !Number.isFinite(row.mood)) continue;
        const t = new Date(row.date).getTime();
        if (Number.isNaN(t)) continue;

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

    // Per-day averages.
    const dayAvg = new Map<string, number>();
    for (const [day, { sum, count }] of daySum) dayAvg.set(day, sum / count);
    const allDays = [...dayAvg.keys()];

    // 3. Split per activity.
    const out: ActivityCorrelationRow[] = [];
    for (const name of activityNames) {
        const withDays = activityDays.get(name) ?? new Set<string>();
        let sumWith = 0;
        let countWith = 0;
        let sumWithout = 0;
        let countWithout = 0;
        for (const day of allDays) {
            const avg = dayAvg.get(day)!;
            if (withDays.has(day)) {
                sumWith += avg;
                countWith += 1;
            } else {
                sumWithout += avg;
                countWithout += 1;
            }
        }
        out.push({
            activity_name: name,
            avg_with: countWith > 0 ? Math.round((sumWith / countWith) * 100) / 100 : null,
            avg_without: countWithout > 0 ? Math.round((sumWithout / countWithout) * 100) / 100 : null,
            count_with: countWith,
            count_without: countWithout,
        });
    }
    return out;
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
