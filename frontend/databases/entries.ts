import { SQLiteDatabase } from 'expo-sqlite';
import { Activity, DatabaseResult, MoodEntry } from '@/components/types';
import { getDefaultEntryDate } from '@/databases/dateHelpers';
import {
  addEntryMedia,
  getEntryMedia,
  getMediaByEntryIds,
} from '@/databases/entry-media';
import { MEDIA_DIR, copyToMediaDir, deleteMediaFile } from '@/databases/mediaHelpers';
import { withWriteTransaction } from '@/databases/writeTransaction';
import { buildEntryFilter, EntryFilters } from '@/components/timeline/entryFilter';

/**
 * CRUD for mood entries.
 *
 * Storage contract: `entries.date` is stored as a UTC ISO-8601 string (see
 * `dateHelpers.ts`). Callers that want to query by user-local day must use
 * `startOfLocalDay` / `endOfLocalDay` to compute the UTC range — do NOT
 * use SQLite's `date('now')` or `date(entries.date)`, which assume UTC.
 *
 * Transaction contract: every multi-statement WRITE goes through
 * `withWriteTransaction` (databases/writeTransaction.ts) — a real transaction on
 * the singleton write connection, statements on the `txn` argument only. READS
 * (`getMoodEntries`, `getEntriesPage`) take no transaction and run on the caller-
 * supplied connection (the SQLiteProvider's read connection).
 */

/**
 * Filter `activityIds` down to those that actually exist in the database.
 *
 * Defensively re-validates that every input is an integer before splicing
 * it into the IN-clause. Callers' types already promise `number[]`, but
 * `filter(Number.isInteger)` makes the SQL-injection-safety argument
 * self-evident even if some upstream cast slips a string through.
 */
export async function filterValidActivityIds(
  db: SQLiteDatabase,
  activityIds: number[]
): Promise<number[]> {
  if (!activityIds.length) return [];

  // Defensive: even though the caller's type is `number[]`, JS doesn't
  // enforce that at runtime. Drop anything that isn't a real integer so
  // the IN-list below can't get SQL-injected.
  const safeIds = activityIds.filter((n) => Number.isInteger(n));
  if (!safeIds.length) return [];

  try {
    const idList = safeIds.join(',');
    const existingActivities = await db.getAllAsync<{ id: number }>(
      `SELECT id FROM activities WHERE id IN (${idList})`
    );
    return existingActivities.map((activity) => activity.id);
  } catch (error) {
    console.error('Error filtering activity IDs:', error);
    return [];
  }
}

/**
 * Insert a mood entry plus its activity links in a single transaction.
 *
 * Validation rules:
 * - mood must be a number in [0, 10] (NaN rejected)
 * - activityIds are filtered against the activities table *inside* the
 *   same transaction, so a concurrent delete can't let a stale ID slip
 *   through (the previous implementation did this outside the txn).
 * - If some activities became invalid mid-call, we still succeed and just
 *   warn — losing the link is preferable to losing the entry.
 *
 * `photos` is an optional trailing arg of *source* URIs (from the image
 * picker). Each is copied into the persistent MEDIA_DIR *before* the
 * transaction (file IO inside a SQLite transaction would hold the write lock
 * for the whole copy), then a row per stable path is inserted alongside the
 * entry. Backward-compatible: existing callers that omit `photos` are
 * unaffected.
 *
 * `_db` is intentionally unused: statements run on the singleton write
 * connection (`withWriteTransaction`), not the caller's read handle. The param
 * stays for the uniform CRUD signature (siblings like `updateMoodEntry` DO use
 * it for pre-transaction reads).
 */
export async function addMoodEntry(
  _db: SQLiteDatabase,
  mood: number,
  activityIds: number[],
  notes: string,
  date?: string,
  photos?: string[]
): Promise<DatabaseResult> {
  try {
    if (isNaN(mood) || mood < 0 || mood > 10) {
      return {
        success: false,
        message: 'Please enter a valid mood score between 0 and 10',
      };
    }

    const entryDate = date || getDefaultEntryDate();

    // Copy source photos into the persistent media dir BEFORE opening the
    // transaction — file copies are slow and must not block the DB write lock.
    // These files are orphaned only if the transaction below throws (rare);
    // the form's cancel path handles the much more common cancel-orphan case.
    const photoPaths: string[] = [];
    if (photos?.length) {
      for (const sourceUri of photos) {
        photoPaths.push(await copyToMediaDir(sourceUri));
      }
    }

    // Real write transaction on the singleton write connection: statements run
    // on `txn`, never on the read `db`. This is the fix for the incident where
    // every write used expo's `withExclusiveTransactionAsync` but ran its
    // statements on the MAIN connection (ignoring the `txn` callback arg), so
    // BEGIN/COMMIT wrapped nothing and the multi-table insert had no atomicity
    // (an entry could persist without its activities on a mid-write failure).
    // See databases/writeTransaction.ts for the full incident write-up.
    await withWriteTransaction(async (txn) => {
      // Filter inside the transaction so concurrent activity deletes can't
      // produce dangling FK references.
      const validActivityIds = await filterValidActivityIds(txn, activityIds);

      if (validActivityIds.length !== activityIds.length) {
        console.warn(
          `Some activities (${activityIds.length - validActivityIds.length}) were skipped because they no longer exist.`
        );
      }

      const result = await txn.runAsync(
        `INSERT INTO entries (mood, notes, date) VALUES (?, ?, ?);`,
        [mood, notes, entryDate]
      );

      const entryId = result.lastInsertRowId;

      for (const activityId of validActivityIds) {
        await txn.runAsync(
          `INSERT INTO entry_activities (entry_id, activity_id) VALUES (?, ?);`,
          [entryId, activityId]
        );
      }

      await addEntryMedia(txn, entryId, photoPaths);
    });

    return {
      success: true,
      message: 'Entry added successfully!',
    };
  } catch (error) {
    console.error('Error adding mood:', error);
    return {
      success: false,
      message: 'Error adding entry',
    };
  }
}

/**
 * Fetch every mood entry with its activity list, newest first.
 *
 * Returns an empty array on DB error rather than throwing — callers
 * generally render lists and an empty list is a reasonable failure mode.
 */
export async function getMoodEntries(db: SQLiteDatabase): Promise<MoodEntry[]> {
  try {
    // NO transaction here — this is a READ. Wrapping the SELECT + the per-entry
    // Promise.all of sub-reads in withExclusiveTransactionAsync held the shared
    // connection's EXCLUSIVE lock for the entire walk: with ~255 entries that's
    // ~510 serialized queries, a ~3.2s main-thread block (Choreographer "Skipped
    // ~191 frames!") during which Timeline could blank under a rapid tab burst —
    // and a read-side BEGIN is itself a collision vector. A consistent snapshot
    // isn't needed for a timeline list (the focus-driven refresh re-reads anyway),
    // and plain awaited queries serialize on the single connection fine. WRITES
    // run in real transactions on the write connection (withWriteTransaction) —
    // under WAL these reads never block on (or corrupt under) a concurrent write.
    const rawEntries = await db.getAllAsync<Omit<MoodEntry, 'activities' | 'photos'>>(
      'SELECT * FROM entries ORDER BY date DESC'
    );

    const entriesWithActivities = await Promise.all(
      rawEntries.map(async (entry) => {
        const activities = await db.getAllAsync<Activity>(
          `
            SELECT a.id, a.name, a.group_id, a.icon_name
            FROM activities a
            JOIN entry_activities ea ON ea.activity_id = a.id
            WHERE ea.entry_id = ?
            ORDER BY a.group_id, a.name
          `,
          [entry.id]
        );

        const photos = await getEntryMedia(db, entry.id);

        return {
          ...entry,
          activities,
          photos,
        };
      })
    );

    return entriesWithActivities;
  } catch (error) {
    console.error('Error fetching mood entries:', error);
    return [];
  }
}

/**
 * The RAW UTC instant of the earliest mood entry (`MIN(date)`), or `null` when
 * the DB has no entries yet. Used to anchor the Health Connect historical
 * backfill window to the start of the user's mood history.
 *
 * Returning the raw stored instant is doctrine-compliant: SQL only range-filters
 * or returns the raw `date`; it never day-buckets (no `date()`/`strftime()`).
 * `MIN(date)` over an empty table returns one row whose value is `NULL`, so an
 * empty DB yields `null` and never throws. Does NOT swallow errors — the caller
 * (syncHealthMetrics) treats a read failure as a sync failure.
 */
export async function getEarliestEntryInstant(
  db: SQLiteDatabase
): Promise<string | null> {
  const row = await db.getFirstAsync<{ earliest: string | null }>(
    'SELECT MIN(date) AS earliest FROM entries'
  );
  return row?.earliest ?? null;
}

/**
 * Read ONE page of entries for the Timeline, applying the search / mood filter
 * in SQL (the list is server-paginated, so a client-side filter would only see
 * the ~pageSize rows currently loaded — see components/timeline/entryFilter.ts).
 *
 * A READ: no transaction, runs on the caller's connection (the SQLiteProvider's
 * read connection). Unlike the old inline `DBViewer.fetchEntriesPage`, this
 * DELIBERATELY does NOT catch-and-return-[] on error: a transient read failure
 * that returns [] blanks the Timeline into the "add your first entry" empty
 * state over a full DB. Errors PROPAGATE so the component can show a real
 * "couldn't load" state with a retry (see DBViewer.loadInitialData).
 *
 * INVARIANT: the CTE here is mirrored by __tests__/entryFilter.integration.test.ts
 * (same FROM/JOINs, the `${where && 'WHERE '+where}` splice BEFORE GROUP BY, and
 * the `[...params, LIMIT, OFFSET]` bind order). If this query changes, update it.
 */
export async function getEntriesPage(
  db: SQLiteDatabase,
  filters: EntryFilters,
  page: number,
  pageSize: number
): Promise<MoodEntry[]> {
  const offset = page * pageSize;
  // The WHERE is spliced BEFORE `GROUP BY e.id` so it filters raw rows; its
  // EXISTS subquery uses `ea2`/`a2` aliases distinct from the outer `ea`/`a`.
  const { where, params } = buildEntryFilter(filters);
  const rows = await db.getAllAsync<any>(
    `
      WITH EntryData AS (
          SELECT
              e.id, e.mood, e.notes, e.date,
              GROUP_CONCAT(a.id) as activity_ids,
              GROUP_CONCAT(a.name) as activity_names,
              GROUP_CONCAT(a.group_id) as activity_group_ids,
              GROUP_CONCAT(a.icon_name) as activity_icon_names,
              GROUP_CONCAT(a.icon_family) as activity_icon_families
          FROM entries e
          LEFT JOIN entry_activities ea ON e.id = ea.entry_id
          LEFT JOIN activities a ON ea.activity_id = a.id
          ${where ? 'WHERE ' + where : ''}
          GROUP BY e.id
          ORDER BY e.date DESC
          LIMIT ? OFFSET ?
      )
      SELECT * FROM EntryData
    `,
    [...params, pageSize, offset]
  );

  const baseEntries: MoodEntry[] = rows.map((row) => {
    // Each GROUP_CONCAT(...) is a comma-joined string with one value per joined
    // activity, all emitted in the SAME order, so index `i` lines up across all
    // of them. icon_family is a closed enum (never contains a comma); a
    // missing/blank family falls back to 'Feather' (the column default).
    const iconFamilies = row.activity_icon_families
      ? row.activity_icon_families.split(',')
      : [];
    return {
      id: row.id,
      mood: row.mood,
      notes: row.notes,
      date: row.date,
      activities: row.activity_ids
        ? row.activity_ids.split(',').map((id: string, index: number) => ({
            id: parseInt(id),
            name: row.activity_names.split(',')[index],
            group_id: parseInt(row.activity_group_ids.split(',')[index]),
            icon_name: row.activity_icon_names.split(',')[index],
            icon_family: iconFamilies[index] || 'Feather',
          }))
        : [],
      photos: [],
    };
  });

  // Batch-load photos for the whole page in one query (avoids the N+1 that
  // joining entry_media into the big query + re-splitting would create).
  const mediaByEntry = await getMediaByEntryIds(
    db,
    baseEntries.map((e) => e.id)
  );
  for (const entry of baseEntries) {
    entry.photos = mediaByEntry[entry.id] ?? [];
  }

  return baseEntries;
}

/** The fields an edit form supplies to {@link updateMoodEntry}. */
export type MoodEntryUpdate = {
  mood: number;
  activities: number[];
  notes: string;
  /** The entry's timestamp; stored as UTC ISO via `.toISOString()`. */
  date: Date;
  /**
   * The draft's photos: a mix of already-persisted MEDIA_DIR paths (kept) and
   * freshly-picked source URIs (copied in). Paths NOT under MEDIA_DIR are the
   * new ones; existing DB photos absent from this list are removed.
   */
  photos: string[];
};

/**
 * Update an entry's mood/notes/date, its activity links, and its photos in one
 * write transaction. Absorbs the SQL + photo-diff/media-file logic that used to
 * live inline in `DBViewer.handleUpdate` so the component stays SQL-free.
 *
 * File IO stays OUTSIDE the transaction: new photos are copied into MEDIA_DIR
 * BEFORE the txn (a copy must not hold the write lock; orphaned only if the txn
 * throws), and removed photos are unlinked AFTER commit (so a rollback can't
 * leave a missing file pointed at by a still-live row). `db` is used for the
 * pre-transaction read of the entry's current photos.
 */
export async function updateMoodEntry(
  db: SQLiteDatabase,
  entryId: number,
  update: MoodEntryUpdate
): Promise<DatabaseResult> {
  try {
    // Photo diff, computed against the entry's current DB photos. Photos already
    // under MEDIA_DIR are kept; any path NOT under MEDIA_DIR is a new source URI.
    const dbPhotos = (await getMediaByEntryIds(db, [entryId]))[entryId] ?? [];
    const draftPaths = new Set(update.photos);
    const removedPhotos = dbPhotos.filter((p) => !draftPaths.has(p.file_path));
    const addedSourceUris = update.photos.filter((p) => !p.startsWith(MEDIA_DIR));

    // Copy newly-picked photos into MEDIA_DIR BEFORE the transaction.
    const addedPaths: string[] = [];
    for (const uri of addedSourceUris) {
      addedPaths.push(await copyToMediaDir(uri));
    }

    await withWriteTransaction(async (txn) => {
      await txn.runAsync(
        `UPDATE entries SET mood = ?, notes = ?, date = ? WHERE id = ?`,
        [update.mood, update.notes, update.date.toISOString(), entryId]
      );

      await txn.runAsync('DELETE FROM entry_activities WHERE entry_id = ?', [entryId]);
      for (const activityId of update.activities) {
        await txn.runAsync(
          'INSERT INTO entry_activities (entry_id, activity_id) VALUES (?, ?)',
          [entryId, activityId]
        );
      }

      for (const photo of removedPhotos) {
        await txn.runAsync('DELETE FROM entry_media WHERE id = ?', [photo.id]);
      }
      for (const path of addedPaths) {
        await txn.runAsync(
          `INSERT INTO entry_media (entry_id, file_path, media_type) VALUES (?, ?, 'image')`,
          [entryId, path]
        );
      }
    });

    // Unlink removed files only after the rows are gone (and committed).
    // Best-effort: a failed unlink never fails the update.
    await Promise.all(removedPhotos.map((p) => deleteMediaFile(p.file_path)));

    return { success: true, message: 'Entry updated successfully' };
  } catch (error) {
    console.error('Error updating entry:', error);
    return { success: false, message: 'Error updating entry' };
  }
}

/**
 * Delete an entry and everything that hangs off it. The `DELETE FROM entries`
 * cascades to `entry_activities` + `entry_media` ROWS because the write
 * connection has `foreign_keys = ON` (the read connection's FK state is
 * irrelevant here — the delete runs on the write connection). CASCADE never
 * touches the files on disk, so we capture the photo paths BEFORE the delete and
 * unlink them AFTER commit (so a rollback can't orphan a live row's file).
 */
export async function deleteMoodEntry(
  db: SQLiteDatabase,
  entryId: number
): Promise<DatabaseResult> {
  try {
    const media = await getMediaByEntryIds(db, [entryId]);
    const filesToUnlink = (media[entryId] ?? []).map((p) => p.file_path);

    await withWriteTransaction(async (txn) => {
      await txn.runAsync('DELETE FROM entries WHERE id = ?', [entryId]);
    });

    await Promise.all(filesToUnlink.map((fp) => deleteMediaFile(fp)));

    return { success: true, message: 'Entry deleted successfully' };
  } catch (error) {
    console.error('Error deleting entry:', error);
    return { success: false, message: 'Error deleting entry' };
  }
}
