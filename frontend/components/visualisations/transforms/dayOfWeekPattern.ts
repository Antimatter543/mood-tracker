// dayOfWeekPattern.ts
//
// Pure transform: average mood per day-of-week, timeframe-scoped, with
// best/worst-day callouts. Replaces the all-time dailyBar logic FOR THE STATS
// SCREEN (the original buildDailyBarData stays for any other caller).
//
// Day-of-week convention from the SQL: strftime('%w') returns 0=Sun..6=Sat.
// This transform re-orders to a Monday-first labels array to match the heatmap
// convention used elsewhere on the stats screen.

export type DowRow = {
    day_of_week: number; // 0=Sun..6=Sat (strftime %w)
    avg_mood: number;
    entry_count: number;
    best_mood: number; // MAX(mood) for that DOW
    worst_mood: number; // MIN(mood)
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
