// dayOfWeekPattern.ts
//
// Pure transform: average mood per day-of-week, timeframe-scoped, with
// best/worst-day callouts. Replaces the all-time dailyBar logic FOR THE STATS
// SCREEN (the original buildDailyBarData stays for any other caller).
//
// Day-of-week convention: 0=Sun..6=Sat (the value JS `Date.getDay()` returns,
// matching the old strftime('%w')). This transform re-orders to a Monday-first
// labels array to match the heatmap convention used elsewhere on the stats
// screen.
//
// DAY-KEYING: the DOW used to come from SQLite's `strftime('%w', date)`, which
// extracts the weekday in UTC and so drifts by one for late-evening entries in
// non-UTC zones. We now aggregate from RAW {date: instant, mood} rows here in
// JS (`aggregateDowRows`), keying each entry to its LOCAL day-of-week via
// `localDateString` — so the bucket is always the user's weekday.

import { localDateString } from '@/databases/dateHelpers';

export type DowRow = {
    day_of_week: number; // 0=Sun..6=Sat (JS getDay() / old strftime %w)
    avg_mood: number;
    entry_count: number;
    best_mood: number; // MAX(mood) for that DOW
    worst_mood: number; // MIN(mood)
};

/** A raw row straight from SQL: a stored UTC ISO instant + a numeric mood. */
export type DowInstantRow = {
    date: string; // UTC ISO instant
    mood: number;
};

/**
 * Aggregate raw per-entry rows into one DowRow per LOCAL day-of-week.
 *
 * Each entry is keyed to its local weekday: parse `localDateString(instant)` as
 * local midnight and take `Date.getDay()` (0=Sun..6=Sat). Invalid instants /
 * non-finite moods are skipped. Only weekdays that actually have entries are
 * emitted; `buildDowPatternData` fills the rest with zeros.
 */
export const aggregateDowRows = (rows: DowInstantRow[]): DowRow[] => {
    type Acc = { sum: number; count: number; best: number; worst: number };
    const byDow = new Map<number, Acc>();

    for (const row of rows ?? []) {
        if (!row || typeof row.date !== 'string') continue;
        if (typeof row.mood !== 'number' || !Number.isFinite(row.mood)) continue;
        const t = new Date(row.date).getTime();
        if (Number.isNaN(t)) continue;

        // Key by the LOCAL weekday of the local day this entry belongs to.
        const dow = new Date(`${localDateString(row.date)}T00:00:00`).getDay();
        const acc = byDow.get(dow);
        if (acc) {
            acc.sum += row.mood;
            acc.count += 1;
            acc.best = Math.max(acc.best, row.mood);
            acc.worst = Math.min(acc.worst, row.mood);
        } else {
            byDow.set(dow, { sum: row.mood, count: 1, best: row.mood, worst: row.mood });
        }
    }

    const out: DowRow[] = [];
    for (const [dow, { sum, count, best, worst }] of byDow) {
        out.push({
            day_of_week: dow,
            avg_mood: Math.round((sum / count) * 100) / 100, // 2 dp, matches old SQL
            entry_count: count,
            best_mood: best,
            worst_mood: worst,
        });
    }
    return out;
};

export type DowPatternData = {
    labels: string[]; // length 7, Mon-start: ['Mon',...,'Sun']
    avgMood: number[]; // length 7, 0 when no entries
    entryCount: number[]; // length 7
    bestMood: number[]; // length 7
    worstMood: number[]; // length 7
    bestDay: string; // label of highest avg (among days with entries)
    worstDay: string; // label of lowest avg (among days with entries)
    totalEntries: number;
    /** Whether there's enough data to be meaningful (>= 14 entries ~ 2 weeks). */
    hasEnoughData: boolean;
};

// Monday-first labels. Index i maps to %w value via DOW_FOR_INDEX[i].
export const DAY_LABELS_MON_FIRST: readonly string[] =
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

// Monday-first index -> strftime %w value (0=Sun..6=Sat).
const DOW_FOR_INDEX = [1, 2, 3, 4, 5, 6, 0];

const MIN_ENTRIES_FOR_SIGNAL = 14;

/**
 * Build the day-of-week pattern from per-DOW aggregates.
 *
 * @param rows             one row per day_of_week that has entries.
 * @param minEntriesPerDay a day with fewer than this many entries is excluded
 *                         from best/worst-day selection (its bar still renders).
 *                         Default 1.
 */
export const buildDowPatternData = (
    rows: DowRow[],
    minEntriesPerDay: number = 1
): DowPatternData => {
    const avgMood = new Array(7).fill(0);
    const entryCount = new Array(7).fill(0);
    const bestMood = new Array(7).fill(0);
    const worstMood = new Array(7).fill(0);

    // Index rows by %w for O(1) lookup.
    const byDow = new Map<number, DowRow>();
    for (const row of rows) {
        if (
            typeof row.day_of_week !== 'number' ||
            row.day_of_week < 0 ||
            row.day_of_week > 6
        ) {
            continue;
        }
        byDow.set(row.day_of_week, row);
    }

    let totalEntries = 0;
    let bestIdx = -1;
    let worstIdx = -1;
    let bestVal = -Infinity;
    let worstVal = Infinity;

    for (let i = 0; i < 7; i++) {
        const dow = DOW_FOR_INDEX[i];
        const row = byDow.get(dow);
        if (!row) continue;

        const avg = Number.isFinite(row.avg_mood) ? row.avg_mood : 0;
        const count = Number.isFinite(row.entry_count) ? row.entry_count : 0;
        avgMood[i] = avg;
        entryCount[i] = count;
        bestMood[i] = Number.isFinite(row.best_mood) ? row.best_mood : 0;
        worstMood[i] = Number.isFinite(row.worst_mood) ? row.worst_mood : 0;
        totalEntries += count;

        // Best/worst selection only over days meeting the min-entry threshold.
        if (count >= minEntriesPerDay) {
            if (avg > bestVal) {
                bestVal = avg;
                bestIdx = i;
            }
            if (avg < worstVal) {
                worstVal = avg;
                worstIdx = i;
            }
        }
    }

    return {
        labels: [...DAY_LABELS_MON_FIRST],
        avgMood,
        entryCount,
        bestMood,
        worstMood,
        bestDay: bestIdx >= 0 ? DAY_LABELS_MON_FIRST[bestIdx] : '',
        worstDay: worstIdx >= 0 ? DAY_LABELS_MON_FIRST[worstIdx] : '',
        totalEntries,
        hasEnoughData: totalEntries >= MIN_ENTRIES_FOR_SIGNAL,
    };
};
