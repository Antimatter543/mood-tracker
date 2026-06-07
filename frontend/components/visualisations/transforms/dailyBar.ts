// dailyBar.ts
//
// Pure transform for DailyMoodBar: averages mood by day-of-week.
//
// Day-of-week convention: SQLite's `strftime('%w', ...)` returns 0=Sunday..6=Saturday.
// We keep that convention here and emit a Sunday-start labels array. The
// existing UI used Sun-first; we preserve that to avoid coupling visual
// changes to this refactor.

export type DailyMoodRow = {
    day_of_week: number;  // 0..6, 0 = Sunday
    avg_mood: number;
    entry_count: number;
};

export type DailyBarChartData = {
    labels: string[];           // length 7
    data: number[];             // length 7, avg mood per day (0 when no entries)
    counts: number[];           // length 7, entry count per day
};

export const DAY_LABELS_SUN_FIRST: readonly string[] =
    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export const DAY_LABELS_MON_FIRST: readonly string[] =
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

// Monday-first display index -> strftime %w value (0=Sun..6=Sat).
const DOW_FOR_MON_FIRST_INDEX = [1, 2, 3, 4, 5, 6, 0];

/**
 * Build the bar-chart shape from per-day aggregates.
 *
 * Days with no rows show as 0 (a real "no data" state — the bar collapses).
 * Out-of-range day_of_week values are ignored.
 *
 * @param rows         per-day aggregates (day_of_week is strftime %w, 0=Sun).
 * @param mondayFirst  when true, emit a Monday-first labels/data/counts ordering
 *                     (to match the heatmap convention on the stats screen).
 *                     Defaults to false, preserving the existing Sun-first
 *                     behaviour for any other caller.
 */
export const buildDailyBarData = (
    rows: DailyMoodRow[],
    mondayFirst: boolean = false
): DailyBarChartData => {
    // Index incoming rows by %w for O(1) lookup.
    const byDow = new Map<number, DailyMoodRow>();
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

    const data = new Array(7).fill(0);
    const counts = new Array(7).fill(0);

    // For each display slot, resolve which %w value sits there.
    const dowForSlot = (slot: number) =>
        mondayFirst ? DOW_FOR_MON_FIRST_INDEX[slot] : slot;

    for (let slot = 0; slot < 7; slot++) {
        const row = byDow.get(dowForSlot(slot));
        if (!row) continue;
        data[slot] = row.avg_mood;
        counts[slot] = row.entry_count;
    }

    return {
        labels: mondayFirst
            ? [...DAY_LABELS_MON_FIRST]
            : [...DAY_LABELS_SUN_FIRST],
        data,
        counts,
    };
};
