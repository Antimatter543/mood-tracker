import { SQLiteDatabase } from 'expo-sqlite';
// Classic function API, as in mediaHelpers.ts (see the note there).
import * as FileSystem from 'expo-file-system/legacy';
import { initialActivities, initialActivityGroups } from '@/components/seedData';
import { MEDIA_DIR } from '@/databases/mediaHelpers';
import { withWriteLock, withWriteTransaction } from '@/databases/writeTransaction';
import { parseReminders, serializeReminders } from '@/lib/reminders';

/**
 * The DISTRESS WIPE: strip the journal down to what is believable and harmless.
 *
 * Fired by the app lock (context/AppLock.tsx) when the user has opted in and
 * the biometric prompt ended in a LOCKOUT (too many wrong fingers). The use
 * case: someone forces you to unlock SoulSync, you deliberately present the
 * wrong finger a few times, and what they later see is a real, plausible mood
 * history with nothing private in it.
 *
 * The rule: strip only what can INCRIMINATE (anything the user typed or
 * photographed, and names they made up); keep everything else, so the journal
 * stays as full and lived-in as it was. 200 logged days stay 200 logged days.
 *
 * What SURVIVES:
 *   - EVERY live entry: its date, time, mood score and star,
 *   - its links to the DEFAULT activities (the seed catalogue in
 *     components/seedData.ts, matched by activity name AND group name), i.e.
 *     the general mood / sleep / social picture of each day,
 *   - the default groups/activities themselves, health metrics, every
 *     setting, every reminder (time and on/off).
 *
 * What is DESTROYED (only free text, photos and made-up names):
 *   - every note (entries.notes -> NULL),
 *   - every reminder's own name (back to the default label),
 *   - every photo: the entry_media rows AND the files on disk,
 *   - every custom activity and custom group (their NAMES can be the most
 *     revealing thing in the app), and every entry link to them,
 *   - the recycle bin (binned entries are purged outright: they still carry
 *     the notes the user deleted),
 *   - leftover plain-text backup files the export wrote into the app's
 *     documents folder, and the picker caches,
 *   - the distress flag itself (`distress_wipe_enabled` -> 'false'), in the
 *     same transaction, so the Settings screen no longer advertises it and a
 *     second lockout cannot fire again.
 *
 * Forensics: `PRAGMA secure_delete` (on before the wipe) zeroes freed space,
 * then a VACUUM + WAL checkpoint (TRUNCATE) rewrite the file, so the old notes are not
 * recoverable from free pages or the WAL. Both are best-effort: the logical
 * wipe has already committed atomically when they run.
 *
 * DB contract (databases/CLAUDE.md): one `withWriteTransaction`, statements on
 * `txn` only; the photo paths are captured BEFORE the write and unlinked AFTER
 * commit, like the bin purge; secure_delete is set OUTSIDE the transaction.
 */

/** Separator for the "group\u001factivity" match keys (cannot occur in a typed name). */
const KEY_SEP = '\u001f';

/** Name the original Social > "Event" seed was renamed to by migration 6. */
const RENAMED_SEED_ACTIVITIES: Array<{ group: string; name: string }> = [
    { group: 'Social', name: 'Social event' },
];

/**
 * The default activities as "group name + SEP + activity name" keys. Matching on
 * BOTH names means a custom activity that happens to share a default's name in
 * a different (custom) group is still treated as custom.
 */
export function defaultActivityKeys(): string[] {
    const keys = initialActivities.map(a => {
        const group = initialActivityGroups[a.group_id - 1]?.name ?? '';
        return `${group}${KEY_SEP}${a.name}`;
    });
    for (const r of RENAMED_SEED_ACTIVITIES) keys.push(`${r.group}${KEY_SEP}${r.name}`);
    return Array.from(new Set(keys));
}

/** The default group names (components/seedData.ts). */
export function defaultGroupNames(): string[] {
    return initialActivityGroups.map(g => g.name);
}

/** Whether a file in the app's documents folder is a backup the export left behind. */
export function isLeftoverBackupFile(name: string): boolean {
    return /^mood_tracker_export_.*\.json$/.test(name);
}

export type DistressWipeSummary = {
    notesCleared: number;
    photosRemoved: number;
    customActivitiesRemoved: number;
    customGroupsRemoved: number;
    binnedEntriesPurged: number;
    /** The new `reminders` setting value when labels were blanked, else null. */
    reminders: string | null;
};

const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(', ');

/**
 * The database half of the wipe. Atomic: either every statement commits or
 * nothing changes. Returns what it removed plus the photo files to unlink.
 */
export async function wipeSensitiveData(
    db: SQLiteDatabase
): Promise<DistressWipeSummary & { mediaFiles: string[] }> {
    // Pre-read on the read connection (allowed before the callback, per the
    // contract): every photo path, binned or live, is going away.
    const mediaRows = await db.getAllAsync<{ file_path: string }>(
        'SELECT file_path FROM entry_media'
    );
    const mediaFiles = mediaRows.map(r => r.file_path);

    // secure_delete zeroes the space the deletes and the NULLed notes free,
    // inside the same transaction. Per connection, set OUTSIDE a transaction;
    // left on for the write connection afterwards, which only costs a little
    // write speed on later deletes.
    await withWriteLock(conn => conn.execAsync('PRAGMA secure_delete = ON;'));

    const activityKeys = defaultActivityKeys();
    const groupNames = defaultGroupNames();

    const summary = await withWriteTransaction(async (txn) => {
        const changes = async (sql: string, params: (string | number)[] = []) =>
            (await txn.runAsync(sql, params)).changes;

        // The bin first: binned entries keep their notes and photos until purged.
        // Child rows are deleted explicitly (not only by FK cascade), so the wipe
        // is complete even on a connection where foreign_keys is off.
        await txn.runAsync(
            `DELETE FROM entry_activities
             WHERE entry_id IN (SELECT id FROM entries WHERE deleted_at IS NOT NULL)`
        );
        const binnedEntriesPurged = await changes(
            'DELETE FROM entries WHERE deleted_at IS NOT NULL'
        );

        const photosRemoved = await changes('DELETE FROM entry_media');

        const notesCleared = await changes(
            'UPDATE entries SET notes = NULL WHERE notes IS NOT NULL'
        );

        // Custom activities: anything whose (group name, activity name) pair is
        // not in the default catalogue. Links go first, then the activities.
        const customActivityWhere = `
            id NOT IN (
                SELECT a.id FROM activities a
                JOIN activity_groups g ON g.id = a.group_id
                WHERE g.name || '${KEY_SEP}' || a.name IN (${placeholders(activityKeys.length)})
            )`;
        await txn.runAsync(
            `DELETE FROM entry_activities WHERE activity_id IN (
                SELECT id FROM activities WHERE ${customActivityWhere}
            )`,
            activityKeys
        );
        const customActivitiesRemoved = await changes(
            `DELETE FROM activities WHERE ${customActivityWhere}`,
            activityKeys
        );

        // Custom groups are empty by now (their activities were all custom).
        const customGroupsRemoved = await changes(
            `DELETE FROM activity_groups WHERE name NOT IN (${placeholders(groupNames.length)})`,
            groupNames
        );

        // Links to activities that no longer exist at all (belt and braces).
        await txn.runAsync(
            'DELETE FROM entry_activities WHERE activity_id NOT IN (SELECT id FROM activities)'
        );

        // Reminder NAMES are typed by the user ("take meds"): blank them, keep
        // each reminder's time and on/off state.
        const reminderRow = await txn.getFirstAsync<{ value: string }>(
            `SELECT value FROM user_settings WHERE key = 'reminders'`
        );
        let reminders: string | null = null;
        if (reminderRow) {
            const list = parseReminders(reminderRow.value);
            if (list.some(r => r.label !== '')) {
                reminders = serializeReminders(list.map(r => ({ ...r, label: '' })));
                await txn.runAsync(
                    `UPDATE user_settings SET value = ? WHERE key = 'reminders'`,
                    [reminders]
                );
            }
        }

        // The distress option switches itself off in the same transaction.
        await txn.runAsync(
            `INSERT OR REPLACE INTO user_settings (key, value) VALUES ('distress_wipe_enabled', 'false')`
        );

        return {
            notesCleared,
            photosRemoved,
            customActivitiesRemoved,
            customGroupsRemoved,
            binnedEntriesPurged,
            reminders,
        };
    });

    return { ...summary, mediaFiles };
}

/**
 * Overwrite freed pages and fold the WAL back into a freshly rewritten file, so
 * deleted notes are not recoverable from the database file. Runs on the write
 * connection, outside any transaction (VACUUM cannot run inside one). Never
 * throws: the logical wipe has already committed.
 */
export async function scrubDatabaseFile(): Promise<void> {
    try {
        await withWriteLock(async (conn) => {
            await conn.execAsync('VACUUM;');
            await conn.execAsync('PRAGMA wal_checkpoint(TRUNCATE);');
        });
    } catch (e) {
        console.warn('[distress] database scrub failed:', e);
    }
}

/** Delete one path, swallowing every error (a wipe must never stop half-way on IO). */
async function deleteQuietly(path: string): Promise<void> {
    try {
        await FileSystem.deleteAsync(path, { idempotent: true });
    } catch {
        // already gone or not ours
    }
}

/**
 * The file half of the wipe: the photos, the whole media folder, plain backup
 * files the export left in the documents folder, and the picker caches.
 */
export async function wipeSensitiveFiles(mediaFiles: string[]): Promise<void> {
    for (const f of mediaFiles) await deleteQuietly(f);
    await deleteQuietly(MEDIA_DIR);

    const docs = FileSystem.documentDirectory;
    if (docs) {
        try {
            const names = await FileSystem.readDirectoryAsync(docs);
            for (const name of names) {
                if (isLeftoverBackupFile(name)) await deleteQuietly(`${docs}${name}`);
            }
        } catch {
            // unreadable documents folder: nothing more we can do
        }
    }

    const cache = FileSystem.cacheDirectory;
    if (cache) {
        try {
            const names = await FileSystem.readDirectoryAsync(cache);
            for (const name of names) await deleteQuietly(`${cache}${name}`);
        } catch {
            // ignore
        }
    }
}

/**
 * The whole wipe, in order: atomic DB wipe -> files -> file scrub. Resolves
 * with the summary (for tests/logs only: the UI must not show it, because the
 * point is that nothing visibly happened).
 */
export async function runDistressWipe(db: SQLiteDatabase): Promise<DistressWipeSummary> {
    const { mediaFiles, ...summary } = await wipeSensitiveData(db);
    await wipeSensitiveFiles(mediaFiles);
    await scrubDatabaseFile();
    return summary;
}
