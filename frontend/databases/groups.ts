import { SQLiteDatabase } from 'expo-sqlite';
import { DatabaseResult } from '@/components/types';
import { withWriteTransaction } from '@/databases/writeTransaction';

/**
 * CRUD for activity groups.
 *
 * Error-handling convention used here: every function returns a structured
 * result on the happy path AND on expected error paths (DB throws,
 * validation failures). Nothing in this module throws to the caller — the
 * UI layer is expected to switch on `success` rather than try/catch.
 * `checkGroupHasEntries` returns the same `{ exists, hasEntries }` shape
 * on DB error so callers can use a single branch.
 */

/**
 * Insert a new group. Rejects empty/whitespace names and pre-existing
 * names (case-sensitive — matches the table's UNIQUE constraint).
 */
export async function addActivityGroup(
  db: SQLiteDatabase,
  groupName: string
): Promise<DatabaseResult> {
  try {
    if (!groupName.trim()) {
      return {
        success: false,
        message: 'Group name cannot be empty',
      };
    }

    const existingGroup = await db.getFirstAsync<{ id: number }>(
      'SELECT id FROM activity_groups WHERE name = ?',
      [groupName.trim()]
    );

    if (existingGroup) {
      return {
        success: false,
        message: 'A group with this name already exists',
      };
    }

    await db.runAsync(
      'INSERT INTO activity_groups (name) VALUES (?)',
      [groupName.trim()]
    );

    return {
      success: true,
      message: 'Group added successfully',
    };
  } catch (error) {
    console.error('Error adding activity group:', error);
    return {
      success: false,
      message: 'Failed to add group',
    };
  }
}

/**
 * Delete a group. ON DELETE CASCADE on `activities.group_id` removes all
 * activities in the group, which in turn cascades to `entry_activities`.
 *
 * The transaction is technically unnecessary for a single DELETE, but
 * it's preserved so a future "soft delete" or "audit-log row" addition
 * stays atomic without restructuring.
 */
export async function deleteActivityGroup(
  db: SQLiteDatabase,
  groupId: number
): Promise<DatabaseResult> {
  try {
    const group = await db.getFirstAsync<{ id: number }>(
      'SELECT id FROM activity_groups WHERE id = ?',
      [groupId]
    );

    if (!group) {
      return {
        success: false,
        message: 'Activity group not found',
      };
    }

    // Real write transaction on the write connection (statement on `txn`). The
    // cascade that removes the group's activities (and, through them,
    // entry_activities rows) only fires because the write connection has
    // foreign_keys = ON. See databases/writeTransaction.ts.
    await withWriteTransaction(async (txn) => {
      // CASCADE handles activities + entry_activities.
      await txn.runAsync('DELETE FROM activity_groups WHERE id = ?', [groupId]);
    });

    return {
      success: true,
      message: 'Activity group deleted successfully',
    };
  } catch (error) {
    console.error('Error deleting activity group:', error);
    return {
      success: false,
      message: 'Failed to delete activity group',
    };
  }
}

/**
 * Inspect a group: does it exist, and does it have any mood entries
 * linked through its activities?
 *
 * Returns `{ exists: false, hasEntries: false }` on DB error — same shape
 * as the "group not found" case. This is intentional: callers want a
 * single boolean to gate UI ("can the user delete this group without
 * losing entries?"), and surfacing a DB hiccup as "yeah it has entries"
 * is the safer default than throwing or returning `null` and forcing
 * every caller to add error-handling.
 */
export async function checkGroupHasEntries(
  db: SQLiteDatabase,
  groupId: number
): Promise<{ exists: boolean; hasEntries: boolean }> {
  try {
    const group = await db.getFirstAsync<{ id: number }>(
      'SELECT id FROM activity_groups WHERE id = ?',
      [groupId]
    );

    if (!group) {
      return {
        exists: false,
        hasEntries: false,
      };
    }

    const entriesCount = await db.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) as count
       FROM entry_activities ea
       JOIN activities a ON ea.activity_id = a.id
       WHERE a.group_id = ?`,
      [groupId]
    );

    return {
      exists: true,
      // Coerce to a plain boolean. `entriesCount` is nullable but
      // COUNT(*) always returns a row, so this should be safe in practice.
      hasEntries: !!(entriesCount && entriesCount.count > 0),
    };
  } catch (error) {
    console.error('Error checking group entries:', error);
    // Consistent shape on error — see fn docs.
    return {
      exists: false,
      hasEntries: false,
    };
  }
}
