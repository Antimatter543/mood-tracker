import { DatabaseResult } from '@/components/types';
import * as DocumentPicker from 'expo-document-picker';
// SDK 54 moved the classic function API (readAsStringAsync/writeAsStringAsync/
// copyAsync/StorageAccessFramework/EncodingType) to `expo-file-system/legacy`.
// The default export is now the File/Directory class API; switching to it is
// post-upgrade cleanup. `/legacy` is available through SDK 56.
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { SQLiteDatabase } from 'expo-sqlite';

import { GROUP_ORDER_BY } from '@/databases/groups';
import { deriveMediaExt, writeBase64ToMediaDir } from '@/databases/mediaHelpers';
import { withWriteLock, withWriteTransaction } from '@/databases/writeTransaction';
import {
  BackupDecryptionError,
  EncryptedBackupEnvelope,
  assertSupportedEnvelope,
  decryptBackup,
  deriveBackupKey,
  encryptBackup,
  isEncryptedBackup,
  sameKdf,
} from '@/lib/backupCrypto';
import { readBackupKeyState } from '@/lib/backupKeyStore';
import { daylioImportMessage, isZipHeader, readDaylioFile } from '@/databases/daylio-import';
import { DaylioFormatError, DaylioImportSummary } from '@/lib/daylioImport';

/**
 * Asks the user for an encrypted backup's password. Resolves to the typed
 * password, or `null` if they cancelled. `wrongPassword` is true when the
 * previous attempt did not open the file, so the prompt can say so.
 */
export type RequestBackupPassword = (state: { wrongPassword: boolean }) => Promise<string | null>;

export interface ImportOptions {
  requestPassword?: RequestBackupPassword;
  /**
   * Asked once the file is known to be a SoulSync backup, before anything is
   * read or written. Resolve false to cancel. Omitted = proceed.
   */
  confirmRestore?: () => Promise<boolean>;
  /** Shows what a Daylio backup contains before it is added. Resolve false to cancel. Omitted = proceed. */
  confirmDaylio?: (summary: DaylioImportSummary) => Promise<boolean>;
  /**
   * Called with the password that opened an encrypted backup (not when it
   * opened silently with this phone's stored key), so the caller can offer to
   * keep encrypting new backups with it.
   */
  onPasswordAccepted?: (password: string) => void;
}

/** `DatabaseResult.code` when export stopped because the stored key is unreadable. */
export const BACKUP_KEY_UNREADABLE = 'backup-key-unreadable';

/** Shown for any file Restore cannot read as one of SUPPORTED_RESTORE_SOURCES. */
export function unsupportedFileMessage(): string {
  const apps = SUPPORTED_RESTORE_SOURCES.map(s => s.app);
  return `SoulSync can't open this file. Pick a backup made with ${apps.slice(0, -1).join(', ')} or ${apps[apps.length - 1]}.`;
}

/**
 * Backups from other apps that Restore understands, for the "Supported apps"
 * list in Settings. Add an app here when Restore learns its format.
 */
export const SUPPORTED_RESTORE_SOURCES: readonly { app: string; detail: string }[] = [
  { app: 'SoulSync', detail: 'backups made with Back up, including encrypted ones' },
  { app: 'Daylio', detail: 'the .daylio file from Daylio\'s Backup & Restore' },
];

/**
 * Decrypt an encrypted backup, transparently when possible: if the file was
 * made with the key this device has stored (same salt and params), it opens
 * with no prompt. Otherwise (another device, an older password, encryption
 * since turned off) the user is asked for the password, repeatedly until it
 * is right or they cancel. Returns the plain backup JSON, or `null` on cancel.
 */
export async function openEncryptedBackup(
  envelope: EncryptedBackupEnvelope,
  requestPassword?: RequestBackupPassword,
  onPasswordAccepted?: (password: string) => void
): Promise<string | null> {
  assertSupportedEnvelope(envelope);

  // An unreadable stored key is simply not used here: asking for the
  // password is the right fallback for a restore.
  const keyState = await readBackupKeyState();
  const stored = keyState.status === 'on' ? keyState.key : null;
  if (stored && sameKdf(stored.kdf, envelope.kdf)) {
    try {
      return await decryptBackup(envelope, stored);
    } catch (error) {
      if (!(error instanceof BackupDecryptionError)) throw error;
      // Same salt but the key does not fit (should not happen): ask instead.
    }
  }

  if (!requestPassword) {
    throw new Error('This backup is encrypted and needs its password.');
  }

  let wrongPassword = false;
  for (;;) {
    const password = await requestPassword({ wrongPassword });
    if (password === null) return null;
    const key = await deriveBackupKey(password, envelope.kdf);
    try {
      const plaintext = await decryptBackup(envelope, key);
      onPasswordAccepted?.(password);
      return plaintext;
    } catch (error) {
      if (!(error instanceof BackupDecryptionError)) throw error;
      wrongPassword = true;
    }
  }
}

/**
 * Shape of a single photo embedded in a v3 export. `data_base64` carries the
 * actual image bytes so the backup is device-independent; `file_path` is the
 * ORIGINAL on-device path, kept for reference/debugging only (it does not exist
 * on a different install). `ext` is the lowercased extension used to name the
 * restored file. v1/v2 backups carry `{ file_path, media_type }` with no bytes.
 */
interface ExportPhoto {
  media_type: string;
  /** Original absolute path on the exporting device — informational only. */
  file_path: string;
  /** Lowercased file extension (default `jpg`), used to name the restored file. */
  ext: string;
  /** The image bytes, base64-encoded. Present in v3 backups only. */
  data_base64: string;
}

/**
 * Read a photo file as base64. Returns `null` (and warns) if the source is
 * missing or unreadable, so an export never fails because one image is gone.
 */
async function readPhotoBase64(filePath: string): Promise<string | null> {
  try {
    const info = await FileSystem.getInfoAsync(filePath);
    if (!info.exists) {
      console.warn(`Skipping photo export — source file missing: ${filePath}`);
      return null;
    }
    return await FileSystem.readAsStringAsync(filePath, {
      encoding: FileSystem.EncodingType.Base64,
    });
  } catch (error) {
    console.warn(`Skipping photo export — unreadable source: ${filePath} (${error})`);
    return null;
  }
}




export async function exportDatabaseData(db: SQLiteDatabase): Promise<DatabaseResult> {
    try {
      // Opt-in encryption (Settings > Data Management > Encrypt backups),
      // checked FIRST. A key that is stored but unreadable stops the export:
      // the user asked for encrypted backups, so never fall back to plain.
      const keyState = await readBackupKeyState();
      if (keyState.status === 'unreadable') {
        return { success: false, code: BACKUP_KEY_UNREADABLE, message: keyState.message };
      }
      const backupKey = keyState.status === 'on' ? keyState.key : null;

      // Fetch all the necessary data.
      //
      // SOFT DELETE (migration 12): entries sitting in the recycle bin are
      // EXCLUDED from the backup. A backup should capture what the user considers
      // their data — round-tripping an entry they deleted (and would then find
      // resurrected as LIVE on the new device, since the import writes
      // deleted_at back as NULL) is the surprising behaviour, not the safe one.
      // Bin retention is a 30-day local grace period, not something to preserve
      // across devices.
      const entries = await db.getAllAsync(`
        SELECT
          e.id, e.mood, e.notes, e.date, e.starred_at,
          GROUP_CONCAT(a.id) as activity_ids,
          GROUP_CONCAT(a.name) as activity_names
        FROM entries e
        LEFT JOIN entry_activities ea ON e.id = ea.entry_id
        LEFT JOIN activities a ON ea.activity_id = a.id
        WHERE e.deleted_at IS NULL
        GROUP BY e.id
        ORDER BY e.date DESC
      `);
  
      // v3: photos travel as actual image BYTES, base64-encoded, embedded in
      // this JSON — so a backup is fully portable across devices/installs (the
      // app's package id changed, so a new install is a separate sandbox and
      // the original absolute paths no longer exist). Base64 inflates size by
      // ~33%; we accept that for correctness — a backup of tens of MB is still
      // shareable/saveable. A source file that is missing or unreadable is
      // SKIPPED gracefully (warn + continue) so one gone image never fails the
      // whole export.
      const photoRows = await db.getAllAsync<{
        entry_id: number;
        file_path: string;
        media_type: string;
      }>(
        // Joined to `entries` for the SAME bin exclusion as the entry query
        // above — a binned entry keeps its entry_media rows, and without this
        // join we'd base64-encode megabytes of photos for entries that are then
        // dropped from the export anyway.
        `SELECT em.entry_id, em.file_path, em.media_type
         FROM entry_media em
         JOIN entries e ON e.id = em.entry_id
         WHERE e.deleted_at IS NULL
         ORDER BY em.entry_id, em.id`
      );

      const photosByEntryId: Record<number, ExportPhoto[]> = {};
      for (const p of photoRows) {
        const data_base64 = await readPhotoBase64(p.file_path);
        if (data_base64 === null) continue; // missing/unreadable — skip this one
        (photosByEntryId[p.entry_id] ??= []).push({
          media_type: p.media_type,
          file_path: p.file_path, // informational only — does not exist on a new device
          ext: deriveMediaExt(p.file_path),
          data_base64,
        });
      }

      const enrichedEntries = (entries as { id: number }[]).map(e => ({
        ...e,
        photos: photosByEntryId[e.id] ?? [],
      }));

      const activities = await db.getAllAsync('SELECT * FROM activities');
      // Exported in DISPLAY order, so the array order alone carries the user's
      // group arrangement — that is what the import replays (see the sort_order
      // note there). v1/v2 backups predate the column; their array order was
      // rowid order, which was the display order back then, so import handles
      // both with one rule.
      const activityGroups = await db.getAllAsync(
        `SELECT * FROM activity_groups ${GROUP_ORDER_BY}`
      );
      const settings = await db.getAllAsync('SELECT * FROM user_settings');

      // Create an export object
      const exportData = {
        version: 3,
        exportDate: new Date().toISOString(),
        // v3 backups EMBED each photo's bytes (base64) directly in this JSON, so
        // importing on a different device/install restores the images into the
        // new app's media directory — the backup is fully portable. (v1/v2
        // backups carried file-path references only; their photos do not travel
        // and won't appear on a new device — unchanged, best-effort.)
        _note: 'Photos are embedded as base64 image data, so this backup is fully portable: exporting and importing carries your photos across devices and installs.',
        data: {
          entries: enrichedEntries,
          activities,
          activityGroups,
          settings
        }
      };
  
      // Convert to JSON
      const jsonData = JSON.stringify(exportData, null, 2);

      // When a key is stored, ONLY the encrypted envelope is ever written to
      // disk; the plain JSON stays in memory. See lib/backupCrypto.ts.
      const fileContents = backupKey ? await encryptBackup(jsonData, backupKey) : jsonData;

      // Create a temporary file
      const fileDate = new Date().toISOString().split('T')[0];
      const fileName = backupKey
        ? `mood_tracker_export_${fileDate}_encrypted.json`
        : `mood_tracker_export_${fileDate}.json`;
      const tempFilePath = `${FileSystem.documentDirectory}${fileName}`;

      await FileSystem.writeAsStringAsync(tempFilePath, fileContents);

      // ONE delivery path: hand the file to the OS share sheet. That single
      // surface already exposes "Save to Drive", "Save to device/Files", Gmail,
      // and every other installed target — so one "Back up" action covers cloud
      // backup, local save, and send-anywhere. No Google OAuth / Drive API /
      // account-linking, which would also break SoulSync's no-account,
      // no-cloud, no-tracking promise.
      const isSharingAvailable = await Sharing.isAvailableAsync();
      if (!isSharingAvailable) {
        return {
          success: false,
          message: 'Sharing is not available on this device'
        };
      }

      await Sharing.shareAsync(tempFilePath, {
        mimeType: 'application/json',
        dialogTitle: 'Export Mood Tracker Data',
        UTI: 'public.json' // for iOS
      });

      return {
        success: true,
        message: 'Data exported successfully',
        filePath: tempFilePath
      };
    } catch (error) {
      console.error('Error exporting data:', error);
      return {
        success: false,
        message: `Error exporting data: ${error}`
      };
    }
  }
  export async function importDatabaseData(
    _db: SQLiteDatabase,
    options: ImportOptions = {}
  ): Promise<DatabaseResult> {
    try {
      // Pick a document. Any type: a Daylio backup (.daylio) has no
      // registered MIME type, so an application/json filter would hide it.
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true
      });
  
      if (result.canceled) {
        return {
          success: false,
          message: 'Import cancelled'
        };
      }
  
      const fileUri = result.assets[0].uri;

      // Which app made it? SoulSync backups are JSON; a ZIP may be a Daylio
      // backup, which importDaylioFile then validates in depth (it must hold
      // Daylio's backup.daylio JSON; any other ZIP is "not supported").
      const head = await FileSystem.readAsStringAsync(fileUri, {
        encoding: FileSystem.EncodingType.Base64,
        position: 0,
        length: 4,
      });
      if (typeof head === 'string' && isZipHeader(head)) {
        return await importDaylioFile(fileUri, options.confirmDaylio);
      }

      // Read the selected file
      const jsonData = await FileSystem.readAsStringAsync(fileUri);

      // Parse the JSON. Not JSON at all (an image, a PDF...) = not a backup.
      let importData: any;
      try {
        importData = JSON.parse(jsonData);
      } catch {
        return {
          success: false,
          message: unsupportedFileMessage()
        };
      }

      // Valid JSON is still only a backup if it is SoulSync's own (plain, or
      // the encrypted envelope around it). Checked BEFORE asking anything.
      const isBackup = (data: any) => !!data && !!data.data && !!data.version;
      if (!isEncryptedBackup(importData) && !isBackup(importData)) {
        return {
          success: false,
          message: unsupportedFileMessage()
        };
      }

      if (options.confirmRestore && !(await options.confirmRestore())) {
        return {
          success: false,
          message: 'Import cancelled'
        };
      }

      // An encrypted backup is an envelope around the same plain JSON: open it
      // (silently with this device's stored key, else by asking for the
      // password) and continue with the decrypted backup.
      if (isEncryptedBackup(importData)) {
        const decrypted = await openEncryptedBackup(importData, options.requestPassword, options.onPasswordAccepted);
        if (decrypted === null) {
          return {
            success: false,
            message: 'Import cancelled'
          };
        }
        importData = JSON.parse(decrypted);
        if (!isBackup(importData)) {
          return {
            success: false,
            message: 'Invalid data format'
          };
        }
      }

      const isV3Plus = Number(importData.version) >= 3;
      await applyBackupData(importData);

      return {
        success: true,
        message: isV3Plus
          ? 'Data imported successfully. Your entries, settings, and photos were restored.'
          : 'Data imported successfully. Note: photo files are not included in this backup and must be re-added manually.'
      };
    } catch (error) {
      console.error('Error importing data:', error);
      return {
        success: false,
        message: `Error importing data: ${error}`
      };
    }
  }

/**
 * Restore path for a Daylio backup: convert it, show what it contains, then
 * ADD it (append mode) to the current data. Never replaces anything.
 */
async function importDaylioFile(
  uri: string,
  confirm?: (summary: DaylioImportSummary) => Promise<boolean>
): Promise<DatabaseResult> {
  try {
    const { backup, summary, readPhoto } = await readDaylioFile(uri);
    if (summary.entries === 0) {
      return { success: false, message: 'This Daylio backup has no entries to import.' };
    }
    if (confirm && !(await confirm(summary))) {
      return { success: false, message: 'Import cancelled' };
    }
    const result = await applyBackupData(backup, { appendEntries: true, readPhoto });
    return { success: true, message: daylioImportMessage(result) };
  } catch (error) {
    if (error instanceof DaylioFormatError) {
      return { success: false, message: error.notDaylio ? unsupportedFileMessage() : error.message };
    }
    throw error;
  }
}

export interface ApplyBackupOptions {
  /**
   * Insert every entry as NEW (fresh ids) and skip exact duplicates, instead
   * of upserting by the backup's ids. For foreign imports (Daylio), whose ids
   * would otherwise overwrite unrelated local entries.
   */
  appendEntries?: boolean;
  /**
   * Bytes for a photo that does not embed them as `data_base64` (a Daylio
   * photo still inside its zip). Called for one photo at a time, right before
   * it is written, so all photos are never held in memory together.
   */
  readPhoto?: (photo: any) => EmbeddedPhoto | null | Promise<EmbeddedPhoto | null>;
}

/** A photo's bytes (base64) and file extension, ready to write to the media dir. */
export interface EmbeddedPhoto {
  base64: string;
  ext: string;
}

export interface ApplyBackupResult {
  importedEntries: number;
  skippedDuplicates: number;
  /** Photos whose bytes could not be read or written; left out. */
  unreadablePhotos: number;
}

/** A live entry with the same instant, mood and note: the duplicate test for append mode. */
const FIND_DUPLICATE_ENTRY_SQL = `SELECT id FROM entries
  WHERE date = ? AND mood = ? AND COALESCE(notes, '') = COALESCE(?, '') AND deleted_at IS NULL
  LIMIT 1`;
const duplicateParams = (entry: any) => [entry.date, entry.mood, entry.notes ?? null];

/**
 * Write a parsed, validated v1-v3 backup object into the database: photos to
 * the media dir first, then one write transaction. Shared by the SoulSync
 * restore (upsert by id) and foreign imports (`appendEntries`).
 */
export async function applyBackupData(
  importData: any,
  { appendEntries = false, readPhoto }: ApplyBackupOptions = {}
): Promise<ApplyBackupResult> {
  const result: ApplyBackupResult = { importedEntries: 0, skippedDuplicates: 0, unreadablePhotos: 0 };
  // Backup-side ids of entries skipped as duplicates (append mode only).
  const skippedEntryIds = new Set<number>();

  const importEntries = importData.data.entries;

  // Append mode: entries that already exist are known BEFORE any photo is
  // written, so their photos are never written at all. (Duplicates within
  // the file itself are caught in the transaction below.)
  const existingEntryIds = new Set<number>();
  if (appendEntries && Array.isArray(importEntries)) {
    await withWriteLock(async (conn) => {
      for (const entry of importEntries) {
        if (entry && (await conn.getFirstAsync<{ id: number }>(FIND_DUPLICATE_ENTRY_SQL, duplicateParams(entry)))) {
          existingEntryIds.add(entry.id);
        }
      }
    });
  }

  // Photo bytes are materialised to the media directory BEFORE the DB
  // transaction: this is slow FileSystem IO and must NOT run while we hold
  // the exclusive SQLite lock (see the lesson on non-exclusive transactions
  // racing reads). Each photo gets a FRESH unique local path; the in-txn step
  // below inserts entry_media rows pointing at those paths. Bytes come from
  // `data_base64` (SoulSync v3) or `readPhoto` (Daylio), one photo at a time.
  // A photo that cannot be read or written is skipped (warn + count) so one
  // corrupt image never aborts the import. Legacy (v1/v2) photos carry no
  // bytes, produce nothing here, and fall through to the path-reference
  // insert (best-effort, unchanged).
  const restoredPhotosByEntryId: Record<number, { newPath: string; media_type: string }[]> = {};
  const writtenPaths: string[] = [];
  const bytesOf = async (photo: any): Promise<EmbeddedPhoto | null> => {
    if (typeof photo.data_base64 === 'string' && photo.data_base64.length > 0) {
      return { base64: photo.data_base64, ext: typeof photo.ext === 'string' && photo.ext ? photo.ext : 'jpg' };
    }
    return readPhoto ? await readPhoto(photo) : null;
  };
  if (Array.isArray(importEntries)) {
    for (const entry of importEntries) {
      if (!entry || !Array.isArray(entry.photos) || existingEntryIds.has(entry.id)) continue;
      for (const photo of entry.photos) {
        const embedded = !!photo && (typeof photo.data_base64 === 'string' || (!!readPhoto && !photo.file_path));
        if (!embedded) continue; // legacy path-ref photo: handled in-txn
        try {
          const bytes = await bytesOf(photo);
          if (!bytes) {
            result.unreadablePhotos += 1;
            continue;
          }
          const newPath = await writeBase64ToMediaDir(bytes.base64, bytes.ext);
          writtenPaths.push(newPath);
          (restoredPhotosByEntryId[entry.id] ??= []).push({
            newPath,
            media_type: photo.media_type ?? 'image',
          });
        } catch (error) {
          result.unreadablePhotos += 1;
          console.warn(`Skipping embedded photo (write failed): ${error}`);
        }
      }
    }
  }

  // Import the data into the database in a real write transaction on the
  // write connection: EVERY statement below — the existing-groups/activities
  // reads AND the writes — runs on `txn`, so the whole multi-table import is
  // atomic and its FK-ordered inserts are enforced (the write connection has
  // foreign_keys = ON). See databases/writeTransaction.ts.
  await withWriteTransaction(async (txn) => {
    // Step 1: Import activity groups first (needed for foreign key constraints)
    if (importData.data.activityGroups && Array.isArray(importData.data.activityGroups)) {
      // Keep track of original group IDs to handle activities correctly
      const groupIdMapping = new Map<number, number>();
      
      // First, get existing groups to avoid duplicates
      const existingGroups = await txn.getAllAsync<{ id: number, name: string }>(
        'SELECT id, name FROM activity_groups'
      );
      const existingGroupNames = existingGroups.map(g => g.name.toLowerCase());

      // Imported groups are APPENDED after whatever this device already has,
      // preserving the BACKUP's own order. Without an explicit sort_order
      // they would all land on the column default (0) and a restored backup
      // would silently lose the group order the user arranged (migration 13).
      // `sort_order` is absent from v1/v2 backups (they predate the column),
      // so the array order is the fallback — which is exactly the order
      // those older exports were written in (`SELECT * ... ORDER BY rowid`).
      const maxOrderRow = await txn.getFirstAsync<{ maxOrder: number }>(
        'SELECT COALESCE(MAX(sort_order), 0) as maxOrder FROM activity_groups'
      );
      let nextGroupSortOrder = (maxOrderRow?.maxOrder || 0) + 1;

      // Clear existing groups only if we have new ones and user confirms
      const shouldReplaceGroups = importData.data.activityGroups.length > 0;

      if (shouldReplaceGroups) {
        // Insert new groups
        for (const group of importData.data.activityGroups) {
          // Skip if group already exists
          if (existingGroupNames.includes(group.name.toLowerCase())) {
            const existingGroup = existingGroups.find(g => 
              g.name.toLowerCase() === group.name.toLowerCase()
            );
            if (existingGroup) {
              groupIdMapping.set(group.id, existingGroup.id);
            }
            continue;
          }
          
          // Insert the new group, appended to the end of the display order.
          const result = await txn.runAsync(
            'INSERT INTO activity_groups (name, sort_order) VALUES (?, ?)',
            [group.name, nextGroupSortOrder]
          );
          nextGroupSortOrder += 1;

          // Map old ID to new ID
          groupIdMapping.set(group.id, Number(result.lastInsertRowId));
        }
      }
      
      // Step 2: Import activities
      if (importData.data.activities && Array.isArray(importData.data.activities)) {
        // Get existing activities to avoid duplicates
        const existingActivities = await txn.getAllAsync<{ id: number, name: string, group_id: number }>(
          'SELECT id, name, group_id FROM activities'
        );
        
        // Keep track of activity ID mapping for linking entries
        const activityIdMapping = new Map<number, number>();
        
        for (const activity of importData.data.activities) {
          // Map to new group ID if available
          const mappedGroupId = groupIdMapping.get(activity.group_id) || activity.group_id;
          
          // Check if this activity already exists in the same group
          const existingActivity = existingActivities.find(a => 
            a.name.toLowerCase() === activity.name.toLowerCase() && 
            a.group_id === mappedGroupId
          );
          
          if (existingActivity) {
            // If it exists, just map the old ID to the existing one
            activityIdMapping.set(activity.id, existingActivity.id);
            continue;
          }
          
          // Insert new activity with the mapped group ID
          try {
            // Set default values for new fields if not present in import
            const iconFamily = activity.icon_family || 'Feather';
            const iconName = activity.icon_name || 'circle';
            const position = activity.position || 0;
            
            const result = await txn.runAsync(
              `INSERT INTO activities (name, group_id, icon_family, icon_name, position) 
               VALUES (?, ?, ?, ?, ?)`,
              [activity.name, mappedGroupId, iconFamily, iconName, position]
            );
            
            // Map old ID to new ID
            activityIdMapping.set(activity.id, Number(result.lastInsertRowId));
          } catch (error) {
            console.warn(`Skipping activity import for ${activity.name}: ${error}`);
          }
        }
        
        // Step 3: Import entries
        if (importData.data.entries && Array.isArray(importData.data.entries)) {
          let maxEntryId = 0;

          for (const entry of importData.data.entries) {
            // Upsert entry (merge, don't destroy). `starred_at` may be
            // absent on a legacy (pre-starring) backup — `?? null` covers
            // both `undefined` and `null` alike, so an old backup imports
            // its entries as not-starred rather than throwing.
            //
            // `deleted_at` is deliberately NOT in the column list: exports
            // never contain binned entries, so everything arriving here is
            // live, and omitting the column lets it take its NULL default.
            // (If the local DB happened to hold a binned entry at this id,
            // OR REPLACE resurrects it as live — the right call: the backup
            // is the user's explicit statement of what should exist.)
            let entryId: number;
            if (appendEntries) {
              // APPEND (foreign imports such as Daylio): the backup's ids
              // mean nothing here, so never write them. An entry identical
              // to a live one (same instant, mood and note) is skipped, so
              // re-importing a newer export only adds what is new.
              const duplicate =
                existingEntryIds.has(entry.id) ||
                (await txn.getFirstAsync<{ id: number }>(FIND_DUPLICATE_ENTRY_SQL, duplicateParams(entry)));
              if (duplicate) {
                result.skippedDuplicates += 1;
                skippedEntryIds.add(entry.id);
                continue;
              }
              const inserted = await txn.runAsync(
                'INSERT INTO entries (mood, notes, date, starred_at) VALUES (?, ?, ?, ?)',
                [entry.mood, entry.notes ?? null, entry.date, entry.starred_at ?? null]
              );
              entryId = Number(inserted.lastInsertRowId);
            } else {
              await txn.runAsync(
                'INSERT OR REPLACE INTO entries (id, mood, notes, date, starred_at) VALUES (?, ?, ?, ?, ?)',
                [entry.id, entry.mood, entry.notes, entry.date, entry.starred_at ?? null]
              );
              entryId = entry.id;
              maxEntryId = Math.max(maxEntryId, entry.id);

              // Clear only this entry's activity links before re-inserting
              await txn.runAsync('DELETE FROM entry_activities WHERE entry_id = ?', [entryId]);
            }
            result.importedEntries += 1;

            // Insert activity relationships if they exist
            if (entry.activity_ids) {
              const activityIds = entry.activity_ids.split(',');
              for (const activityIdStr of activityIds) {
                if (!activityIdStr) continue;

                const oldActivityId = parseInt(activityIdStr);
                // Get the new mapped activity ID. In append mode an
                // unmapped id is dropped: falling back to the raw id would
                // link whatever local activity happens to have that id.
                const mappedActivityId = activityIdMapping.get(oldActivityId);
                if (appendEntries && mappedActivityId === undefined) continue;
                const newActivityId = mappedActivityId || oldActivityId;

                try {
                  await txn.runAsync(
                    'INSERT INTO entry_activities (entry_id, activity_id) VALUES (?, ?)',
                    [entryId, newActivityId]
                  );
                } catch (error) {
                  console.warn(`Skipping activity relationship: ${error}`);
                  // Continue even if one link fails
                }
              }
            }

            // Photos. Clear this entry's media first so a re-import is
            // idempotent (no accumulating duplicate rows).
            //   - v3: insert rows pointing at the NEW local paths we wrote
            //     above (the bytes already live in this app's media dir).
            //   - v1/v2: insert the file-path REFERENCES as before. On a new
            //     device those files won't exist (broken thumbnails) — the
            //     same best-effort behaviour as prior versions, unchanged.
            // A v3 photo whose pre-write failed has `data_base64` but no
            // restored path, so it is skipped in BOTH branches (no dead ref).
            if (entry.photos && Array.isArray(entry.photos)) {
              if (!appendEntries) {
                await txn.runAsync('DELETE FROM entry_media WHERE entry_id = ?', [entryId]);
              }
              const restored = restoredPhotosByEntryId[entry.id];
              if (restored && restored.length > 0) {
                for (const media of restored) {
                  try {
                    await txn.runAsync(
                      `INSERT INTO entry_media (entry_id, file_path, media_type) VALUES (?, ?, ?)`,
                      [entryId, media.newPath, media.media_type]
                    );
                  } catch (error) {
                    console.warn(`Skipping photo import: ${error}`);
                  }
                }
              } else {
                for (const photo of entry.photos) {
                  // Skip embedded-byte photos here — those are handled via
                  // `restored` above (or were dropped on a write failure).
                  if (!photo || !photo.file_path || typeof photo.data_base64 === 'string') continue;
                  try {
                    await txn.runAsync(
                      `INSERT INTO entry_media (entry_id, file_path, media_type) VALUES (?, ?, ?)`,
                      [entryId, photo.file_path, photo.media_type ?? 'image']
                    );
                  } catch (error) {
                    console.warn(`Skipping photo import: ${error}`);
                  }
                }
              }
            }
          }
          
          // Reset the autoincrement counter (restores only: appended rows
          // got their ids from the counter itself).
          if (!appendEntries) {
            await txn.runAsync(
              'UPDATE sqlite_sequence SET seq = ? WHERE name = ?',
              [maxEntryId, 'entries']
            );
          }
        }
      }
    }
    
    // Step 4: Import user settings
    if (importData.data.settings && Array.isArray(importData.data.settings)) {
      for (const setting of importData.data.settings) {
        try {
          await txn.runAsync(
            'INSERT OR REPLACE INTO user_settings (key, value) VALUES (?, ?)',
            [setting.key, setting.value]
          );
        } catch (error) {
          console.warn(`Skipping setting import for ${setting.key}: ${error}`);
        }
      }
    }
  }).catch(async (error) => {
    // Rolled back, so no row points at the photos written above: delete them
    // all rather than leave orphan files behind, then fail as before.
    for (const path of writtenPaths) {
      await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
    }
    throw error;
  });

  // Photos were written before the transaction; drop the ones that belonged
  // to entries skipped as duplicates within the file so they don't linger.
  for (const id of skippedEntryIds) {
    for (const media of restoredPhotosByEntryId[id] ?? []) {
      await FileSystem.deleteAsync(media.newPath, { idempotent: true }).catch(() => {});
    }
  }
  return result;
}
