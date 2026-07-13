import { SQLiteDatabase } from 'expo-sqlite';
import { Activity, DatabaseResult } from '@/components/types';
import { withWriteTransaction } from '@/databases/writeTransaction';

/**
 * CRUD for activities.
 *
 * Position semantics: activities have a `position` per group, 1-indexed
 * and contiguous. `addActivity` appends to the end of the group;
 * `deleteActivity` compacts remaining positions down; `updateActivityPositions`
 * is the bulk reorder used by drag-and-drop.
 */

/**
 * Fetch every activity in stable order (by group, then by position).
 * Returns empty array on error.
 */
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

/**
 * Append a new activity to the end of its group. Rejects empty/whitespace
 * names (mirrors `updateActivity`); duplicate (name, group_id) is caught
 * by the UNIQUE constraint and surfaces as `success: false`.
 */
export async function addActivity(
  db: SQLiteDatabase,
  name: string,
  groupId: number,
  iconFamily: string = 'Feather',
  iconName: string = 'circle'
): Promise<DatabaseResult> {
  try {
    if (!name.trim()) {
      return {
        success: false,
        message: 'Activity name cannot be empty',
      };
    }

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
      [name.trim(), groupId, iconFamily, iconName, nextPosition]
    );

    return {
      success: true,
      message: 'Activity added successfully',
    };
  } catch (error) {
    console.error('Error adding activity:', error);
    return {
      success: false,
      message: `Error adding activity: ${error}`,
    };
  }
}

/**
 * Rename an activity and/or change its icon. Position is preserved.
 *
 * Validates that the new name doesn't collide with another activity in the
 * same group. (Two activities in *different* groups may share a name.)
 */
export async function updateActivity(
  db: SQLiteDatabase,
  activityId: number,
  newName: string,
  iconFamily: string,
  iconName: string
): Promise<DatabaseResult> {
  try {
    if (!newName.trim()) {
      return {
        success: false,
        message: 'Activity name cannot be empty',
      };
    }

    const currentActivity = await db.getFirstAsync<{ group_id: number }>(
      'SELECT group_id FROM activities WHERE id = ?',
      [activityId]
    );

    if (!currentActivity) {
      return {
        success: false,
        message: 'Activity not found',
      };
    }

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
        message: 'An activity with this name already exists in this group',
      };
    }

    await db.runAsync(
      'UPDATE activities SET name = ?, icon_family = ?, icon_name = ? WHERE id = ?',
      [newName.trim(), iconFamily, iconName, activityId]
    );

    return {
      success: true,
      message: 'Activity updated successfully',
    };
  } catch (error) {
    console.error('Error updating activity:', error);
    return {
      success: false,
      message: 'Failed to update activity',
    };
  }
}

/**
 * Delete an activity and compact the position of remaining activities in
 * the same group. ON DELETE CASCADE handles `entry_activities` cleanup.
 *
 * The DELETE and the position compaction live in one transaction so
 * concurrent readers never see a gap (positions stay contiguous from the
 * outside).
 */
export async function deleteActivity(
  db: SQLiteDatabase,
  activityId: number
): Promise<DatabaseResult> {
  try {
    const activity = await db.getFirstAsync<{ group_id: number; position: number }>(
      'SELECT group_id, position FROM activities WHERE id = ?',
      [activityId]
    );

    if (!activity) {
      return {
        success: false,
        message: 'Activity not found',
      };
    }

    // Real write transaction on the write connection (statements on `txn`): the
    // DELETE + position compaction must land atomically, and the CASCADE that
    // removes entry_activities rows only fires because the write connection has
    // foreign_keys = ON. See databases/writeTransaction.ts for why the app's old
    // withExclusiveTransactionAsync usage was a no-op transaction.
    await withWriteTransaction(async (txn) => {
      // CASCADE removes entry_activities rows.
      await txn.runAsync('DELETE FROM activities WHERE id = ?', [activityId]);

      // Shift remaining positions down to keep [1..N] contiguous.
      await txn.runAsync(
        `UPDATE activities
         SET position = position - 1
         WHERE group_id = ?
         AND position > ?`,
        [activity.group_id, activity.position]
      );
    });

    return {
      success: true,
      message: 'Activity deleted successfully',
    };
  } catch (error) {
    console.error('Error deleting activity:', error);
    return {
      success: false,
      message: 'Failed to delete activity',
    };
  }
}

/**
 * Bulk re-assign positions in the order supplied. Used by drag-and-drop.
 *
 * Position is reassigned to `index + 1` so the result is always contiguous
 * 1-indexed regardless of the input.
 */
export async function updateActivityPositions(
  _db: SQLiteDatabase,
  activities: Activity[]
): Promise<DatabaseResult> {
  try {
    // Real write transaction so the whole reorder lands atomically (statements
    // on `txn`; see databases/writeTransaction.ts).
    await withWriteTransaction(async (txn) => {
      for (let i = 0; i < activities.length; i++) {
        const activity = activities[i];
        await txn.runAsync(
          'UPDATE activities SET position = ? WHERE id = ?',
          [i + 1, activity.id]
        );
      }
    });

    return {
      success: true,
      message: 'Activity positions updated successfully',
    };
  } catch (error) {
    console.error('Error updating activity positions:', error);
    return {
      success: false,
      message: 'Failed to update activity positions',
    };
  }
}
