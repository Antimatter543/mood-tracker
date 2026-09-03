import { SQLiteDatabase } from 'expo-sqlite';
import { DatabaseResult } from '@/components/types';
import { getMediaByEntryIds } from '@/databases/entry-media';
import { deleteMediaFile } from '@/databases/mediaHelpers';
import { withWriteTransaction } from '@/databases/writeTransaction';

/**
 * The recycle bin: everything that operates on SOFT-DELETED entries.
 *
 * Since migration 12 an entry carries a nullable `deleted_at` (UTC ISO instant).
 * NULL = live; stamped = sitting in the bin. `deleteMoodEntry` (entries.ts) only
 * stamps it — no rows and no photo files are destroyed — so restoring is
 * lossless. This module owns the other half:
 *
 *   - `getBinnedEntries` / `getBinCount` — the bin view's reads,
 *   - `restoreMoodEntry`  — clear the stamp,
 *   - `purgeMoodEntry`    — "delete forever" (the pre-migration-12 hard delete),
 *   - `purgeExpiredBinEntries` — the retention sweep run once on app start.
 *
 * The two destructive paths share ONE implementation (`hardDeleteEntries`), so
 * the no-orphans contract (capture the photo paths BEFORE the delete, unlink
 * AFTER commit) can only be written once and can't drift between them.
 *
 * Transaction contract, per databases/CLAUDE.md: writes run through
 * `withWriteTransaction` on the singleton write connection, statements on `txn`
 * only. Reads take no transaction and run on the caller's read connection.
 */

/**
 * How long a binned entry survives before the automatic sweep destroys it.
 * Exported so the UI's "purges in N days" copy and the sweep can never disagree.
 */
export const BIN_RETENTION_DAYS = 30;

const MS_PER_DAY = 86_400_000;

/** One entry as rendered in the bin list. */
export type BinnedEntry = {
  id: number;
  mood: number;
  notes: string | null;
  /** The entry's own UTC ISO instant (when it was logged). */
  date: string;
  /** UTC ISO instant of when it was deleted. Never null for a binned entry. */
  deleted_at: string;
  /** Activity names, for the compact one-line summary on the bin row. */
  activityNames: string[];
};

/**
 * Hard-delete a set of entries and their photo FILES. The pre-migration-12
 * `deleteMoodEntry` body, generalised to N ids.
 *
 * `DELETE FROM entries` cascades to `entry_activities` + `entry_media` ROWS
 * because the write connection has `foreign_keys = ON` (the read connection's FK
 * state is irrelevant — the delete runs on the write connection). CASCADE never
 * touches the files on disk, so the photo paths are captured BEFORE the delete
 * and unlinked AFTER commit — a rollback then can't orphan a still-live row's
 * file. All the deletes share ONE transaction, so a purge is all-or-nothing.
 *
 * Ids are bound as parameters (never spliced), so this is injection-safe even
 * though every caller sources them from our own SELECT.
 */
async function hardDeleteEntries(
  db: SQLiteDatabase,
  entryIds: number[]
): Promise<number> {
  if (!entryIds.length) return 0;

  const media = await getMediaByEntryIds(db, entryIds);
  const filesToUnlink = entryIds.flatMap((id) =>
    (media[id] ?? []).map((p) => p.file_path)
  );

  await withWriteTransaction(async (txn) => {
    for (const id of entryIds) {
      await txn.runAsync('DELETE FROM entries WHERE id = ?', [id]);
    }
  });

  await Promise.all(filesToUnlink.map((fp) => deleteMediaFile(fp)));

  return entryIds.length;
}

/**
 * The entries currently in the bin, most-recently-deleted first.
 *
 * A READ (no transaction, caller's connection). Errors PROPAGATE rather than
 * collapsing to `[]`: the bin panel distinguishes "your bin is empty" from
 * "couldn't load it", and a swallowed error would render the reassuring one over
 * a bin that still holds the user's entries.
 */
export async function getBinnedEntries(
  db: SQLiteDatabase
): Promise<BinnedEntry[]> {
  const rows = await db.getAllAsync<{
    id: number;
    mood: number;
    notes: string | null;
    date: string;
    deleted_at: string;
    activity_names: string | null;
  }>(
    `
      SELECT
        e.id, e.mood, e.notes, e.date, e.deleted_at,
        GROUP_CONCAT(a.name) AS activity_names
      FROM entries e
      LEFT JOIN entry_activities ea ON ea.entry_id = e.id
      LEFT JOIN activities a ON a.id = ea.activity_id
      WHERE e.deleted_at IS NOT NULL
      GROUP BY e.id
      ORDER BY e.deleted_at DESC
    `
  );

  return rows.map((row) => ({
    id: row.id,
    mood: row.mood,
    notes: row.notes,
    date: row.date,
    deleted_at: row.deleted_at,
    // GROUP_CONCAT returns NULL (not '') when every joined row is NULL, i.e. an
    // entry with no activities — so the `?? ''` guard, then drop empty pieces.
    activityNames: (row.activity_names ?? '')
      .split(',')
      .filter((n) => n.length > 0),
  }));
}

/**
 * How many entries are in the bin. Drives the badge on the Timeline's bin
 * button, so it must be cheap: one COUNT over the PARTIAL index migration 12
 * created (`WHERE deleted_at IS NOT NULL`). Returns 0 on error — a badge is
 * decoration and must never break the Timeline.
 */
export async function getBinCount(db: SQLiteDatabase): Promise<number> {
  try {
    const row = await db.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM entries WHERE deleted_at IS NOT NULL'
    );
    return row?.count ?? 0;
  } catch (error) {
    console.error('Error counting binned entries:', error);
    return 0;
  }
}

/**
 * Take an entry back out of the bin: clear `deleted_at`. Because the soft delete
 * destroyed nothing, the entry comes back with its activities and its photos
 * intact — no reconstruction needed.
 *
 * `AND deleted_at IS NOT NULL` keeps it a no-op on an already-live entry (a
 * double-tapped Undo can't "restore" something that was never binned).
 *
 * `_db` is unused: the UPDATE runs on the singleton write connection, not the
 * caller's read handle. The param stays for the uniform CRUD signature.
 */
export async function restoreMoodEntry(
  _db: SQLiteDatabase,
  entryId: number
): Promise<DatabaseResult> {
  try {
    await withWriteTransaction(async (txn) => {
      await txn.runAsync(
        `UPDATE entries SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL`,
        [entryId]
      );
    });
    return { success: true, message: 'Entry restored' };
  } catch (error) {
    console.error('Error restoring entry:', error);
    return { success: false, message: 'Error restoring entry' };
  }
}

/**
 * "Delete forever": destroy ONE entry, its child rows and its photo files. This
 * is the pre-migration-12 `deleteMoodEntry` behaviour, now reachable only from
 * the bin (or the retention sweep) — never from a stray tap on the timeline.
 */
export async function purgeMoodEntry(
  db: SQLiteDatabase,
  entryId: number
): Promise<DatabaseResult> {
  try {
    await hardDeleteEntries(db, [entryId]);
    return { success: true, message: 'Entry permanently deleted' };
  } catch (error) {
    console.error('Error permanently deleting entry:', error);
    return { success: false, message: 'Error permanently deleting entry' };
  }
}

/**
 * The retention sweep: permanently destroy every binned entry deleted more than
 * `olderThanDays` ago. Called once per app start from `initializeDatabase`.
 *
 * Returns the number of entries purged (0 when there is nothing to do, which is
 * the overwhelmingly common case — a fresh install or an untouched bin costs ONE
 * indexed SELECT over the partial index and never opens the write connection).
 *
 * NEVER THROWS. It runs on the app's boot path, where an exception would be a
 * white screen; a failed sweep is retried on the next launch, so swallowing the
 * error is strictly better than failing to start. (Contrast `getBinnedEntries`,
 * which propagates — there the user is looking at a screen that can say so.)
 *
 * The cutoff is computed once in JS and bound as a parameter, and the same
 * predicate is re-applied inside the transaction via the id list, so a concurrent
 * restore between the SELECT and the DELETE can at worst purge an entry the user
 * restored in that same millisecond — not a wider set.
 */
export async function purgeExpiredBinEntries(
  db: SQLiteDatabase,
  olderThanDays: number = BIN_RETENTION_DAYS
): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - olderThanDays * MS_PER_DAY).toISOString();

    const rows = await db.getAllAsync<{ id: number }>(
      'SELECT id FROM entries WHERE deleted_at IS NOT NULL AND deleted_at < ?',
      [cutoff]
    );
    if (rows.length === 0) return 0;

    return await hardDeleteEntries(
      db,
      rows.map((r) => r.id)
    );
  } catch (error) {
    console.error('Error purging expired bin entries:', error);
    return 0;
  }
}
