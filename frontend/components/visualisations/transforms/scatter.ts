// scatter.ts
//
// Pure transform for the mood-histogram view (`Scatterplot.tsx`). The name
// "scatter" predates the histogram refactor — kept for filename clarity per
// the brief.
//
// Buckets mood ratings into 10 integer buckets (0..9 — values >= 10 fall into
// the last bucket, matching the existing display which only labels 0..9 on
// the x-axis).
//
// Note on "identical (x,y) points": the existing chart is a histogram, so
// duplicate mood values are *expected* and counted into bucket frequency.
// We additionally expose `bucketEntries()` for a future scatter view that
// needs overlap counts, so callers can render with size/jitter.

export const NUM_BUCKETS = 10;

export type MoodSample = { mood: number };

/**
 * Return an array of length `NUM_BUCKETS` containing the count of moods in
 * each integer bucket. `mood` values outside [0, 10] are clamped.
 *
 * Empty input -> array of zeros. (Caller renders "no data" if needed.)
 */
export const bucketMoodHistogram = (entries: MoodSample[]): number[] => {
    const buckets = new Array(NUM_BUCKETS).fill(0);
    for (const e of entries) {
        if (typeof e.mood !== 'number' || !Number.isFinite(e.mood)) continue;
        const idx = Math.min(
            Math.max(Math.floor(e.mood), 0),
            NUM_BUCKETS - 1
        );
        buckets[idx]++;
    }
    return buckets;
};

/**
 * For a true scatter rendering: collapse duplicate (mood, ...keys) points and
 * return a list with per-point overlap counts. Useful for jittering or
 * sizing dots when multiple entries fall on the same coordinates.
 */
export const dedupePoints = <T extends { x: number; y: number }>(
    points: T[]
): (T & { count: number })[] => {
    const map = new Map<string, T & { count: number }>();
    for (const p of points) {
        const key = `${p.x}|${p.y}`;
        const existing = map.get(key);
        if (existing) {
            existing.count += 1;
        } else {
            map.set(key, { ...p, count: 1 });
        }
    }
    return Array.from(map.values());
};
