// moodState.ts
//
// Pure transform: a 2-axis classification of how the user has "been" lately.
//
// The single rising / falling / stable arrow (statSummary.trendArrow) answers
// only "which way is the line going". It says nothing about HOW the journey
// felt: a flat-but-jagged month and a flat-and-calm month read identically as
// "stable", which is dishonest. This transform splits the descriptor into two
// independent axes:
//
//   trend      — direction:  rising / steady / falling   (MA-style slope)
//   volatility — day-to-day swing:  stable / variable / volatile
//
// so "Settled" (steady + stable) and "Up and down" (steady + volatile) are told
// apart. It is ADDITIVE — buildStatSummary.trendArrow is untouched.
//
// DOCTRINE: this consumes already-LOCAL-day-keyed `DailyAverage[]` (from
// `aggregateDailyAverages`). It NEVER re-keys days and NEVER touches SQL. The
// calendar gap between two recorded days is measured with `daysBetween` (the
// one local-day-distance authority), so a long logging gap is not mistaken for
// a wild day-to-day swing.

import { daysBetween } from '@/databases/dateHelpers';
import { DailyAverage } from './dailyAverages';
import { SLOPE_THRESHOLD } from './statSummary';

export type MoodTrend = 'rising' | 'falling' | 'steady';
export type MoodVolatility = 'stable' | 'variable' | 'volatile';

export type MoodState = {
    state: 'building' | 'classified';
    trend: MoodTrend | null;
    volatility: MoodVolatility | null;
    swing: number | null; // mean day-to-day |Δ| over near-adjacent days, 1dp
    slope: number | null; // per-day, signed (least-squares over recorded days)
    label: string; // warm, plain, non-clinical descriptor
    description: string; // one sentence with the numbers
};

/**
 * Two adjacent recorded days further apart than this (calendar days) are NOT a
 * real "day-to-day swing" — a fortnight gap between two entries should not be
 * read as a wild jump. Diffs across a wider gap are excluded from `swing`.
 */
export const MAX_GAP_DAYS = 3;

/** swing < STABLE_SWING -> 'stable'; < VOLATILE_SWING -> 'variable'; else 'volatile'. */
export const STABLE_SWING = 0.8;
export const VOLATILE_SWING = 1.8;

/** Need at least this many recorded days (and >= 3 valid transitions) to classify. */
export const MIN_STATE_DAYS = 5;
export const MIN_STATE_TRANSITIONS = 3;

const BUILDING_LABEL = 'Keep logging to reveal your pattern';

const building = (): MoodState => ({
    state: 'building',
    trend: null,
    volatility: null,
    swing: null,
    slope: null,
    label: BUILDING_LABEL,
    description: '',
});

/**
 * Warm, plain-language label for each (trend × volatility) cell. Deliberately
 * non-clinical — no "depressive", "manic", "unstable" — these are patterns in
 * the data, not diagnoses.
 */
const LABELS: Record<MoodTrend, Record<MoodVolatility, string>> = {
    rising: {
        stable: 'Steadily lifting',
        variable: 'Trending up',
        volatile: 'Climbing through ups & downs',
    },
    steady: {
        stable: 'Settled',
        variable: 'Holding steady',
        volatile: 'Up and down',
    },
    falling: {
        stable: 'Gently dipping',
        variable: 'Trending down',
        volatile: 'A rough, turbulent patch',
    },
};

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Least-squares slope of y over x = 0..n-1 (per-day mood change). */
const leastSquaresSlope = (values: number[]): number => {
    const n = values.length;
    if (n < 2) return 0;
    // x = 0..n-1 -> meanX = (n-1)/2, sum((x-meanX)^2) = n(n^2-1)/12.
    const meanX = (n - 1) / 2;
    let meanY = 0;
    for (const v of values) meanY += v;
    meanY /= n;
    let num = 0;
    for (let i = 0; i < n; i++) num += (i - meanX) * (values[i] - meanY);
    const den = (n * (n * n - 1)) / 12;
    if (den === 0) return 0;
    const slope = num / den;
    return Number.isFinite(slope) ? slope : 0;
};

const classifyTrend = (slope: number): MoodTrend => {
    if (Math.abs(slope) < SLOPE_THRESHOLD) return 'steady';
    return slope > 0 ? 'rising' : 'falling';
};

const classifyVolatility = (swing: number): MoodVolatility => {
    if (swing < STABLE_SWING) return 'stable';
    if (swing < VOLATILE_SWING) return 'variable';
    return 'volatile';
};

const TREND_PHRASE: Record<MoodTrend, string> = {
    rising: 'drifting up',
    steady: 'level and calm',
    falling: 'drifting down',
};

/**
 * How the swing magnitude is framed in the sentence. "only ~X.X" reads honestly
 * for a calm month but would be glib for a turbulent one, so volatile/variable
 * states drop the "only".
 */
const SWING_PHRASE: Record<MoodVolatility, (pts: string) => string> = {
    stable: (pts) => `swinging only ~${pts} pts day to day`,
    variable: (pts) => `swinging ~${pts} pts day to day`,
    volatile: (pts) => `swinging ~${pts} pts day to day`,
};

/**
 * Classify the user's recent mood into a (trend × volatility) state.
 *
 * @param daily per-LOCAL-day averages, sorted ascending (from
 *   `aggregateDailyAverages`). RECORDED days only — do NOT gap-fill, since
 *   gap-filling flattens real swings and biases the slope toward zero.
 * @param opts.slope optional precomputed MA slope (per-day) so the descriptor
 *   matches the MoodTrendChart line. When absent, slope is computed via
 *   least-squares over `daily`.
 *
 * Edge cases (never throws):
 *  - empty / single day / below the data gate -> `state: 'building'`, nulls.
 *  - large gaps between every pair -> too few valid transitions -> 'building'.
 *  - NaN/Infinite supplied slope -> treated as 0 (steady).
 */
export const buildMoodState = (
    daily: DailyAverage[],
    opts?: { slope?: number }
): MoodState => {
    const days = (daily ?? []).filter(
        (d) =>
            d &&
            typeof d.day === 'string' &&
            typeof d.avg === 'number' &&
            Number.isFinite(d.avg)
    );

    if (days.length < MIN_STATE_DAYS) return building();

    // Day-to-day swing: |Δ| only across near-adjacent recorded days (gap <= MAX_GAP_DAYS).
    let swingSum = 0;
    let transitions = 0;
    for (let i = 1; i < days.length; i++) {
        const gap = daysBetween(
            days[i - 1].day + 'T00:00:00.000Z',
            days[i].day + 'T00:00:00.000Z'
        );
        if (gap <= MAX_GAP_DAYS) {
            swingSum += Math.abs(days[i].avg - days[i - 1].avg);
            transitions += 1;
        }
    }

    if (transitions < MIN_STATE_TRANSITIONS) return building();

    const swing = swingSum / transitions;

    const rawSlope =
        opts && typeof opts.slope === 'number' && Number.isFinite(opts.slope)
            ? opts.slope
            : leastSquaresSlope(days.map((d) => d.avg));

    const trend = classifyTrend(rawSlope);
    const volatility = classifyVolatility(swing);
    const swing1 = round1(swing);

    const label = LABELS[trend][volatility];
    const description = `${label} — ${TREND_PHRASE[trend]}, ${SWING_PHRASE[volatility](
        swing1.toFixed(1)
    )}.`;

    return {
        state: 'classified',
        trend,
        volatility,
        swing: swing1,
        slope: round1(rawSlope),
        label,
        description,
    };
};
