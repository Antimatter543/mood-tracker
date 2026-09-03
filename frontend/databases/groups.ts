import { SQLiteDatabase } from 'expo-sqlite';
import { ActivityGroup, DatabaseResult } from '@/components/types';
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
 *
 * Ordering: groups carry a user-controlled `sort_order` (migration 13).
 * `GROUP_ORDER_BY` below is the SINGLE canonical ordering clause — every
 * group read in the app must use `getActivityGroups` (or that constant) so
 * a reorder shows up everywhere at once.
 */

/**
 * The canonical display order for groups. `sort_order` is user-controlled;
 * the `id` tiebreak keeps the order deterministic when two rows share a
 * value (e.g. rows written by a pre-migration-13 backup import, which all
 * land on the column default).
 */
export const GROUP_ORDER_BY = 'ORDER BY sort_order, id';

/**
 * Every group in display order. The one read path for group lists —
 * ActivitySelector, pickers, and anything else must go through this rather
 * than issuing their own `SELECT ... FROM activity_groups`, so ordering can
 * never drift between surfaces.
 *
 * Returns `[]` on error (mirrors `getActivities`): a group list is UI-facing
 * and an empty list degrades to "no groups yet" rather than crashing a screen.
 */
export async function getActivityGroups(db: SQLiteDatabase): Promise<ActivityGroup[]> {
  try {
    return await db.getAllAsync<ActivityGroup>(
      `SELECT * FROM activity_groups ${GROUP_ORDER_BY}`
    );
  } catch (error) {
    console.error('Error fetching activity groups:', error);
    return [];
  }
}

/**
 * Insert a new group. Rejects empty/whitespace names and pre-existing
 * names (case-sensitive — matches the table's UNIQUE constraint).
 *
 * Appends to the END of the user's order (`MAX(sort_order) + 1`) rather than
 * relying on the column default, so a new group doesn't silently jump to the
 * top of the list.
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

    const orderRow = await db.getFirstAsync<{ maxOrder: number }>(
      'SELECT COALESCE(MAX(sort_order), 0) as maxOrder FROM activity_groups'
    );

    await db.runAsync(
      'INSERT INTO activity_groups (name, sort_order) VALUES (?, ?)',
      [groupName.trim(), (orderRow?.maxOrder || 0) + 1]
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
 * Rename a group in place. Activities, positions and entry history are
 * untouched — only `activity_groups.name` changes.
 *
 * Validation mirrors `addActivityGroup` (trim, reject empty, reject a name
 * already taken by ANOTHER group — case-sensitive, matching the table's
 * UNIQUE constraint) plus an existence check, so the UI gets a specific
 * message instead of a raw constraint error. Renaming a group to its own
 * current name is a legal no-op (the duplicate check excludes self).
 *
 * ONE statement, so it runs on the read connection in autocommit — same
 * convention as `addActivityGroup`'s INSERT (see databases/CLAUDE.md: the
 * write connection is for MULTI-statement writes).
 */
export async function renameActivityGroup(
  db: SQLiteDatabase,
  groupId: number,
  newName: string
): Promise<DatabaseResult> {
  try {
    const trimmed = newName.trim();

    if (!trimmed) {
      return {
        success: false,
        message: 'Group name cannot be empty',
      };
    }

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

    const duplicate = await db.getFirstAsync<{ id: number }>(
      'SELECT id FROM activity_groups WHERE name = ? AND id != ?',
      [trimmed, groupId]
    );

    if (duplicate) {
      return {
        success: false,
        message: 'A group with this name already exists',
      };
    }

    await db.runAsync(
      'UPDATE activity_groups SET name = ? WHERE id = ?',
      [trimmed, groupId]
    );

    return {
      success: true,
      message: 'Group renamed successfully',
    };
  } catch (error) {
    console.error('Error renaming activity group:', error);
    return {
      success: false,
      message: 'Failed to rename group',
    };
  }
}

/**
 * Bulk re-assign `sort_order` in the order supplied — the persistence half of
 * drag-to-reorder (mirrors `updateActivityPositions` for activities).
 *
 * `sort_order` is reassigned to `index + 1`, so the result is always a
 * contiguous 1-indexed sequence regardless of the input's prior values. ALL
 * updates land in ONE `withWriteTransaction` so a reader never sees a
 * half-applied order (statements on `txn` — see databases/writeTransaction.ts).
 */
export async function reorderActivityGroups(
  _db: SQLiteDatabase,
  groups: Pick<ActivityGroup, 'id'>[]
): Promise<DatabaseResult> {
  try {
    await withWriteTransaction(async (txn) => {
      for (let i = 0; i < groups.length; i++) {
        await txn.runAsync(
          'UPDATE activity_groups SET sort_order = ? WHERE id = ?',
          [i + 1, groups[i].id]
        );
      }
    });

    return {
      success: true,
      message: 'Group order updated successfully',
    };
  } catch (error) {
    console.error('Error reordering activity groups:', error);
    return {
      success: false,
      message: 'Failed to update group order',
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

/** What deleting a group would destroy. See `getGroupDeletionImpact`. */
export type GroupDeletionImpact = {
  exists: boolean;
  /** Activities that would be CASCADE-deleted with the group. */
  activityCount: number;
  /**
   * DISTINCT mood entries that would lose at least one activity. Counting
   * entries (not `entry_activities` rows) is what the warning copy needs:
   * "removes N activities and their history from M entries".
   */
  entryCount: number;
};

/**
 * Quantify what deleting a group destroys, so the UI can warn precisely
 * instead of hand-waving. `ON DELETE CASCADE` removes the group's activities
 * and, through them, their `entry_activities` history — the mood entries
 * themselves survive, but they permanently lose those activity tags.
 *
 * Returns zeros with `exists: false` on DB error — same shape as the "group
 * not found" case, deliberately: callers gate destructive UI on this, and a
 * DB hiccup should read as "can't confirm, don't proceed" rather than throw.
 */
export async function getGroupDeletionImpact(
  db: SQLiteDatabase,
  groupId: number
): Promise<GroupDeletionImpact> {
  try {
    const group = await db.getFirstAsync<{ id: number }>(
      'SELECT id FROM activity_groups WHERE id = ?',
      [groupId]
    );

    if (!group) {
      return { exists: false, activityCount: 0, entryCount: 0 };
    }

    // Entry count is queried BEFORE the activity count, preserving the query
    // ORDER this function inherited from `checkGroupHasEntries` (existence →
    // entries). Unit tests drive the expo-sqlite mock by call order, so keeping
    // that order keeps the historic `checkGroupHasEntries` contract tests
    // meaningful rather than silently re-pointing them at a different query.
    const entryRow = await db.getFirstAsync<{ count: number }>(
      `SELECT COUNT(DISTINCT ea.entry_id) as count
       FROM entry_activities ea
       JOIN activities a ON ea.activity_id = a.id
       WHERE a.group_id = ?`,
      [groupId]
    );

    const activityRow = await db.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) as count FROM activities WHERE group_id = ?',
      [groupId]
    );

    return {
      exists: true,
      // COUNT always returns a row, but the rows are typed nullable — coerce
      // defensively rather than letting `undefined` reach the warning copy.
      activityCount: activityRow?.count ?? 0,
      entryCount: entryRow?.count ?? 0,
    };
  } catch (error) {
    console.error('Error measuring group deletion impact:', error);
    return { exists: false, activityCount: 0, entryCount: 0 };
  }
}

/**
 * Inspect a group: does it exist, and does it have any mood entries
 * linked through its activities?
 *
 * Thin boolean view over `getGroupDeletionImpact` (kept because callers that
 * only need the yes/no gate read better with it, and its error contract is
 * relied upon). Returns `{ exists: false, hasEntries: false }` on DB error —
 * same shape as the "group not found" case. This is intentional: callers want
 * a single boolean to gate UI ("can the user delete this group without losing
 * entries?"), and surfacing a DB hiccup as "yeah it has entries" is the safer
 * default than throwing or returning `null` and forcing every caller to add
 * error-handling.
 */
export async function checkGroupHasEntries(
  db: SQLiteDatabase,
  groupId: number
): Promise<{ exists: boolean; hasEntries: boolean }> {
  const impact = await getGroupDeletionImpact(db, groupId);
  return {
    exists: impact.exists,
    hasEntries: impact.exists && impact.entryCount > 0,
  };
}
