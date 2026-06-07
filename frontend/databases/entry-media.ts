import { SQLiteDatabase } from 'expo-sqlite';
import { EntryPhoto } from '@/components/types';
import { deleteMediaFile } from '@/databases/mediaHelpers';

/**
 * CRUD for the `entry_media` table (photo attachments on mood entries).
 *
 * Schema this layer targets (the live V1 table):
 *   entry_media(id, entry_id, file_path, media_type)
 * `media_type` is always written as 'image' for V1. Rows are ordered by `id`
 * (a monotonically increasing AUTOINCREMENT rowid) which equals insertion
 * order — this is why we don't depend on a `created_at` column that the live
 * schema does not yet have.
 *
 * IMPORTANT (no-orphans contract): SQLite ON DELETE CASCADE removes the ROWS
 * when a parent entry is deleted, but never the FILES on disk. Always call
 * `deleteEntryMediaFiles` BEFORE deleting the entry so the paths are still
 * queryable, then let CASCADE drop the rows.
 */

/** Columns selected for an EntryPhoto. media_type defaults to 'image'. */
const PHOTO_COLUMNS = `id, entry_id, file_path, media_type`;

/**
 * Insert one row per file path for `entryId`. `filePaths` must already be
 * stable paths inside MEDIA_DIR (copied via mediaHelpers.copyToMediaDir).
 * No-op for an empty list.
 */
export async function addEntryMedia(
  db: SQLiteDatabase,
  entryId: number,
  filePaths: string[]
): Promise<void> {
  for (const path of filePaths) {
    await db.runAsync(
      `INSERT INTO entry_media (entry_id, file_path, media_type) VALUES (?, ?, 'image')`,
      [entryId, path]
    );
  }
}

/** Fetch all photos for a single entry, in insertion order. */
export async function getEntryMedia(
  db: SQLiteDatabase,
  entryId: number
): Promise<EntryPhoto[]> {
  return db.getAllAsync<EntryPhoto>(
    `SELECT ${PHOTO_COLUMNS} FROM entry_media WHERE entry_id = ? ORDER BY id ASC`,
    [entryId]
  );
}

/**
 * Batch-fetch photos for many entries in a single query, returned as a map of
 * entryId -> photos[]. Avoids the N+1 pattern when hydrating a page of entries.
 * Empty input returns an empty map without touching the DB.
 */
export async function getMediaByEntryIds(
  db: SQLiteDatabase,
  entryIds: number[]
): Promise<Record<number, EntryPhoto[]>> {
  const byEntry: Record<number, EntryPhoto[]> = {};
  if (!entryIds.length) return byEntry;

  // Defensive: only splice real integers into the IN-list (same argument as
  // filterValidActivityIds — keeps the query injection-safe).
  const safeIds = entryIds.filter((n) => Number.isInteger(n));
  if (!safeIds.length) return byEntry;

  const rows = await db.getAllAsync<EntryPhoto>(
    `SELECT ${PHOTO_COLUMNS} FROM entry_media
       WHERE entry_id IN (${safeIds.join(',')})
       ORDER BY entry_id, id ASC`
  );
  for (const row of rows) {
    (byEntry[row.entry_id] ??= []).push(row);
  }
  return byEntry;
}

/**
 * Delete the FILES on disk for an entry's photos. Call this BEFORE deleting
 * the entry (or before clearing the rows), while the paths are still
 * queryable. Does NOT delete the DB rows — CASCADE (or an explicit DELETE)
 * handles those. Best-effort: a failed file unlink never throws.
 */
export async function deleteEntryMediaFiles(
  db: SQLiteDatabase,
  entryId: number
): Promise<void> {
  const photos = await getEntryMedia(db, entryId);
  await Promise.all(photos.map((p) => deleteMediaFile(p.file_path)));
}
