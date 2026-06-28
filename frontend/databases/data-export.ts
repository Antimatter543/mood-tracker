import { DatabaseResult } from '@/components/types';
import * as DocumentPicker from 'expo-document-picker';
// SDK 54 moved the classic function API (readAsStringAsync/writeAsStringAsync/
// copyAsync/StorageAccessFramework/EncodingType) to `expo-file-system/legacy`.
// The default export is now the File/Directory class API; switching to it is
// post-upgrade cleanup. `/legacy` is available through SDK 56.
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { SQLiteDatabase } from 'expo-sqlite';

import { Platform } from 'react-native';

import { deriveMediaExt, writeBase64ToMediaDir } from '@/databases/mediaHelpers';

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




export async function exportDatabaseData(db: SQLiteDatabase, saveMethod: 'share' | 'save' = 'share'): Promise<DatabaseResult> {
    try {
      // Fetch all the necessary data
      const entries = await db.getAllAsync(`
        SELECT 
          e.id, e.mood, e.notes, e.date,
          GROUP_CONCAT(a.id) as activity_ids,
          GROUP_CONCAT(a.name) as activity_names
        FROM entries e
        LEFT JOIN entry_activities ea ON e.id = ea.entry_id
        LEFT JOIN activities a ON ea.activity_id = a.id
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
      }>('SELECT entry_id, file_path, media_type FROM entry_media ORDER BY entry_id, id');

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
      const activityGroups = await db.getAllAsync('SELECT * FROM activity_groups');
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
      
      // Create a temporary file
      const fileDate = new Date().toISOString().split('T')[0];
      const fileName = `mood_tracker_export_${fileDate}.json`;
      const tempFilePath = `${FileSystem.documentDirectory}${fileName}`;
      
      await FileSystem.writeAsStringAsync(tempFilePath, jsonData);
  
      if (saveMethod === 'share') {
        // Check if sharing is available
        const isSharingAvailable = await Sharing.isAvailableAsync();
        
        if (isSharingAvailable) {
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
        } else {
          return {
            success: false,
            message: 'Sharing is not available on this device'
          };
        }
      } else if (saveMethod === 'save') {
        // Save directly to the Downloads folder if possible
        // This requires different approaches for iOS and Android
        
        try {
          // On Android, we can save to the Downloads directory
          // On iOS, this will save to the app's documents directory
          const downloadsDir = FileSystem.documentDirectory; // Default to document directory
          
          // On Android, we can try to use the downloads directory if available
          if (Platform.OS === 'android') {
            // Check if we have the permissions required
            const permissions = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
            
            if (permissions.granted) {
              // User selected a directory
              const destinationUri = await FileSystem.StorageAccessFramework.createFileAsync(
                permissions.directoryUri,
                fileName,
                'application/json'
              );
              
              // Read the file we created
              const fileContent = await FileSystem.readAsStringAsync(tempFilePath);
              
              // Write to the new location
              await FileSystem.writeAsStringAsync(destinationUri, fileContent, {
                encoding: FileSystem.EncodingType.UTF8
              });
              
              return {
                success: true,
                message: 'File saved to selected location',
                filePath: destinationUri
              };
            }
          } 
          
          // For iOS or if Android permissions not granted
          // Just copy to documents directory which is accessible to the user
          const destPath = `${downloadsDir}${fileName}`;
          await FileSystem.copyAsync({
            from: tempFilePath,
            to: destPath
          });
          
          return {
            success: true,
            message: `File saved to ${Platform.OS === 'ios' ? 'Documents' : 'Downloads'} folder`,
            filePath: destPath
          };
        } catch (error) {
          console.error('Error saving file:', error);
          return {
            success: false,
            message: `Error saving file: ${error}`
          };
        }
      }
      
      return {
        success: false,
        message: 'Invalid save method specified'
      };
    } catch (error) {
      console.error('Error exporting data:', error);
      return {
        success: false,
        message: `Error exporting data: ${error}`
      };
    }
  }
  export async function importDatabaseData(db: SQLiteDatabase): Promise<DatabaseResult> {
    try {
      // Pick a document
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/json',
        copyToCacheDirectory: true
      });
  
      if (result.canceled) {
        return {
          success: false,
          message: 'Import cancelled'
        };
      }
  
      // Read the selected file
      const fileUri = result.assets[0].uri;
      const jsonData = await FileSystem.readAsStringAsync(fileUri);
      
      // Parse the JSON
      const importData = JSON.parse(jsonData);
      
      // Validate the data structure
      if (!importData || !importData.data || !importData.version) {
        return {
          success: false,
          message: 'Invalid data format'
        };
      }

      // v3 backups embed photo BYTES (base64). Materialise them to the new
      // app's media directory BEFORE the DB transaction — this is slow
      // FileSystem IO and must NOT run while we hold the exclusive SQLite lock
      // (see the lesson on non-exclusive transactions racing reads). We write
      // each embedded photo under a FRESH unique local path, then the in-txn
      // step below inserts entry_media rows pointing at those new paths. A bad
      // base64 / write failure for one photo is skipped (warn + continue) so a
      // single corrupt image never aborts the whole import. Legacy (v1/v2)
      // photos carry no `data_base64`, produce nothing here, and fall through
      // to the path-reference insert (best-effort, unchanged).
      const isV3Plus = Number(importData.version) >= 3;
      const restoredPhotosByEntryId: Record<number, { newPath: string; media_type: string }[]> = {};
      const importEntries = importData.data.entries;
      if (Array.isArray(importEntries)) {
        for (const entry of importEntries) {
          if (!entry || !Array.isArray(entry.photos)) continue;
          for (const photo of entry.photos) {
            if (!photo || typeof photo.data_base64 !== 'string' || photo.data_base64.length === 0) {
              continue; // legacy path-ref photo, or no embedded bytes — handled in-txn
            }
            try {
              const newPath = await writeBase64ToMediaDir(
                photo.data_base64,
                typeof photo.ext === 'string' && photo.ext ? photo.ext : 'jpg'
              );
              (restoredPhotosByEntryId[entry.id] ??= []).push({
                newPath,
                media_type: photo.media_type ?? 'image',
              });
            } catch (error) {
              console.warn(`Skipping embedded photo (write failed): ${error}`);
            }
          }
        }
      }

      // Import the data into the database. EXCLUSIVE (not the non-exclusive
      // `withTransactionAsync`): a large multi-table import must not interleave
      // with a concurrent read on the shared connection and leave it in a bad
      // in-memory state. See databases/entries.ts addMoodEntry for the full why.
      await db.withExclusiveTransactionAsync(async () => {
        // Step 1: Import activity groups first (needed for foreign key constraints)
        if (importData.data.activityGroups && Array.isArray(importData.data.activityGroups)) {
          // Keep track of original group IDs to handle activities correctly
          const groupIdMapping = new Map<number, number>();
          
          // First, get existing groups to avoid duplicates
          const existingGroups = await db.getAllAsync<{ id: number, name: string }>(
            'SELECT id, name FROM activity_groups'
          );
          const existingGroupNames = existingGroups.map(g => g.name.toLowerCase());
          
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
              
              // Insert the new group
              const result = await db.runAsync(
                'INSERT INTO activity_groups (name) VALUES (?)',
                [group.name]
              );
              
              // Map old ID to new ID
              groupIdMapping.set(group.id, Number(result.lastInsertRowId));
            }
          }
          
          // Step 2: Import activities
          if (importData.data.activities && Array.isArray(importData.data.activities)) {
            // Get existing activities to avoid duplicates
            const existingActivities = await db.getAllAsync<{ id: number, name: string, group_id: number }>(
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
                
                const result = await db.runAsync(
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
                // Upsert entry (merge, don't destroy)
                await db.runAsync(
                  'INSERT OR REPLACE INTO entries (id, mood, notes, date) VALUES (?, ?, ?, ?)',
                  [entry.id, entry.mood, entry.notes, entry.date]
                );
                
                maxEntryId = Math.max(maxEntryId, entry.id);

                // Clear only this entry's activity links before re-inserting
                await db.runAsync('DELETE FROM entry_activities WHERE entry_id = ?', [entry.id]);

                // Insert activity relationships if they exist
                if (entry.activity_ids) {
                  const activityIds = entry.activity_ids.split(',');
                  for (const activityIdStr of activityIds) {
                    if (!activityIdStr) continue;

                    const oldActivityId = parseInt(activityIdStr);
                    // Get the new mapped activity ID
                    const newActivityId = activityIdMapping.get(oldActivityId) || oldActivityId;

                    try {
                      await db.runAsync(
                        'INSERT INTO entry_activities (entry_id, activity_id) VALUES (?, ?)',
                        [entry.id, newActivityId]
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
                  await db.runAsync('DELETE FROM entry_media WHERE entry_id = ?', [entry.id]);
                  const restored = restoredPhotosByEntryId[entry.id];
                  if (restored && restored.length > 0) {
                    for (const media of restored) {
                      try {
                        await db.runAsync(
                          `INSERT INTO entry_media (entry_id, file_path, media_type) VALUES (?, ?, ?)`,
                          [entry.id, media.newPath, media.media_type]
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
                        await db.runAsync(
                          `INSERT INTO entry_media (entry_id, file_path, media_type) VALUES (?, ?, ?)`,
                          [entry.id, photo.file_path, photo.media_type ?? 'image']
                        );
                      } catch (error) {
                        console.warn(`Skipping photo import: ${error}`);
                      }
                    }
                  }
                }
              }
              
              // Reset the autoincrement counter
              await db.runAsync(
                'UPDATE sqlite_sequence SET seq = ? WHERE name = ?',
                [maxEntryId, 'entries']
              );
            }
          }
        }
        
        // Step 4: Import user settings
        if (importData.data.settings && Array.isArray(importData.data.settings)) {
          for (const setting of importData.data.settings) {
            try {
              await db.runAsync(
                'INSERT OR REPLACE INTO user_settings (key, value) VALUES (?, ?)',
                [setting.key, setting.value]
              );
            } catch (error) {
              console.warn(`Skipping setting import for ${setting.key}: ${error}`);
            }
          }
        }
      });
  
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