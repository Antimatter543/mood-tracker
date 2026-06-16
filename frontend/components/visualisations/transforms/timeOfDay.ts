// timeOfDay.ts
//
// Pure transform: average mood per PART-OF-DAY bucket, plus a "within-a-day"
// intraday-swing insight for days with multiple entries.
//
// HOUR/DAY-KEYING: the part-of-day bucket is derived from each entry's LOCAL
// hour-of-day (`new Date(instant).getHours()`), and the intraday grouping keys
// each entry to its LOCAL day via `localDateString` — exactly like
// dayOfWeekPattern.ts. SQL must NEVER extract the hour/day from the stored
// instant (it would run in UTC and mis-bucket late-evening/backdated entries for
// users east/west of UTC); the SQL (queries.ts TIME_OF_DAY_PATTERN) returns RAW
// instants only and all bucketing happens here. Invalid instants / non-finite
// moods are skipped with the same guards as `aggregateDowRows`.

import { localDateString } from '@/databases/dateHelpers';

/** A raw row straight from SQL: a stored UTC ISO instant + a numeric mood. */
export type TimeOfDayRow = {
    date: string; // UTC ISO instant
    mood: number;
};

/** Stable bucket identifiers (used as keys; do not reorder/rename lightly). */
export type TimeOfDayBucket = 'morning' | 'afternoon' | 'evening' | 'night';

/**
 * Part-of-day buckets, in display order. Tunable. `startHour`/`endHour` are
 * INCLUSIVE local-hour bounds [0..23]. `night` WRAPS midnight (22:00–04:59), so
 * it is matched specially in `bucketForHour` rather than by a simple range.
 */
export const TIME_OF_DAY_BUCKETS: readonly {
    bucket: TimeOfDayBucket;
    label: string;
    startHour: number;
    endHour: number;
}[] = [
    { bucket: 'morning', label: 'Morning', startHour: 5, endHour: 11 },
    { bucket: 'afternoon', label: 'Afternoon', startHour: 12, endHour: 16 },
    { bucket: 'evening', label: 'Evening', startHour: 17, endHour: 21 },
    { bucket: 'night', label: 'Night', startHour: 22, endHour: 4 }, // wraps midnight
] as const;

/** Enough entries for the by-bucket pattern to be meaningful (~2 weeks). Mirrors
 *  dayOfWeekPattern's MIN_ENTRIES_FOR_SIGNAL. */
const MIN_ENTRIES_FOR_SIGNAL = 14;

/** Days with >= this many multi-log days before the swing insight is shown. */
const MIN_MULTI_LOG_DAYS_FOR_SWING = 3;

/**
 * Maps a LOCAL hour-of-day [0..23] to its part-of-day bucket. Night wraps
 * midnight (>= 22 OR <= 4). Returns null for an out-of-range hour (defensive;
 * `getHours()` is always 0..23).
 */
export const bucketForHour = (hour: number): TimeOfDayBucket | null => {
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
    // Night first (the only wrapping range).
    if (hour >= 22 || hour <= 4) return 'night';
    if (hour >= 5 && hour <= 11) return 'morning';
    if (hour >= 12 && hour <= 16) return 'afternoon';
    return 'evening'; // 17..21
};

export type TimeOfDayBucketStat = {
    bucket: TimeOfDayBucket;
    label: string;
    avg_mood: number; // 2 dp, 0 when no entries
    entry_count: number;
};

export type TimeOfDayData = {
    /** One entry per bucket, in TIME_OF_DAY_BUCKETS order (always length 4). */
    buckets: TimeOfDayBucketStat[];
    /** Label of the highest-avg bucket among buckets WITH entries ('' if none). */
    bestBucket: string;
    /** Label of the lowest-avg bucket among buckets WITH entries ('' if none). */
    worstBucket: string;
    totalEntries: number;
    /** Whether there's enough data to be meaningful (>= 14 entries ~ 2 weeks). */
    hasEnoughData: boolean;
};

/**
 * Aggregate raw per-entry rows into one stat per part-of-day bucket.
 *
 * Each entry is keyed to its LOCAL hour-of-day via `new Date(instant).getHours()`
 * and bucketed by `bucketForHour`. Invalid instants / non-finite moods are
 * skipped. All 4 buckets are emitted (0/empty where none) in display order.
 * `bestBucket`/`worstBucket` are selected only among buckets that have entries.
 */
export const aggregateTimeOfDay = (rows: TimeOfDayRow[]): TimeOfDayData => {
    type Acc = { sum: number; count: number };
    const byBucket = new Map<TimeOfDayBucket, Acc>();

    for (const row of rows ?? []) {
        if (!row || typeof row.date !== 'string') continue;
        if (typeof row.mood !== 'number' || !Number.isFinite(row.mood)) continue;
        const d = new Date(row.date);
        if (Number.isNaN(d.getTime())) continue;

        const bucket = bucketForHour(d.getHours());
        if (!bucket) continue;

        const acc = byBucket.get(bucket);
        if (acc) {
            acc.sum += row.mood;
            acc.count += 1;
        } else {
            byBucket.set(bucket, { sum: row.mood, count: 1 });
        }
    }

    let totalEntries = 0;
    let bestLabel = '';
    let worstLabel = '';
    let bestVal = -Infinity;
    let worstVal = Infinity;

    const buckets: TimeOfDayBucketStat[] = TIME_OF_DAY_BUCKETS.map(({ bucket, label }) => {
        const acc = byBucket.get(bucket);
        const count = acc ? acc.count : 0;
        const avg = count > 0 ? Math.round((acc!.sum / count) * 100) / 100 : 0;
        totalEntries += count;

        if (count > 0) {
            if (avg > bestVal) {
                bestVal = avg;
                bestLabel = label;
            }
            if (avg < worstVal) {
                worstVal = avg;
                worstLabel = label;
            }
        }
        return { bucket, label, avg_mood: avg, entry_count: count };
    });

    return {
        buckets,
        bestBucket: bestLabel,
        worstBucket: worstLabel,
        totalEntries,
        hasEnoughData: totalEntries >= MIN_ENTRIES_FOR_SIGNAL,
    };
};

export type IntradaySwing = {
    /** Number of LOCAL days that had >= 2 entries. */
    multiLogDayCount: number;
    /** Average within-day range (maxMood - minMood) across multi-log days, 2 dp. */
    avgRange: number;
    /** Average within-day delta (last entry's mood - first entry's mood), 2 dp.
     *  Positive = mood rose across the day on average. */
    avgDelta: number;
    /** Whether there are enough multi-log days for the insight to be meaningful. */
    hasEnough: boolean;
};

/**
 * Compute the "within-a-day" mood swing across days the user logged more than
 * once. Entries are grouped by LOCAL day (`localDateString`); only days with
 * >= 2 valid entries are considered. For each such day:
 *   - range = max(mood) - min(mood)
 *   - delta = mood of the LAST instant - mood of the FIRST instant (by time)
 * The day's first/last are determined by sorting that day's instants by time,
 * so the caller's row ordering doesn't matter. Invalid instants / non-finite
 * moods are skipped. Empty / all-single-log input → multiLogDayCount 0,
 * hasEnough false, no NaN.
 */
export const computeIntradaySwing = (rows: TimeOfDayRow[]): IntradaySwing => {
    type DayEntry = { t: number; mood: number };
    const byDay = new Map<string, DayEntry[]>();

    for (const row of rows ?? []) {
        if (!row || typeof row.date !== 'string') continue;
        if (typeof row.mood !== 'number' || !Number.isFinite(row.mood)) continue;
        const t = new Date(row.date).getTime();
        if (Number.isNaN(t)) continue;

        const key = localDateString(row.date);
        const list = byDay.get(key);
        if (list) list.push({ t, mood: row.mood });
        else byDay.set(key, [{ t, mood: row.mood }]);
    }

    let multiLogDayCount = 0;
    let rangeSum = 0;
    let deltaSum = 0;

    for (const entries of byDay.values()) {
        if (entries.length < 2) continue;
        multiLogDayCount += 1;

        // Sort by time so first/last are by instant, not by input order.
        entries.sort((a, b) => a.t - b.t);

        let min = entries[0].mood;
        let max = entries[0].mood;
        for (const e of entries) {
            if (e.mood < min) min = e.mood;
            if (e.mood > max) max = e.mood;
        }
        rangeSum += max - min;
        deltaSum += entries[entries.length - 1].mood - entries[0].mood;
    }

    const round2 = (n: number) => Math.round(n * 100) / 100;
    return {
        multiLogDayCount,
        avgRange: multiLogDayCount > 0 ? round2(rangeSum / multiLogDayCount) : 0,
        avgDelta: multiLogDayCount > 0 ? round2(deltaSum / multiLogDayCount) : 0,
        hasEnough: multiLogDayCount >= MIN_MULTI_LOG_DAYS_FOR_SWING,
    };
};
