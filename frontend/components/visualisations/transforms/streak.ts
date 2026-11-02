// streak.ts
//
// THE streak authority. Every streak number the app shows (Home, Statistics,
// Insights, the reminder copy) comes from `streakStats` below. The user's streak
// is fed ALL live entries via `loadStreakStats` (../loadStreakStats.ts);
// Statistics' past-period "Best streak" feeds it that period's own entries.
// Pure JS; REPLACES the recursive-CTE `GET_CURRENT_STREAK` SQL, which was:
//   1. Timezone-broken (used SQLite's UTC `date('now')`).
//   2. Hard to test.
//   3. Subtly wrong: it counted entries up-to-and-including any day, even
//      with gaps before the "current" anchor.
//
// THE RULE (issue #7):
//   - A "day" is a LOCAL calendar day (`localDateString`), never a UTC or SQL
//     `date()` day.
//   - Any number of entries on one day count as one day.
//   - current: consecutive days with an entry, ending TODAY, or ending
//     YESTERDAY if today has no entry yet (the streak must not break in the
//     morning before the user logs). Neither today nor yesterday -> 0.
//   - longest: the longest run of consecutive days anywhere in the history.
//   - A missing day breaks a run; nothing bridges a gap.
//   - The user's history is EVERY live entry: a lookback window silently caps
//     the number.

import { addDays, localDateString } from './dateHelpers';

/**
 * Compute the current streak from a list of entry-date strings.
 *
 * @param entryDates - Array of local-date strings ("YYYY-MM-DD"); duplicates
 *                     and unsorted input are allowed.
 * @param today - Today's local-date string. Defaults to local today.
 * @returns Number of consecutive days (ending today or yesterday) with at
 *          least one entry.
 *
 * @example
 *   currentStreak(['2025-06-13','2025-06-14','2025-06-15'], '2025-06-15') === 3
 *   currentStreak(['2025-06-10','2025-06-15'], '2025-06-15') === 1
 *   currentStreak([], '2025-06-15') === 0
 */
export const currentStreak = (
    entryDates: string[],
    today: string = localDateString(new Date())
): number => {
    if (entryDates.length === 0) return 0;

    const days = new Set(entryDates);

    // Anchor: today if there's an entry today, otherwise yesterday (grace day).
    // If neither has an entry, streak is 0.
    let cursor: string;
    if (days.has(today)) {
        cursor = today;
    } else {
        const yesterday = addDays(today, -1);
        if (days.has(yesterday)) {
            cursor = yesterday;
        } else {
            return 0;
        }
    }

    let count = 0;
    while (days.has(cursor)) {
        count++;
        cursor = addDays(cursor, -1);
    }
    return count;
};

/**
 * Longest historical streak found anywhere in the dataset.
 * Useful for the "best streak" stat.
 */
export const longestStreak = (entryDates: string[]): number => {
    if (entryDates.length === 0) return 0;
    const unique = Array.from(new Set(entryDates)).sort();
    let best = 1;
    let current = 1;
    for (let i = 1; i < unique.length; i++) {
        if (addDays(unique[i - 1], 1) === unique[i]) {
            current++;
            best = Math.max(best, current);
        } else {
            current = 1;
        }
    }
    return best;
};

export interface StreakStats {
    /** Consecutive local days with an entry, ending today (or yesterday if today isn't logged yet). */
    current: number;
    /** Longest run of consecutive local days with an entry, anywhere in the history. */
    longest: number;
    /** Distinct LOCAL days ("YYYY-MM-DD") that have at least one entry, ascending. */
    days: string[];
}

/**
 * The one streak computation, from the raw stored entry instants (UTC ISO
 * strings, straight off `entries.date`). Keys each instant to its LOCAL day
 * and applies the rule in the header, so a caller can't key days differently
 * or hand `currentStreak` a different slice of history than another screen.
 *
 * Unparseable instants are skipped rather than thrown on (degenerate input
 * must never blank a screen), the same guard the other transforms use.
 *
 * @param entryInstants - Stored instants to count; duplicates, any order. The
 *                        user's streak passes every live entry (see
 *                        `loadStreakStats`).
 * @param today - Today's local-date string. Defaults to local today.
 */
export const streakStats = (
    entryInstants: readonly string[],
    today: string = localDateString(new Date())
): StreakStats => {
    const distinct = new Set<string>();
    for (const instant of entryInstants) {
        const when = new Date(instant);
        if (!isNaN(when.getTime())) distinct.add(localDateString(when));
    }
    const days = Array.from(distinct).sort();
    return {
        current: currentStreak(days, today),
        longest: longestStreak(days),
        days,
    };
};
