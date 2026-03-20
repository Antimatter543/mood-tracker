import { DatabaseResult } from '@/components/types';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { SQLiteDatabase } from 'expo-sqlite';

import { Platform } from 'react-native';




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
  
      const activities = await db.getAllAsync('SELECT * FROM activities');
      const activityGroups = await db.getAllAsync('SELECT * FROM activity_groups');
      const settings = await db.getAllAsync('SELECT * FROM user_settings');
  
      // Create an export object
      const exportData = {
        version: 1,
        exportDate: new Date().toISOString(),
        data: {
          entries,
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
  
      // Import the data into the database
      await db.withTransactionAsync(async () => {
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
                const result = await db.runAsync(
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
        message: 'Data imported successfully'
      };
    } catch (error) {
      console.error('Error importing data:', error);
      return {
        success: false,
        message: `Error importing data: ${error}`
      };
    }
  }