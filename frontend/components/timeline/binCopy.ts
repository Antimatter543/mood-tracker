/**
 * Pure copy helpers for the recycle bin ("Recently deleted").
 *
 * React/SQLite-free so the wording and the arithmetic can be exhaustively
 * jest-tested without rendering anything. The panel imports these; nothing here
 * imports the panel.
 *
 * TIME MODEL — elapsed, not calendar. `deleted_at` is a UTC ISO instant and the
 * retention sweep (`purgeExpiredBinEntries`) compares instants, so the countdown
 * shown to the user has to be computed the SAME way: whole 24h periods elapsed,
 * NOT local calendar days. Keying this off `localDateString` would drift out of
 * step with the sweep (an entry deleted at 23:50 would read "1 day ago" ten
 * minutes later while the sweep still counts it as 0).
 */

const MS_PER_DAY = 86_400_000;

/**
 * Whole 24h periods elapsed since `deletedAt`, floored, never negative.
 *
 * Returns `null` for an unparseable instant so callers can fall back to vague
 * copy rather than rendering "NaN days ago". Clamped at 0 because a device clock
 * that moved backwards (or a restored backup from a device an hour ahead) can
 * legitimately produce a `deleted_at` in the future — "in -1 days" is nonsense,
 * "today" is not.
 */
export function daysSinceDeleted(deletedAt: string, now: Date): number | null {
  const t = Date.parse(deletedAt);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / MS_PER_DAY));
}

/**
 * Whole days left before the retention sweep destroys this entry, floored at 0
 * (0 = "it goes on the next app start"). `null` for an unparseable instant.
 */
export function daysUntilPurge(
  deletedAt: string,
  now: Date,
  retentionDays: number
): number | null {
  const elapsed = daysSinceDeleted(deletedAt, now);
  if (elapsed === null) return null;
  return Math.max(0, retentionDays - elapsed);
}

/** "Deleted today" / "Deleted yesterday" / "Deleted 6 days ago". */
export function describeDeletedAge(deletedAt: string, now: Date): string {
  const elapsed = daysSinceDeleted(deletedAt, now);
  if (elapsed === null) return 'Deleted recently';
  if (elapsed === 0) return 'Deleted today';
  if (elapsed === 1) return 'Deleted yesterday';
  return `Deleted ${elapsed} days ago`;
}

/** "30 days left" / "1 day left" / "Deletes on next open". */
export function describePurgeCountdown(
  deletedAt: string,
  now: Date,
  retentionDays: number
): string | null {
  const left = daysUntilPurge(deletedAt, now, retentionDays);
  if (left === null) return null;
  if (left === 0) return 'Deletes on next open';
  if (left === 1) return '1 day left';
  return `${left} days left`;
}

/**
 * The single line under a bin row: "Deleted 3 days ago · 27 days left".
 * Falls back to the age alone when the countdown can't be computed.
 */
export function describeBinRow(
  deletedAt: string,
  now: Date,
  retentionDays: number
): string {
  const age = describeDeletedAge(deletedAt, now);
  const countdown = describePurgeCountdown(deletedAt, now, retentionDays);
  return countdown ? `${age} · ${countdown}` : age;
}
