/**
 * lib/groupDeletionCopy.ts
 *
 * The wording of the "deleting this group destroys X" warning, as a PURE
 * function with no React and no runtime imports (the impact type is imported
 * `type`-only, so it is erased at compile time).
 *
 * It lives here rather than inside the dialog component for the reason the
 * project already learned once for icon registries (tasks/lessons.md,
 * 2026-06-13): a lightweight consumer — here, its own test — should not have to
 * transitively drag in reanimated just to check a string.
 *
 * This copy is the ONLY thing between a user and irreversibly losing activity
 * history, so every edge case (empty group, activities that are unused,
 * singular vs plural, impact not yet measured) is pinned down by tests.
 */

import type { GroupDeletionImpact } from '@/databases/groups';

export function describeGroupDeletion(impact: GroupDeletionImpact | null): string {
    // `exists: false` is ALSO what a DB error returns (see getGroupDeletionImpact)
    // — deliberately indistinguishable, because both mean "we cannot promise
    // what this would destroy", and that must never render as a reassuring
    // "nothing will happen".
    if (!impact || !impact.exists) {
        return 'Checking what this would delete…';
    }

    const { activityCount, entryCount } = impact;

    if (activityCount === 0) {
        return 'This group is empty, so deleting it affects nothing else.';
    }

    const activities = `${activityCount} ${activityCount === 1 ? 'activity' : 'activities'}`;

    if (entryCount === 0) {
        return `This permanently deletes ${activities}. They aren't used in any entries yet.`;
    }

    const entries = `${entryCount} ${entryCount === 1 ? 'entry' : 'entries'}`;
    const survivors = entryCount === 1 ? 'Your entry stays' : 'Your entries stay';

    return `This permanently deletes ${activities} and removes their history from ${entries}. ${survivors}, but those activity tags are gone for good.`;
}
