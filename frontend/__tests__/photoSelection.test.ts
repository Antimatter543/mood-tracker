/**
 * Unit tests for selectPhotosToAdd — the pure cap/dedupe decision behind
 * multi-photo selection in the entry form (Task 2). The bug it fixes: the
 * library picker only ever attached one photo (allowsMultipleSelection: false +
 * reading result.assets[0]). The picker is now multi-select, and this helper
 * enforces the MAX_PHOTOS cap + dedupe in code (selectionLimit is best-effort on
 * Android, so the cap can't be trusted to the OS).
 */
import { selectPhotosToAdd } from '@/components/forms/photoSelection';

const MAX = 5;

describe('selectPhotosToAdd', () => {
    it('returns nothing for an empty pick', () => {
        expect(selectPhotosToAdd([], [], MAX)).toEqual({ toAdd: [], limitHit: false });
        expect(selectPhotosToAdd(['a'], [], MAX)).toEqual({ toAdd: [], limitHit: false });
    });

    it('adds all picks when comfortably under the limit', () => {
        const r = selectPhotosToAdd([], ['a', 'b', 'c'], MAX);
        expect(r.toAdd).toEqual(['a', 'b', 'c']);
        expect(r.limitHit).toBe(false);
    });

    it('adds all picks when they exactly fill the remaining slots (NOT a limit hit)', () => {
        // 2 already + 3 picked = 5 = MAX exactly.
        const r = selectPhotosToAdd(['x', 'y'], ['a', 'b', 'c'], MAX);
        expect(r.toAdd).toEqual(['a', 'b', 'c']);
        expect(r.limitHit).toBe(false);
    });

    it('caps to the remaining slots and flags limitHit when over', () => {
        // 3 already, 4 picked, only 2 slots left -> take first 2, flag limit.
        const r = selectPhotosToAdd(['x', 'y', 'z'], ['a', 'b', 'c', 'd'], MAX);
        expect(r.toAdd).toEqual(['a', 'b']);
        expect(r.limitHit).toBe(true);
    });

    it('adds nothing and flags limitHit when already full', () => {
        const r = selectPhotosToAdd(['1', '2', '3', '4', '5'], ['a', 'b'], MAX);
        expect(r.toAdd).toEqual([]);
        expect(r.limitHit).toBe(true);
    });

    it('drops picks that are already attached (dedupe vs current)', () => {
        // 'a' is already attached; only 'b' and 'c' are new.
        const r = selectPhotosToAdd(['a'], ['a', 'b', 'c'], MAX);
        expect(r.toAdd).toEqual(['b', 'c']);
        expect(r.limitHit).toBe(false);
    });

    it('dedupes repeats within the picked batch (first-seen order)', () => {
        const r = selectPhotosToAdd([], ['a', 'b', 'a', 'c', 'b'], MAX);
        expect(r.toAdd).toEqual(['a', 'b', 'c']);
        expect(r.limitHit).toBe(false);
    });

    it('does not count already-attached duplicates toward the limit', () => {
        // 4 attached; user re-picks one of them + 1 genuinely new. The dup is
        // dropped (not new), leaving 1 new pick that fits the 1 remaining slot.
        const r = selectPhotosToAdd(['1', '2', '3', '4'], ['3', 'new'], MAX);
        expect(r.toAdd).toEqual(['new']);
        expect(r.limitHit).toBe(false);
    });

    it('flags limitHit on new picks even when some picks were already-attached dups', () => {
        // 4 attached (1 slot left). User picks an existing dup + 2 new -> the dup
        // drops, 2 new remain but only 1 fits -> first new added, limit hit.
        const r = selectPhotosToAdd(['1', '2', '3', '4'], ['2', 'newA', 'newB'], MAX);
        expect(r.toAdd).toEqual(['newA']);
        expect(r.limitHit).toBe(true);
    });
});
