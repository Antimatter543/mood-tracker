// activityCorrelation.ts
//
// Pure transform: rigorous with-vs-without activity correlation.
//
// Replaces the activityImpact "delta-from-overall-mean" approach, which is
// misleading — if a user does yoga only on their best days, delta-from-mean
// inflates yoga's apparent effect. The correct causal framing compares the
// average mood on DAYS THE ACTIVITY WAS LOGGED against the average mood on
// DAYS IT WAS NOT. The SQL (ACTIVITY_CORRELATION) does the heavy lifting; this
// transform applies the sample-size gate and sorts by effect size.

export type ActivityCorrelationRow = {
    activity_name: string;
    avg_with: number | null; // AVG(mood) on days the activity was logged
    avg_without: number | null; // AVG(mood) on days it was NOT logged
    count_with: number; // sample size when present
    count_without: number; // sample size when absent
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
