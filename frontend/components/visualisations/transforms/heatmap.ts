// heatmap.ts
//
// Pure transform for the GitHub-style mood heatmap. Builds a grid of cells
// (one per day), positioned by week-column and day-row.
//
// CONVENTION: Monday-start weeks (`Mon..Sun`), matching the existing visual.
//   day index 0 = Monday, 6 = Sunday.
// Documented here because the SQL elsewhere uses `strftime('%w')` (Sun=0); the
// heatmap is *not* on that path — its grid is fully derived in JS from the
// date string, so it can pick its own week convention safely.

export type HeatmapInput = {
    date: string;            // "YYYY-MM-DD"
    mood: number | null;
};

export type HeatmapCell = {
    date: string;
    dayOfMonth: number;
    mood: number | null;
    /** Column (week) index, 0-based. */
    weekIndex: number;
    /** Row (day-of-week) index: 0 = Monday, 6 = Sunday. */
    dayIndex: number;
};

export type MonthLabel = {
    month: string;       // "Jan", "Feb", ...
    weekIndex: number;
};

export type HeatmapGrid = {
    cells: HeatmapCell[];
    monthLabels: MonthLabel[];
    totalWeeks: number;
};

/**
 * Index 0 = Monday, ..., 6 = Sunday. Derived from a "YYYY-MM-DD" string via
 * its day-of-week (UTC parse → Date.getUTCDay()), so this is stable across
 * timezones.
 */
const mondayStartDayIndex = (dateStr: string): number => {
    const d = new Date(`${dateStr}T00:00:00Z`);
    const jsDay = d.getUTCDay(); // 0=Sun..6=Sat
    return jsDay === 0 ? 6 : jsDay - 1;
};

/** Add days to a YYYY-MM-DD string (returns YYYY-MM-DD). UTC-based. */
const addDaysUTC = (dateStr: string, days: number): string => {
    const d = new Date(`${dateStr}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
};

/** Days between two YYYY-MM-DD strings, UTC-anchored — DST-safe. */
const daysBetweenUTC = (a: string, b: string): number => {
    const da = new Date(`${a}T00:00:00Z`).getTime();
    const db = new Date(`${b}T00:00:00Z`).getTime();
    return Math.round((db - da) / (24 * 60 * 60 * 1000));
};

/**
 * Build the heatmap grid from a sorted list of `(date, mood)` rows.
 * Grid spans from the Monday on/before the earliest date through the Sunday
 * on/after the latest date, so every cell falls on an integer week column.
 *
 * Empty input -> empty grid (caller renders nothing).
 *
 * Degenerate input (null/garbage dates) is also dropped: a single SQL row with
 * `date: null` (what the heatmap query returns when the entries table is empty)
 * would otherwise reach `new Date("nullT00:00:00Z")` and throw
 * `RangeError: Date value out of bounds`, white-screening the Stats screen.
 * This pure transform must never throw on degenerate input.
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const buildHeatmapGrid = (rows: HeatmapInput[]): HeatmapGrid => {
    // Drop any row whose date isn't a valid YYYY-MM-DD string before doing any
    // date math. Guards against null / undefined / garbage reaching `new Date`.
    const validRows = (rows ?? []).filter(
        (r) => r && typeof r.date === 'string' && ISO_DATE.test(r.date),
    );
    if (validRows.length === 0) {
        return { cells: [], monthLabels: [], totalWeeks: 0 };
    }

    const moodByDate = new Map<string, number | null>();
    for (const r of validRows) moodByDate.set(r.date, r.mood);

    const earliest = validRows[0].date;
    const latest = validRows[validRows.length - 1].date;

    // Snap earliest back to its Monday (or itself if already Monday).
    const startOffset = mondayStartDayIndex(earliest);
    const gridStart = addDaysUTC(earliest, -startOffset);

    const totalDays = daysBetweenUTC(gridStart, latest) + 1;
    const totalWeeks = Math.ceil(totalDays / 7);

    const cells: HeatmapCell[] = [];
    const monthLabels: MonthLabel[] = [];
    const seenMonths = new Set<string>();

    for (let week = 0; week < totalWeeks; week++) {
        for (let day = 0; day < 7; day++) {
            const dateStr = addDaysUTC(gridStart, week * 7 + day);
            const d = new Date(`${dateStr}T00:00:00Z`);
            const dayOfMonth = d.getUTCDate();

            cells.push({
                date: dateStr,
                dayOfMonth,
                mood: moodByDate.has(dateStr)
                    ? (moodByDate.get(dateStr) ?? null)
                    : null,
                weekIndex: week,
                dayIndex: day,
            });

            // First Monday of each new month → label
            if (day === 0) {
                const monthKey = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
                if (!seenMonths.has(monthKey)) {
                    seenMonths.add(monthKey);
                    const month = d.toLocaleDateString('en-US', {
                        month: 'short',
                        timeZone: 'UTC',
                    });
                    monthLabels.push({ month, weekIndex: week });
                }
            }
        }
    }

    return { cells, monthLabels, totalWeeks };
};
