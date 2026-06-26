import { SQLiteDatabase } from 'expo-sqlite';
import { Activity, DatabaseResult, MoodEntry } from '@/components/types';
import { getDefaultEntryDate } from '@/databases/dateHelpers';
import { addEntryMedia, getEntryMedia } from '@/databases/entry-media';
import { copyToMediaDir } from '@/databases/mediaHelpers';

/**
 * CRUD for mood entries.
 *
 * Storage contract: `entries.date` is stored as a UTC ISO-8601 string (see
 * `dateHelpers.ts`). Callers that want to query by user-local day must use
 * `startOfLocalDay` / `endOfLocalDay` to compute the UTC range — do NOT
 * use SQLite's `date('now')` or `date(entries.date)`, which assume UTC.
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
 */
export async function addMoodEntry(
  db: SQLiteDatabase,
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

    // EXCLUSIVE transaction (not the non-exclusive `withTransactionAsync`):
    // `withTransactionAsync` does NOT take an exclusive lock — per the
    // expo-sqlite docs, "any query that runs while the transaction is active
    // will be included in the transaction, including statements outside the
    // scope function." On our single shared connection, the focus-driven Home
    // refresh fires ~6 concurrent reads; a non-exclusive write here could
    // interleave with them and leave the connection in a bad in-memory state
    // (reads come back empty → Home cards revert to their empty state until
    // the app is reopened). The exclusive lock serializes the connection for
    // the callback duration. Same drop-in shape as lifecycle.ts resetDatabase.
    await db.withExclusiveTransactionAsync(async () => {
      // Filter inside the transaction so concurrent activity deletes can't
      // produce dangling FK references.
      const validActivityIds = await filterValidActivityIds(db, activityIds);

      if (validActivityIds.length !== activityIds.length) {
        console.warn(
          `Some activities (${activityIds.length - validActivityIds.length}) were skipped because they no longer exist.`
        );
      }

      const result = await db.runAsync(
        `INSERT INTO entries (mood, notes, date) VALUES (?, ?, ?);`,
        [mood, notes, entryDate]
      );

      const entryId = result.lastInsertRowId;

      for (const activityId of validActivityIds) {
        await db.runAsync(
          `INSERT INTO entry_activities (entry_id, activity_id) VALUES (?, ?);`,
          [entryId, activityId]
        );
      }

      await addEntryMedia(db, entryId, photoPaths);
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
    // stay EXCLUSIVE (addMoodEntry etc.) — that's the actual Home-blank fix.
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
