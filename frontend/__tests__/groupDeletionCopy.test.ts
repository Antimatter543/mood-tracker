/**
 * The delete-a-group warning copy (lib/groupDeletionCopy.ts).
 *
 * This string is the ONLY thing between a user and irreversibly losing activity
 * history through `ON DELETE CASCADE`, so its edge cases are pinned here:
 * unmeasured impact, a DB error (indistinguishable from "group gone" BY DESIGN),
 * an empty group, activities that no entry uses, and singular/plural agreement
 * at the 1-vs-many boundary in both counts.
 *
 * Pure function, zero React — no reanimated, no mounting, no mocks.
 */
import { describeGroupDeletion } from '@/lib/groupDeletionCopy';
import type { GroupDeletionImpact } from '@/databases/groups';

const impact = (activityCount: number, entryCount: number): GroupDeletionImpact => ({
    exists: true,
    activityCount,
    entryCount,
});

describe('describeGroupDeletion — unmeasured / unknown impact', () => {
    it('says it is still checking when impact is null (dialog opened before the count landed)', () => {
        expect(describeGroupDeletion(null)).toBe('Checking what this would delete…');
    });

    it('NEVER reassures when exists is false — that shape is also what a DB error returns', () => {
        const unknown = describeGroupDeletion({ exists: false, activityCount: 0, entryCount: 0 });
        expect(unknown).toBe('Checking what this would delete…');
        // The dangerous failure mode would be telling the user "nothing will
        // happen" when we simply could not read the database.
        expect(unknown).not.toMatch(/affects nothing/i);
        expect(unknown).not.toMatch(/empty/i);
    });
});

describe('describeGroupDeletion — empty group', () => {
    it('states the group is empty and nothing else is affected', () => {
        expect(describeGroupDeletion(impact(0, 0))).toBe(
            'This group is empty, so deleting it affects nothing else.'
        );
    });

    it('still reads as empty even if a stale entryCount somehow arrived', () => {
        // activityCount is the thing CASCADE actually destroys; with zero
        // activities there is no path to an entry, so the empty branch wins.
        expect(describeGroupDeletion(impact(0, 7))).toMatch(/empty/);
    });
});

describe('describeGroupDeletion — activities that no entry uses', () => {
    it('names the activity count and says no entries are involved', () => {
        expect(describeGroupDeletion(impact(3, 0))).toBe(
            "This permanently deletes 3 activities. They aren't used in any entries yet."
        );
    });

    it('uses the SINGULAR "activity" for exactly one', () => {
        const copy = describeGroupDeletion(impact(1, 0));
        expect(copy).toContain('1 activity.');
        expect(copy).not.toContain('1 activities');
    });
});

describe('describeGroupDeletion — activities WITH entry history (the destructive case)', () => {
    it('names BOTH counts and says the tags are gone for good', () => {
        expect(describeGroupDeletion(impact(4, 12))).toBe(
            'This permanently deletes 4 activities and removes their history from 12 entries. ' +
                'Your entries stay, but those activity tags are gone for good.'
        );
    });

    it('agrees in the singular on both counts at once', () => {
        const copy = describeGroupDeletion(impact(1, 1));
        expect(copy).toContain('1 activity ');
        expect(copy).toContain('1 entry');
        expect(copy).toContain('Your entry stays');
        expect(copy).not.toContain('activities');
        expect(copy).not.toContain('entries');
    });

    it('mixes singular activity with plural entries correctly', () => {
        const copy = describeGroupDeletion(impact(1, 5));
        expect(copy).toContain('1 activity ');
        expect(copy).toContain('5 entries');
        expect(copy).toContain('Your entries stay');
    });

    it('always states that the entries themselves survive — only the tags die', () => {
        const copy = describeGroupDeletion(impact(2, 9));
        expect(copy).toMatch(/entries stay/);
        expect(copy).toMatch(/gone for good/);
    });
});
