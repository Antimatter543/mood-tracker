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
 * Move ONE activity into another group.
 *
 * What is deliberately NOT touched: `entry_activities`. Those rows key on
 * `activity_id`, so every mood entry that ever tagged this activity keeps that
 * tag — moving an activity between groups is a pure re-filing, never a history
 * rewrite. (Verified by an integration test, not just by reading this comment.)
 *
 * Validation is up front, on the read connection, so the caller gets a specific
 * message instead of a raw UNIQUE-constraint error:
 *  - activity must exist,
 *  - target group must exist,
 *  - the name must be free in the target group (`UNIQUE(name, group_id)`).
 * Moving to the group it's already in is a legal no-op.
 *
 * The write is multi-statement (re-file + append position + compact the source
 * group's positions), so it runs in ONE `withWriteTransaction` — statements on
 * `txn` only (see databases/writeTransaction.ts). Positions stay contiguous and
 * 1-indexed in BOTH groups, matching `deleteActivity`'s compaction contract.
 */
export async function moveActivityToGroup(
  db: SQLiteDatabase,
  activityId: number,
  targetGroupId: number
): Promise<DatabaseResult> {
  try {
    const activity = await db.getFirstAsync<{
      name: string;
      group_id: number;
      position: number;
    }>('SELECT name, group_id, position FROM activities WHERE id = ?', [activityId]);

    if (!activity) {
      return {
        success: false,
        message: 'Activity not found',
      };
    }

    if (activity.group_id === targetGroupId) {
      return {
        success: true,
        message: 'Activity is already in this group',
      };
    }

    const targetGroup = await db.getFirstAsync<{ id: number }>(
      'SELECT id FROM activity_groups WHERE id = ?',
      [targetGroupId]
    );

    if (!targetGroup) {
      return {
        success: false,
        message: 'Target group not found',
      };
    }

    const nameClash = await db.getFirstAsync<{ id: number }>(
      'SELECT id FROM activities WHERE name = ? AND group_id = ?',
      [activity.name, targetGroupId]
    );

    if (nameClash) {
      return {
        success: false,
        message: 'An activity with this name already exists in that group',
      };
    }

    const maxRow = await db.getFirstAsync<{ maxPosition: number }>(
      `SELECT COALESCE(MAX(position), 0) as maxPosition
       FROM activities
       WHERE group_id = ?`,
      [targetGroupId]
    );

    const nextPosition = (maxRow?.maxPosition || 0) + 1;

    await withWriteTransaction(async (txn) => {
      await txn.runAsync(
        'UPDATE activities SET group_id = ?, position = ? WHERE id = ?',
        [targetGroupId, nextPosition, activityId]
      );

      // Close the gap the move left behind in the SOURCE group.
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
      message: 'Activity moved successfully',
    };
  } catch (error) {
    console.error('Error moving activity to group:', error);
    return {
      success: false,
      message: 'Failed to move activity',
    };
  }
}

/**
 * Move EVERY activity out of one group into another — the safe alternative
 * offered before a destructive group delete ("move these somewhere first").
 *
 * Name clashes are SKIPPED, not fatal: `UNIQUE(name, group_id)` means an
 * activity whose name already exists in the target can't be moved, and aborting
 * the whole batch over one collision would strand the user. The skipped names
 * come back in the result so the UI can say exactly what stayed behind (and the
 * delete warning, re-measured afterwards, then shows the real remaining cost).
 *
 * One transaction for the whole batch: either the moves land together or none
 * do. Positions are appended after the target group's existing tail and the
 * source group is left empty (nothing to compact — everything movable left).
 */
export async function moveActivitiesToGroup(
  db: SQLiteDatabase,
  fromGroupId: number,
  toGroupId: number
): Promise<DatabaseResult & { moved: number; skipped: string[] }> {
  const fail = (message: string) => ({ success: false, message, moved: 0, skipped: [] });

  try {
    if (fromGroupId === toGroupId) {
      return fail('Pick a different group to move these activities into');
    }

    const targetGroup = await db.getFirstAsync<{ id: number }>(
      'SELECT id FROM activity_groups WHERE id = ?',
      [toGroupId]
    );

    if (!targetGroup) {
      return fail('Target group not found');
    }

    const sourceActivities = await db.getAllAsync<{ id: number; name: string }>(
      'SELECT id, name FROM activities WHERE group_id = ? ORDER BY position',
      [fromGroupId]
    );

    const targetNames = await db.getAllAsync<{ name: string }>(
      'SELECT name FROM activities WHERE group_id = ?',
      [toGroupId]
    );
    const taken = new Set(targetNames.map((row) => row.name));

    const movable = sourceActivities.filter((a) => !taken.has(a.name));
    const skipped = sourceActivities.filter((a) => taken.has(a.name)).map((a) => a.name);

    if (movable.length === 0) {
      return {
        success: false,
        message: skipped.length
          ? 'Every activity in this group shares a name with one in the target group'
          : 'This group has no activities to move',
        moved: 0,
        skipped,
      };
    }

    const maxRow = await db.getFirstAsync<{ maxPosition: number }>(
      `SELECT COALESCE(MAX(position), 0) as maxPosition
       FROM activities
       WHERE group_id = ?`,
      [toGroupId]
    );
    const basePosition = maxRow?.maxPosition || 0;

    await withWriteTransaction(async (txn) => {
      for (let i = 0; i < movable.length; i++) {
        await txn.runAsync(
          'UPDATE activities SET group_id = ?, position = ? WHERE id = ?',
          [toGroupId, basePosition + i + 1, movable[i].id]
        );
      }
    });

    return {
      success: true,
      message: `Moved ${movable.length} ${movable.length === 1 ? 'activity' : 'activities'}`,
      moved: movable.length,
      skipped,
    };
  } catch (error) {
    console.error('Error moving activities between groups:', error);
    return fail('Failed to move activities');
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
