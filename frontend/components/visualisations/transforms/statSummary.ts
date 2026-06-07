// statSummary.ts
//
// Pure transform: aggregate the KPIs for the StatSummaryCard. This is a
// composition layer only — every input comes from another transform or a
// scalar SQL aggregate, so it has no SQLite dependency and is trivially testable.

export type StatSummaryInput = {
    currentStreak: number; // from streak.ts currentStreak()
    longestStreak: number; // from streak.ts longestStreak()
    avgMoodInWindow: number; // from WINDOW_SUMMARY AVG(mood)
    totalEntries: number; // COUNT in timeframe
    daysInWindow: number; // derived from timeframe
    movingAverageSlope: number; // (last MA point - first MA point) / days
};

export type StatSummaryData = {
    streak: number;
    longestStreak: number;
    avgMood: number; // rounded to 1dp
    consistency: number; // totalEntries / daysInWindow * 100, capped 100, rounded
    trendArrow: 'rising' | 'falling' | 'stable'; // |slope| < SLOPE_THRESHOLD -> stable
};

/** A per-day MA slope smaller than this (absolute) is considered stable. */
export const SLOPE_THRESHOLD = 0.02;

const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * Build the summary KPIs.
 *
 * Edge cases:
 *  - daysInWindow <= 0 -> consistency 0 (avoids div-by-zero).
 *  - NaN/Infinite slope -> stable.
 */
export const buildStatSummary = (input: StatSummaryInput): StatSummaryData => {
    const consistency =
        input.daysInWindow > 0
            ? Math.min(
                  100,
                  Math.round((input.totalEntries / input.daysInWindow) * 100)
              )
            : 0;

    const slope = Number.isFinite(input.movingAverageSlope)
        ? input.movingAverageSlope
        : 0;

    let trendArrow: 'rising' | 'falling' | 'stable';
    if (Math.abs(slope) < SLOPE_THRESHOLD) {
        trendArrow = 'stable';
    } else if (slope > 0) {
        trendArrow = 'rising';
    } else {
        trendArrow = 'falling';
    }

    return {
        streak: Math.max(0, Math.floor(input.currentStreak) || 0),
        longestStreak: Math.max(0, Math.floor(input.longestStreak) || 0),
        avgMood: round1(input.avgMoodInWindow || 0),
        consistency,
        trendArrow,
    };
};
