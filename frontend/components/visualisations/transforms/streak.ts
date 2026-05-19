// streak.ts
//
// Pure JS streak computation. REPLACES the recursive-CTE
// `GET_CURRENT_STREAK` SQL, which was:
//   1. Timezone-broken (used SQLite's UTC `date('now')`).
//   2. Hard to test.
//   3. Subtly wrong: it counted entries up-to-and-including any day, even
//      with gaps before the "current" anchor.
//
// The contract: given a sorted list of entry-date strings ("YYYY-MM-DD") and
// "today" (local-date string), the current streak is the count of consecutive
// days ending at today (or yesterday, if you allow a one-day grace) that have
// at least one entry. We require today OR yesterday to anchor the streak —
// otherwise the streak is 0.

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
