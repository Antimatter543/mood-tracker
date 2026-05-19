// activityImpact.ts
//
// Pure transform: from per-activity aggregates, compute the top-N positive
// and top-N negative impacts on mood, in display order.
//
// Bug fixed here: previous component computed bar widths via
// `(Math.abs(impact) / maxImpact) * 0.65` with `maxImpact = Math.max(..., 0.1)`,
// which means an empty `impactData` still produces a sensible 0-width bar — but
// the SQL itself can divide by zero when `OverallAvg` has no entries
// (`AVG(mood)` on no rows is NULL, and `mood - NULL = NULL`). We can't fix that
// in pure JS, but we DO guard the JS path: rows with NaN/null impact are
// filtered out before display.

export type ActivityImpactRow = {
    activity_name: string;
    impact: number | null;
    entry_count: number;
};

export type ActivityImpactBreakdown = {
    positive: ActivityImpactRow[];   // top 5, impact > 0, sorted desc
    negative: ActivityImpactRow[];   // top 5, impact < 0, sorted ascending (most-negative first)
    /** Display ordering: positives top-down, then negatives (least to most negative on the bottom). */
    displayOrder: ActivityImpactRow[];
    /** Scale factor for bar widths — guarantees no division by zero. */
    maxAbsImpact: number;
};

const MIN_DIVISOR = 0.1;

/**
 * Compute the display breakdown.
 *
 * @param rows Raw rows. `impact === null` or NaN rows are dropped.
 * @param topN How many of each polarity to keep (default 5).
 */
export const computeActivityImpact = (
    rows: ActivityImpactRow[],
    topN: number = 5
): ActivityImpactBreakdown => {
    const valid = rows.filter(
        (r) =>
            r.impact !== null &&
            r.impact !== undefined &&
            Number.isFinite(r.impact)
    );

    const positive = valid
        .filter((r) => (r.impact as number) > 0)
        .sort((a, b) => (b.impact as number) - (a.impact as number))
        .slice(0, topN);

    const negative = valid
        .filter((r) => (r.impact as number) < 0)
        .sort((a, b) => (a.impact as number) - (b.impact as number))
        .slice(0, topN);

    // Display: positives in descending impact, then negatives reversed
    // (so the bottom of the list is the most negative — matches the
    // original component's intent).
    const displayOrder = [...positive, ...[...negative].reverse()];

    const maxAbsImpact = Math.max(
        ...valid.map((r) => Math.abs(r.impact as number)),
        MIN_DIVISOR
    );

    return { positive, negative, displayOrder, maxAbsImpact };
};

/** Bar width as a fraction (0..0.65) of half-track width. Always finite. */
export const barWidthFraction = (impact: number, maxAbsImpact: number): number => {
    if (!Number.isFinite(impact) || !Number.isFinite(maxAbsImpact) || maxAbsImpact <= 0) {
        return 0;
    }
    return (Math.abs(impact) / maxAbsImpact) * 0.65;
};
