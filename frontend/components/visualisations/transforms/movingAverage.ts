// movingAverage.ts
//
// Pure transform: centred simple moving average over daily avg-mood rows.
//
// A raw daily-average line is noisy. A centred SMA turns day-to-day variance
// into a readable trend signal. The caller is responsible for filling gaps
// (missing days) before calling — pass the dense, gap-filled series produced
// by buildWeeklyMoodChartData so the window is over real calendar days.

export type DayAvg = { date: string; avgMood: number };

export type MovingAveragePoint = { date: string; value: number };

/**
 * Compute a centred simple moving average over daily avg-mood rows.
 *
 * @param rows   Sorted ascending by date. Gaps should already be filled by the
 *               caller. Each row's `avgMood` is the value to smooth.
 * @param window Number of days in the window. Defaults to 7. Coerced to the
 *               nearest odd number >= 1 so the window is symmetric (centred).
 * @returns Array of the same length as `rows`. Edge values use a partial,
 *          truncated window (only the dates that exist), so the line is
 *          defined everywhere with no NaN.
 *
 * Edge cases:
 *  - Empty input -> empty output.
 *  - Single point -> that point's value (window collapses to itself).
 *  - window > data length -> every output is the mean of all points.
 */
export const computeMovingAverage = (
    rows: DayAvg[],
    window: number = 7
): MovingAveragePoint[] => {
    if (rows.length === 0) return [];

    // Normalise window: at least 1, force odd for a symmetric centred window.
    let w = Math.max(1, Math.floor(window));
    if (w % 2 === 0) w += 1;
    const half = Math.floor(w / 2);

    return rows.map((row, i) => {
        const lo = Math.max(0, i - half);
        const hi = Math.min(rows.length - 1, i + half);
        let sum = 0;
        let n = 0;
        for (let j = lo; j <= hi; j++) {
            const v = rows[j].avgMood;
            if (typeof v === 'number' && Number.isFinite(v)) {
                sum += v;
                n += 1;
            }
        }
        return {
            date: row.date,
            value: n === 0 ? 0 : sum / n,
        };
    });
};
