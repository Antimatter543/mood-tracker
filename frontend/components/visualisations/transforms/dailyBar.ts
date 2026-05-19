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

/**
 * Build the bar-chart shape from per-day aggregates.
 *
 * Days with no rows show as 0 (a real "no data" state — the bar collapses).
 * Out-of-range day_of_week values are ignored.
 */
export const buildDailyBarData = (rows: DailyMoodRow[]): DailyBarChartData => {
    const data = new Array(7).fill(0);
    const counts = new Array(7).fill(0);

    for (const row of rows) {
        if (
            typeof row.day_of_week !== 'number' ||
            row.day_of_week < 0 ||
            row.day_of_week > 6
        ) {
            continue;
        }
        data[row.day_of_week] = row.avg_mood;
        counts[row.day_of_week] = row.entry_count;
    }

    return {
        labels: [...DAY_LABELS_SUN_FIRST],
        data,
        counts,
    };
};
