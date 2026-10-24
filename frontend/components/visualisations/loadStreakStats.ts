import type { SQLiteDatabase } from 'expo-sqlite';
import { ALL_ENTRY_INSTANTS } from './queries';
import { streakStats, type StreakStats } from './transforms/streak';

/**
 * The ONLY way a screen gets the user's streak: every live entry, one rule (see
 * `streakStats` for the rule). Home, Statistics, Insights and the reminder
 * scheduler all call this, so two screens can't show two different numbers for
 * the same data (issue #7: Home/Statistics fed the transform a 60-day window and
 * said 61 while Insights, reading all-time, said 90). Takes no window on purpose:
 * any lookback caps the streak.
 *
 * @param today - The caller's local "today" (`localDateString`), so a fetch that
 *                already pinned "now" keeps one consistent day.
 */
export async function loadStreakStats(
    db: SQLiteDatabase,
    today: string
): Promise<StreakStats> {
    const rows = await db.getAllAsync<{ date: string }>(ALL_ENTRY_INSTANTS);
    return streakStats(
        rows.map((r) => r.date),
        today
    );
}
