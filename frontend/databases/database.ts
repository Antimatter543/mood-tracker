import { SQLiteDatabase } from 'expo-sqlite';
import { initialActivities, initialActivityGroups } from '../components/seedData';
import { DatabaseResult, MoodEntry, Activity } from '../components/types';
import { runMigrations } from '@/databases/migrations';



export const DATABASE_VERSION = 3; // Set this to your current migration version

// 1: initial
// 2: activity changes for icons

export async function initializeDatabase(db: SQLiteDatabase): Promise<void> {
    try {
        // Enable foreign keys
        await db.execAsync('PRAGMA foreign_keys = ON;');
        
        // Run migrations -- THIS IS WHERE YOU CHANGE SHIT IF YOU WANT TO CHANGE DB SCHEMA.
        await runMigrations(db);
        
        console.log('Database initialization complete');
    } catch (error) {
        console.error('Error initializing database:', error);
        throw error;
    }
}


// Used in first database version (see migrations.ts)
// BASICALLY STOP FUCKIN EDITTING THIS ONE AND USE MIGRATIONS INSTEAD YOU SCALLYWAG!
// DONT CHANGE ANYTHING HERE ANYMORE. GO MIGRATIONS.
export async function createInitialSchema(db: SQLiteDatabase): Promise<void> {
    await db.execAsync(`

    CREATE TABLE IF NOT EXISTS activity_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE
    );
    
    CREATE TABLE IF NOT EXISTS activities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        group_id INTEGER NOT NULL,
        icon_name TEXT,
        position INTEGER NOT NULL DEFAULT 0,
        UNIQUE(name, group_id),
        FOREIGN KEY(group_id) REFERENCES activity_groups(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mood REAL NOT NULL,
        notes TEXT,
        date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- New table for media attachments
    CREATE TABLE IF NOT EXISTS entry_media (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_id INTEGER NOT NULL,
        file_path TEXT NOT NULL,
        media_type TEXT NOT NULL,  -- 'image' or 'audio'
        FOREIGN KEY(entry_id) REFERENCES entries(id) ON DELETE CASCADE -- So if we delete an entry, all related media items get deleted too
    );

    CREATE TABLE IF NOT EXISTS entry_activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id INTEGER NOT NULL,
      activity_id INTEGER NOT NULL,
      FOREIGN KEY(entry_id) REFERENCES entries(id) ON DELETE CASCADE,
      FOREIGN KEY(activity_id) REFERENCES activities(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date);
    CREATE INDEX IF NOT EXISTS idx_entry_activities_entry_id ON entry_activities(entry_id);
    CREATE INDEX IF NOT EXISTS idx_activities_group_id ON activities(group_id);
  `);
}

// Update the seedActivities function to include positions
// DONT TOUCH SINCE THIS IS V1 
export async function seedActivitiesV1(db: SQLiteDatabase): Promise<DatabaseResult> {
    try {
        // First insert the groups
        for (const group of initialActivityGroups) {
            await db.runAsync(
                `INSERT OR IGNORE INTO activity_groups (name) VALUES (?)`,
                [group.name]
            );
        }

        // Then insert activities with positions grouped by group_id
        const groupedActivities = initialActivities.reduce((acc, activity) => {
            if (!acc[activity.group_id]) {
                acc[activity.group_id] = [];
            }
            acc[activity.group_id].push(activity);
            return acc;
        }, {} as Record<number, typeof initialActivities>);

        for (const groupId in groupedActivities) {
            const activities = groupedActivities[groupId];
            for (let i = 0; i < activities.length; i++) {
                const activity = activities[i];
                await db.runAsync(
                    `INSERT OR IGNORE INTO activities (name, group_id, icon_name, position) 
                    VALUES (?, ?, ?, ?)`,
                    [activity.name, activity.group_id, activity.icon_name, i + 1]
                );
            }
        }

        return {
            success: true,
            message: 'Successfully seeded activities'
        };
    } catch (error) {
        console.error('Error seeding activities:', error);
        return {
            success: false,
            message: `Error seeding activities: ${error}`
        };
    }
}


export async function addMoodEntry(
    db: SQLiteDatabase,
    mood: number,
    activityIds: number[],
    notes: string,
    date?: string // Make date optional, defaults to current time if not provided
): Promise<DatabaseResult> {
    try {
        const entryDate = date || new Date().toISOString();

        if (isNaN(mood) || mood < 0 || mood > 10) {
            return {
                success: false,
                message: 'Please enter a valid mood score between 0 and 10'
            };
        }

        // Filter out any activity IDs that don't exist in the database
        const validActivityIds = await filterValidActivityIds(db, activityIds);
        
        // If some activities were invalid, log a warning but continue with valid ones
        if (validActivityIds.length !== activityIds.length) {
            console.warn(`Some activities (${activityIds.length - validActivityIds.length}) were skipped because they no longer exist.`);
        }

        await db.withTransactionAsync(async () => {
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
        });

        return {
            success: true,
            message: "Entry added successfully!"
        };
    } catch (error) {
        console.error('Error adding mood:', error);
        return {
            success: false,
            message: 'Error adding entry'
        };
    }
}

// Helper function to filter out activity IDs that don't exist in the database
async function filterValidActivityIds(db: SQLiteDatabase, activityIds: number[]): Promise<number[]> {
    if (!activityIds.length) return [];
    
    try {
        // Create a comma-separated list of activity IDs for the SQL query
        const idList = activityIds.join(',');
        
        // Query to find which of the provided IDs actually exist in the database
        const existingActivities = await db.getAllAsync<{ id: number }>(
            `SELECT id FROM activities WHERE id IN (${idList})`
        );
        
        // Extract just the IDs from the result
        return existingActivities.map(activity => activity.id);
    } catch (error) {
        console.error('Error filtering activity IDs:', error);
        return [];
    }
}

export async function getMoodEntries(db: SQLiteDatabase): Promise<MoodEntry[]> {
    try {
        let entriesWithActivities: MoodEntry[] = [];

        await db.withTransactionAsync(async () => {  // Changed to withTransactionAsync
            // Get base entries
            const rawEntries = await db.getAllAsync<Omit<MoodEntry, 'activities'>>(
                'SELECT * FROM entries ORDER BY date DESC'
            );

            // Add activities to each entry
            entriesWithActivities = await Promise.all(
                rawEntries.map(async (entry) => {
                    const activities = await db.getAllAsync<Activity>(`
              SELECT a.id, a.name, a.group_id, a.icon_name
              FROM activities a
              JOIN entry_activities ea ON ea.activity_id = a.id
              WHERE ea.entry_id = ?
              ORDER BY a.group_id, a.name
            `, [entry.id]);

                    return {
                        ...entry,
                        activities
                    };
                })
            );
        });

        return entriesWithActivities;
    } catch (error) {
        console.error('Error fetching mood entries:', error);
        return [];
    }
}


// Update getActivities to order by position
export async function getActivities(db: SQLiteDatabase): Promise<Activity[]> {
    try {
        return await db.getAllAsync<Activity>(
            'SELECT * FROM activities ORDER BY group_id, position'
        );
    } catch (error) {
        console.error('Error fetching activities:', error);
        return [];
    }
}


// Add a function to add new activities with correct positioning
export async function addActivity(
    db: SQLiteDatabase,
    name: string,
    groupId: number,
    iconFamily: string = 'Feather',  // Default values
    iconName: string = 'circle'
): Promise<DatabaseResult> {
    try {
        // Get the next position for this specific group
        const result = await db.getFirstAsync<{ maxPosition: number }>(
            `SELECT COALESCE(MAX(position), 0) as maxPosition 
             FROM activities 
             WHERE group_id = ?`,
            [groupId]
        );

        const nextPosition = (result?.maxPosition || 0) + 1;

        await db.runAsync(
            `INSERT INTO activities (name, group_id, icon_family, icon_name, position)
             VALUES (?, ?, ?, ?, ?)`,
            [name, groupId, iconFamily, iconName, nextPosition]
        );

        return {
            success: true,
            message: 'Activity added successfully'
        };
    } catch (error) {
        console.error('Error adding activity:', error);
        return {
            success: false,
            message: `Error adding activity: ${error}`
        };
    }
}

export async function addActivityGroup(
    db: SQLiteDatabase,
    groupName: string
): Promise<DatabaseResult> {
    try {
        // Basic validation
        if (!groupName.trim()) {
            return {
                success: false,
                message: 'Group name cannot be empty'
            };
        }

        // Check if group already exists
        const existingGroup = await db.getFirstAsync<{ id: number }>(
            'SELECT id FROM activity_groups WHERE name = ?',
            [groupName.trim()]
        );

        if (existingGroup) {
            return {
                success: false,
                message: 'A group with this name already exists'
            };
        }

        // Insert the new group
        await db.runAsync(
            'INSERT INTO activity_groups (name) VALUES (?)',
            [groupName.trim()]
        );

        return {
            success: true,
            message: 'Group added successfully'
        };

    } catch (error) {
        console.error('Error adding activity group:', error);
        return {
            success: false,
            message: 'Failed to add group'
        };
    }
}

export async function resetDatabase(db: SQLiteDatabase): Promise<DatabaseResult> {
    try {
        await db.withExclusiveTransactionAsync(async () => {
            // Drop all tables
            await db.execAsync(`
                PRAGMA foreign_keys = OFF;
                DROP TABLE IF EXISTS entry_activities;
                DROP TABLE IF EXISTS entry_media;
                DROP TABLE IF EXISTS entries;
                DROP TABLE IF EXISTS activities;
                DROP TABLE IF EXISTS activity_groups;
                DROP TABLE IF EXISTS user_settings;
                PRAGMA foreign_keys = ON;
            `);

            // Reset the version to 0 so migrations will run again
            await db.execAsync('PRAGMA user_version = 0');

            // Run migrations from scratch
            await runMigrations(db);
        });

        return {
            success: true,
            message: 'Database reset successfully'
        };
    } catch (error) {
        return {
            success: false,
            message: `Error resetting database: ${error}`
        };
    }
}


export async function updateActivity(
    db: SQLiteDatabase,
    activityId: number,
    newName: string,
    iconFamily: string,
    iconName: string,
): Promise<DatabaseResult> {
    try {
        // Basic validation
        if (!newName.trim()) {
            return {
                success: false,
                message: 'Activity name cannot be empty'
            };
        }

        // Get the current activity to check its group_id
        const currentActivity = await db.getFirstAsync<{ group_id: number }>(
            'SELECT group_id FROM activities WHERE id = ?',
            [activityId]
        );

        if (!currentActivity) {
            return {
                success: false,
                message: 'Activity not found'
            };
        }

        // Check if name already exists in the same group
        const existingActivity = await db.getFirstAsync<{ id: number }>(
            `SELECT id 
             FROM activities 
             WHERE name = ? 
             AND group_id = ?
             AND id != ?`,
            [newName.trim(), currentActivity.group_id, activityId]
        );

        if (existingActivity) {
            return {
                success: false,
                message: 'An activity with this name already exists in this group'
            };
        }

        // Update the activity (position remains unchanged)
        await db.runAsync(
            'UPDATE activities SET name = ?, icon_family = ?, icon_name = ? WHERE id = ?',
            [newName.trim(), iconFamily, iconName, activityId]
        );


        return {
            success: true,
            message: 'Activity updated successfully'
        };
    } catch (error) {
        console.error('Error updating activity:', error);
        return {
            success: false,
            message: 'Failed to update activity'
        };
    }
}

export async function deleteActivity(
    db: SQLiteDatabase,
    activityId: number
): Promise<DatabaseResult> {
    try {
        // Get activity details before deletion
        const activity = await db.getFirstAsync<{ group_id: number, position: number }>(
            'SELECT group_id, position FROM activities WHERE id = ?',
            [activityId]
        );

        if (!activity) {
            return {
                success: false,
                message: 'Activity not found'
            };
        }

        await db.withTransactionAsync(async () => {
            // Delete the activity - the ON DELETE CASCADE will handle removing it from entries
            await db.runAsync(
                'DELETE FROM activities WHERE id = ?',
                [activityId]
            );

            // Update positions of remaining activities in the same group
            await db.runAsync(
                `UPDATE activities 
                 SET position = position - 1 
                 WHERE group_id = ? 
                 AND position > ?`,
                [activity.group_id, activity.position]
            );
        });

        return {
            success: true,
            message: 'Activity deleted successfully'
        };
    } catch (error) {
        console.error('Error deleting activity:', error);
        return {
            success: false,
            message: 'Failed to delete activity'
        };
    }
}

// Check if a group has associated entries
export async function checkGroupHasEntries(
    db: SQLiteDatabase,
    groupId: number
): Promise<{ exists: boolean; hasEntries: boolean }> {
    try {
        // Check if group exists
        const group = await db.getFirstAsync<{ id: number }>(
            'SELECT id FROM activity_groups WHERE id = ?',
            [groupId]
        );

        if (!group) {
            return {
                exists: false,
                hasEntries: false
            };
        }

        // Check if there are any mood entries associated with activities in this group
        const entriesCount = await db.getFirstAsync<{ count: number }>(
            `SELECT COUNT(*) as count 
             FROM entry_activities ea
             JOIN activities a ON ea.activity_id = a.id
             WHERE a.group_id = ?`,
            [groupId]
        );

        return {
            exists: true,
            hasEntries: entriesCount && entriesCount.count > 0
        };
    } catch (error) {
        console.error('Error checking group entries:', error);
        throw error;
    }
}

export async function deleteActivityGroup(
    db: SQLiteDatabase,
    groupId: number
): Promise<DatabaseResult> {
    try {
        // Check if group exists
        const group = await db.getFirstAsync<{ id: number }>(
            'SELECT id FROM activity_groups WHERE id = ?',
            [groupId]
        );

        if (!group) {
            return {
                success: false,
                message: 'Activity group not found'
            };
        }

        await db.withTransactionAsync(async () => {
            // Delete the group - the ON DELETE CASCADE will handle removing all related activities
            // and entry_activities records
            await db.runAsync(
                'DELETE FROM activity_groups WHERE id = ?',
                [groupId]
            );
        });

        return {
            success: true,
            message: 'Activity group deleted successfully'
        };
    } catch (error) {
        console.error('Error deleting activity group:', error);
        return {
            success: false,
            message: 'Failed to delete activity group'
        };
    }
}

/// USER SETTINGS STUFF


// Add this to your database initialization
export async function initializeSettingsTable(db: SQLiteDatabase) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS user_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    // Insert default settings if they don't exist
    await db.runAsync(`
        INSERT OR IGNORE INTO user_settings (key, value) VALUES 
        ('fab_position', 'right'),
        ('theme_mode', 'dark'),
        ('mood_precision', 'low');
    `);
    console.log("Initialised settings table!!");
}


export async function getSetting(db: SQLiteDatabase, key: string): Promise<string> {
    const result = await db.getFirstAsync<{ value: string }>(
        'SELECT value FROM user_settings WHERE key = ?',
        [key]
    );
    return result?.value ?? 'right';
}



export async function updateSetting(
    db: SQLiteDatabase,
    key: string,
    value: string
): Promise<void> {
    await db.runAsync(
        'INSERT OR REPLACE INTO user_settings (key, value) VALUES (?, ?)',
        [key, value]
    );
}

export async function updateActivityPositions(
    db: SQLiteDatabase,
    activities: Activity[]
): Promise<DatabaseResult> {
    try {
        await db.withTransactionAsync(async () => {
            // Update each activity's position
            for (let i = 0; i < activities.length; i++) {
                const activity = activities[i];
                await db.runAsync(
                    'UPDATE activities SET position = ? WHERE id = ?',
                    [i + 1, activity.id]
                );
            }
        });

        return {
            success: true,
            message: 'Activity positions updated successfully'
        };
    } catch (error) {
        console.error('Error updating activity positions:', error);
        return {
            success: false,
            message: 'Failed to update activity positions'
        };
    }
}

