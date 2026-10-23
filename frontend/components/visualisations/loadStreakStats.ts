import type { SQLiteDatabase } from 'expo-sqlite';
import { ALL_ENTRY_INSTANTS } from './queries';
import { localDateString } from './transforms/dateHelpers';
import { streakStats, type StreakStats } from './transforms/streak';

/**
 * The ONLY way a screen gets a streak: every live entry, one rule (see
 * `streakStats` for the rule). Home, Statistics, Insights and the reminder
 * scheduler all call this, so two screens can't show two different numbers for
 * the same data (issue #7). Takes no window on purpose: any lookback caps the
 * streak.
 *
 * @param today - The caller's local "today" (`localDateString`), so a fetch that
 *                already pinned "now" keeps one consistent day. Defaults to now.
 */
export async function loadStreakStats(
    db: SQLiteDatabase,
    today: string = localDateString(new Date())
): Promise<StreakStats> {
    const rows = await db.getAllAsync<{ date: string }>(ALL_ENTRY_INSTANTS);
    return streakStats(
        rows.map((r) => r.date),
        today
    );
}
