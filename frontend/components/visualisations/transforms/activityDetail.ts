// activityDetail.ts
//
// Pure transforms for the per-activity insights detail screen ("Explore your
// activities"). Every function here is framework-free (imports only the
// canonical date helper + sibling pure transforms) so the detail component is a
// thin renderer and the logic — especially the variability classifier, which is
// the feature's centerpiece — is exhaustively unit-tested.
//
// SAFETY CONTRACT: every function is total on empty/degenerate input. A fresh
// install, a never-logged activity, or NaN moods must NEVER produce NaN or throw
// (mirrors the heatmap/streak/dailyAverages guards). Callers render calm
// low-data copy from the shapes returned here, not from exceptions.
//
// DAY-KEYING: any "which local day is this entry on" step goes through
// `localDateString` / `aggregateDailyAverages` (the one authority), never a
// SQL date() bucket — see databases/dateHelpers.ts READ CONTRACT.

import { localDateString } from '@/databases/dateHelpers';
import {
    aggregateDailyAverages,
    dailyAverageMap,
    type InstantValueRow,
} from './dailyAverages';
import { MIN_SAMPLES } from './activityCorrelation';

// Re-export so consumers can `bucketMoodHistogram` the activity's moods from one
// import surface without reimplementing the distribution (the histogram uses the
// exact same 0..9 buckets as the Stats "Mood Distribution" chart).
export { bucketMoodHistogram } from './scatter';

/** Round to 1 decimal place (matches the app's ROUND(x, 1) display convention). */
const round1 = (n: number): number => Math.round(n * 10) / 10;

const finiteMoods = (moods: readonly number[] | null | undefined): number[] =>
    (moods ?? []).filter(
        (m): m is number => typeof m === 'number' && Number.isFinite(m),
    );

// ---------------------------------------------------------------------------
// Summary statistics for one activity's moods.
// ---------------------------------------------------------------------------

export type ActivityMoodStats = {
    count: number;
    mean: number;
    /** POPULATION standard deviation (÷N). 0 for a single value; never NaN. */
    stdev: number;
    min: number;
    max: number;
    median: number;
};

/**
 * Summary stats over an activity's mood values. All numeric fields rounded to
 * 1dp. Empty input returns all-zeros (never NaN / never throws).
 */
export const activityMoodStats = (moods: number[]): ActivityMoodStats => {
    const vals = finiteMoods(moods);
    const count = vals.length;
    if (count === 0) {
        return { count: 0, mean: 0, stdev: 0, min: 0, max: 0, median: 0 };
    }

    const sum = vals.reduce((s, m) => s + m, 0);
    const mean = sum / count;
    // Population variance (÷N): we're describing THIS set of days, not sampling
    // a larger population, and ÷N keeps a single value at stdev 0 (÷(N-1) → NaN).
    const variance = vals.reduce((s, m) => s + (m - mean) ** 2, 0) / count;
    const stdev = Math.sqrt(variance);

    const sorted = [...vals].sort((a, b) => a - b);
    const mid = Math.floor(count / 2);
    const median =
        count % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];

    return {
        count,
        mean: round1(mean),
        stdev: round1(stdev),
        min: round1(sorted[0]),
        max: round1(sorted[count - 1]),
        median: round1(median),
    };
};

// ---------------------------------------------------------------------------
// Variability classifier — THE centerpiece insight.
//
// Answers the user's question: "with this activity do I tend to be really sad
// OR really happy (hit or miss), or consistently good/bad/middling?"
//
// The thresholds are exported named constants so the boundaries are testable and
// tunable in one place.
// ---------------------------------------------------------------------------

/** Minimum entries before we classify at all. Reuses the app's one 5-sample gate. */
export const MIN_VARIABILITY_SAMPLES = MIN_SAMPLES; // 5

/** Bottom third upper bound (exclusive): a mood < this is a "genuinely low" day. */
export const LOW_THIRD = 10 / 3; // ≈ 3.333
/** Top third lower bound (inclusive): a mood ≥ this is a "genuinely high" day. */
export const HIGH_THIRD = 20 / 3; // ≈ 6.667
/**
 * Minimum share of entries in EACH extreme third for "polarizing". Requiring
 * both tails to be populated (not just a wide stdev) is what makes this a
 * genuine bimodal / hit-or-miss signal rather than a merely spread-out one. At
 * the 5-sample floor this means ≥2 low AND ≥2 high days.
 */
export const POLAR_TAIL_SHARE = 0.25;
/** Mean at/above this (and not polarizing) reads as reliably good. */
export const POSITIVE_MEAN = 6.5;
/** Mean at/below this (and not polarizing) reads as consistently low. */
export const LOW_MEAN = 4.0;

export type VariabilityKind =
    | 'insufficient'
    | 'consistent_positive'
    | 'consistent_low'
    | 'consistent_neutral'
    | 'polarizing';

export type VariabilityInsight = {
    kind: VariabilityKind;
    /** Short, punchy label (e.g. "Hit or miss"). */
    headline: string;
    /** One honest, plain-language sentence, interpolating the activity name. */
    detail: string;
};

/**
 * Classify how the user's mood behaves on this activity's days.
 *
 * Decision order:
 *   1. Fewer than `minSamples` entries → 'insufficient' (calm low-data copy).
 *   2. A meaningful share in BOTH the bottom third AND the top third of the
 *      0–10 scale → 'polarizing' ("hit or miss" — bimodal, high variability).
 *   3. Otherwise the distribution is concentrated; label by mean position:
 *      mean ≥ POSITIVE_MEAN → 'consistent_positive', mean ≤ LOW_MEAN →
 *      'consistent_low', else 'consistent_neutral'.
 *
 * `opts.label` is the activity name used in the copy (defaults to "this
 * activity"). `opts.minSamples` overrides the sufficiency gate for tests.
 */
export const classifyVariability = (
    moods: number[],
    opts?: { minSamples?: number; label?: string },
): VariabilityInsight => {
    const minSamples = opts?.minSamples ?? MIN_VARIABILITY_SAMPLES;
    const label = opts?.label?.trim() || 'this activity';
    const vals = finiteMoods(moods);

    if (vals.length < minSamples) {
        return {
            kind: 'insufficient',
            headline: 'Not enough yet',
            detail: `Log ${label} a few more times to see whether your mood on those days is steady or all over the place.`,
        };
    }

    const clamped = vals.map((m) => Math.min(10, Math.max(0, m)));
    const n = clamped.length;
    let low = 0;
    let high = 0;
    for (const m of clamped) {
        if (m < LOW_THIRD) low += 1;
        else if (m >= HIGH_THIRD) high += 1;
    }
    const lowShare = low / n;
    const highShare = high / n;
    const mean = clamped.reduce((s, m) => s + m, 0) / n;

    if (lowShare >= POLAR_TAIL_SHARE && highShare >= POLAR_TAIL_SHARE) {
        return {
            kind: 'polarizing',
            headline: 'Hit or miss',
            detail: `Your mood on ${label} days swings a lot — some are among your best, some among your lowest.`,
        };
    }

    if (mean >= POSITIVE_MEAN) {
        return {
            kind: 'consistent_positive',
            headline: 'Reliably good',
            detail: `Your mood on ${label} days is usually good — mostly high, rarely a low one.`,
        };
    }
    if (mean <= LOW_MEAN) {
        return {
            kind: 'consistent_low',
            headline: 'Consistently tough',
            detail: `Your mood on ${label} days tends to run low — steadily hard rather than wildly up and down.`,
        };
    }
    return {
        kind: 'consistent_neutral',
        headline: 'Steady middle',
        detail: `Your mood on ${label} days mostly lands in the middle — no strong pull up or down.`,
    };
};

// ---------------------------------------------------------------------------
// "vs your usual mood" — honest with-vs-without split, keyed to the local day
// and gated on sample size (mirrors activityCorrelation's rigor, but computed
// for ONE activity by its exact entry set — so it never conflates two
// same-named activities in different groups the way name-keying would).
// ---------------------------------------------------------------------------

export type ActivityMoodImpact = {
    /** Avg of the per-day mood averages on days this activity was logged. */
    withAvg: number | null;
    /** Avg of the per-day mood averages on days it was NOT logged. */
    withoutAvg: number | null;
    /** withAvg − withoutAvg (null unless both sides exist). */
    delta: number | null;
    withDays: number;
    withoutDays: number;
    /** Both sides have ≥ minSamples days — enough to state the comparison. */
    isMeaningful: boolean;
};

/**
 * Compare mood on this activity's days vs all other days.
 *
 * `allEntries` = every entry (raw {date, mood}); `activityEntries` = the subset
 * that logged this activity. Both are day-keyed via localDateString; we average
 * the per-day averages (so a day with many entries counts once, matching
 * activityCorrelation). "without" days are the local days present in the data
 * that this activity was NOT on.
 */
export const activityMoodImpact = (
    allEntries: InstantValueRow[],
    activityEntries: InstantValueRow[],
    minSamples: number = MIN_SAMPLES,
): ActivityMoodImpact => {
    const dayAvg = dailyAverageMap(allEntries); // Map<localDay, avgMood>

    const withDaySet = new Set<string>();
    for (const row of activityEntries ?? []) {
        if (!row || typeof row.date !== 'string') continue;
        if (Number.isNaN(new Date(row.date).getTime())) continue;
        withDaySet.add(localDateString(row.date));
    }

    let sumWith = 0;
    let countWith = 0;
    let sumWithout = 0;
    let countWithout = 0;
    for (const [day, avg] of dayAvg) {
        if (withDaySet.has(day)) {
            sumWith += avg;
            countWith += 1;
        } else {
            sumWithout += avg;
            countWithout += 1;
        }
    }

    const withAvg = countWith > 0 ? round1(sumWith / countWith) : null;
    const withoutAvg = countWithout > 0 ? round1(sumWithout / countWithout) : null;
    const delta =
        withAvg !== null && withoutAvg !== null ? round1(withAvg - withoutAvg) : null;

    return {
        withAvg,
        withoutAvg,
        delta,
        withDays: countWith,
        withoutDays: countWithout,
        isMeaningful: countWith >= minSamples && countWithout >= minSamples,
    };
};

// ---------------------------------------------------------------------------
// Optional trend: per-local-day averages for this activity, oldest→newest.
// A thin adapter over the one day-keying authority (aggregateDailyAverages).
// ---------------------------------------------------------------------------

export type ActivityTrendPoint = { day: string; avg: number };

export const moodTrendForActivity = (
    rows: InstantValueRow[],
): ActivityTrendPoint[] =>
    aggregateDailyAverages(rows).map((d) => ({ day: d.day, avg: d.avg }));

/**
 * Map trend values to sparkline pixel coordinates. Pure path math (per the
 * app's "path math lives in a tested transform" doctrine): mood 10 → top
 * (y=0), mood 0 → bottom (y=height); x spread evenly by index; a single point
 * centres horizontally. Values are clamped to 0..10 so a point can never
 * overshoot the [0, height] band. Empty / non-positive dims → [].
 */
export const sparklinePoints = (
    values: number[],
    width: number,
    height: number,
): { x: number; y: number }[] => {
    const vals = finiteMoods(values);
    if (vals.length === 0 || !(width > 0) || !(height > 0)) return [];
    const n = vals.length;
    return vals.map((v, i) => {
        const clamped = Math.min(10, Math.max(0, v));
        const x = n === 1 ? width / 2 : (i / (n - 1)) * width;
        const y = height - (clamped / 10) * height;
        return { x: round1(x), y: round1(y) };
    });
};

// ---------------------------------------------------------------------------
// "Often paired with" — cap + guard the co-occurrence rows (query already
// orders by shared-entry count DESC).
// ---------------------------------------------------------------------------

export type CoOccurringRow = {
    id: number;
    name: string;
    icon_family: string;
    icon_name: string;
    n: number;
};

export const DEFAULT_CO_OCCURRING_LIMIT = 6;

export const topCoOccurring = (
    rows: CoOccurringRow[],
    limit: number = DEFAULT_CO_OCCURRING_LIMIT,
): CoOccurringRow[] =>
    (rows ?? [])
        .filter((r) => r && typeof r.n === 'number' && r.n > 0)
        .slice(0, Math.max(0, limit));

// ---------------------------------------------------------------------------
// "Explore your activities" list model: activities decorated with their entry
// count, sorted most-logged first, and a pure case-insensitive name filter.
// ---------------------------------------------------------------------------

export type ActivityWithCount<T> = T & { entryCount: number };

export const withEntryCounts = <T extends { id: number; name: string }>(
    activities: T[],
    countRows: { activity_id: number; n: number }[],
): ActivityWithCount<T>[] => {
    const counts = new Map<number, number>();
    for (const r of countRows ?? []) {
        if (r && typeof r.activity_id === 'number') {
            counts.set(r.activity_id, typeof r.n === 'number' ? r.n : 0);
        }
    }
    return (activities ?? [])
        .map((a) => ({ ...a, entryCount: counts.get(a.id) ?? 0 }))
        .sort(
            (a, b) =>
                b.entryCount - a.entryCount || a.name.localeCompare(b.name),
        );
};

export const filterActivitiesByQuery = <T extends { name: string }>(
    activities: T[],
    query: string,
): T[] => {
    const q = (query ?? '').trim().toLowerCase();
    if (!q) return activities ?? [];
    return (activities ?? []).filter(
        (a) => typeof a?.name === 'string' && a.name.toLowerCase().includes(q),
    );
};
