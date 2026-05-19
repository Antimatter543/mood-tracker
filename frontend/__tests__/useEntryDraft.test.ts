/**
 * @jest-environment node
 *
 * Unit tests for the useEntryDraft hook. We exercise the reducer surface
 * without mounting React — by calling the hook inside a tiny test renderer
 * we get access to the returned object and can dispatch sequenced operations
 * just like the form would.
 */
import { act, create } from 'react-test-renderer';
import React from 'react';
import {
    useEntryDraft,
    validateDraft,
    EntryDraft,
    UseEntryDraft,
} from '@/components/forms/hooks/useEntryDraft';

// Capture the hook's return value into a ref-style box so each test can poke
// at it imperatively. Simpler than @testing-library/react-hooks (which isn't
// installed here) and aligns with the existing react-test-renderer setup.
function renderUseEntryDraft(init?: Parameters<typeof useEntryDraft>[0]) {
    const box: { current: UseEntryDraft | null } = { current: null };
    function Probe() {
        box.current = useEntryDraft(init);
        return null;
    }
    let tree: ReturnType<typeof create> | undefined;
    act(() => {
        tree = create(React.createElement(Probe));
    });
    return {
        get hook(): UseEntryDraft {
            if (!box.current) throw new Error('hook not initialized');
            return box.current;
        },
        unmount: () => tree?.unmount(),
    };
}

describe('validateDraft (pure)', () => {
    const baseDraft: EntryDraft = {
        mood: 5,
        activities: [],
        notes: '',
        date: new Date('2026-03-05T12:00:00Z'),
    };

    it('flags mood below 0 as invalid', () => {
        const v = validateDraft({ ...baseDraft, mood: -1 });
        expect(v.isValid).toBe(false);
        expect(v.errors.mood).toMatch(/between 0 and 10/i);
    });

    it('flags mood above 10 as invalid', () => {
        const v = validateDraft({ ...baseDraft, mood: 11 });
        expect(v.isValid).toBe(false);
        expect(v.errors.mood).toMatch(/between 0 and 10/i);
    });

    it('flags NaN mood as invalid', () => {
        const v = validateDraft({ ...baseDraft, mood: Number.NaN });
        expect(v.isValid).toBe(false);
        expect(v.errors.mood).toBeDefined();
    });

    it('accepts mood at exact boundaries (0 and 10)', () => {
        expect(validateDraft({ ...baseDraft, mood: 0 }).isValid).toBe(true);
        expect(validateDraft({ ...baseDraft, mood: 10 }).isValid).toBe(true);
    });

    it('flags invalid Date as invalid', () => {
        const v = validateDraft({ ...baseDraft, date: new Date('not-a-date') });
        expect(v.isValid).toBe(false);
        expect(v.errors.date).toBeDefined();
    });

    it('accepts a valid draft with no errors', () => {
        const v = validateDraft(baseDraft);
        expect(v.isValid).toBe(true);
        expect(Object.keys(v.errors)).toHaveLength(0);
    });
});

describe('useEntryDraft state machine', () => {
    it('uses defaults when no init is provided', () => {
        const { hook } = renderUseEntryDraft();
        expect(hook.draft.mood).toBe(5.0);
        expect(hook.draft.activities).toEqual([]);
        expect(hook.draft.notes).toBe('');
        expect(hook.draft.date).toBeInstanceOf(Date);
    });

    it('seeds the draft from init values', () => {
        const seedDate = new Date('2026-01-15T10:00:00Z');
        const { hook } = renderUseEntryDraft({
            mood: 7,
            activities: [1, 2],
            notes: 'felt great',
            date: seedDate,
        });
        expect(hook.draft.mood).toBe(7);
        expect(hook.draft.activities).toEqual([1, 2]);
        expect(hook.draft.notes).toBe('felt great');
        expect(hook.draft.date.getTime()).toBe(seedDate.getTime());
    });

    it('setMood updates only the mood field', () => {
        const r = renderUseEntryDraft({ mood: 3, notes: 'keep' });
        act(() => {
            r.hook.setMood(8.5);
        });
        expect(r.hook.draft.mood).toBe(8.5);
        expect(r.hook.draft.notes).toBe('keep');
    });

    it('toggleActivity adds when missing, removes when present', () => {
        const r = renderUseEntryDraft();
        act(() => {
            r.hook.toggleActivity(42);
        });
        expect(r.hook.draft.activities).toEqual([42]);
        act(() => {
            r.hook.toggleActivity(42);
        });
        expect(r.hook.draft.activities).toEqual([]);
    });

    it('toggleActivity preserves order of existing entries', () => {
        const r = renderUseEntryDraft({ activities: [1, 2, 3] });
        act(() => {
            r.hook.toggleActivity(2);
        });
        expect(r.hook.draft.activities).toEqual([1, 3]);
    });

    it('setActivities replaces the list (defensive copy, not aliasing)', () => {
        const r = renderUseEntryDraft();
        const external = [9, 10];
        act(() => {
            r.hook.setActivities(external);
        });
        expect(r.hook.draft.activities).toEqual([9, 10]);
        // Mutating external afterwards must not affect internal state.
        external.push(11);
        expect(r.hook.draft.activities).toEqual([9, 10]);
    });

    it('setDate updates the date field', () => {
        const r = renderUseEntryDraft();
        const newDate = new Date('2026-06-01T00:00:00Z');
        act(() => {
            r.hook.setDate(newDate);
        });
        expect(r.hook.draft.date.getTime()).toBe(newDate.getTime());
    });

    it('setNotes updates the notes field', () => {
        const r = renderUseEntryDraft();
        act(() => {
            r.hook.setNotes('a new entry');
        });
        expect(r.hook.draft.notes).toBe('a new entry');
    });

    it('reset clears state back to defaults', () => {
        const r = renderUseEntryDraft({ mood: 9, notes: 'bla', activities: [1, 2] });
        act(() => {
            r.hook.reset();
        });
        expect(r.hook.draft.mood).toBe(5);
        expect(r.hook.draft.notes).toBe('');
        expect(r.hook.draft.activities).toEqual([]);
    });

    it('reset accepts new init values', () => {
        const r = renderUseEntryDraft();
        act(() => {
            r.hook.reset({ mood: 2, notes: 'rough day' });
        });
        expect(r.hook.draft.mood).toBe(2);
        expect(r.hook.draft.notes).toBe('rough day');
    });

    it('isValid is true for a fresh draft, false after setting mood out of range', () => {
        const r = renderUseEntryDraft();
        expect(r.hook.isValid).toBe(true);
        act(() => {
            r.hook.setMood(15);
        });
        expect(r.hook.isValid).toBe(false);
    });

    it('submit invokes onSubmit with the current draft when valid', async () => {
        const r = renderUseEntryDraft({ mood: 6, activities: [1], notes: 'ok' });
        const onSubmit = jest.fn().mockResolvedValue(undefined);
        let result: any;
        await act(async () => {
            result = await r.hook.submit(onSubmit);
        });
        expect(onSubmit).toHaveBeenCalledTimes(1);
        const passed = onSubmit.mock.calls[0][0];
        expect(passed.mood).toBe(6);
        expect(passed.activities).toEqual([1]);
        expect(passed.notes).toBe('ok');
        expect(result).toEqual({ ok: true });
    });

    it('submit does NOT invoke onSubmit when the draft is invalid', async () => {
        const r = renderUseEntryDraft({ mood: -5 });
        const onSubmit = jest.fn();
        let result: any;
        await act(async () => {
            result = await r.hook.submit(onSubmit);
        });
        expect(onSubmit).not.toHaveBeenCalled();
        expect(result.ok).toBe(false);
        expect(result.errors.mood).toBeDefined();
    });

    it('submit returns { ok: false, error } when onSubmit throws', async () => {
        const r = renderUseEntryDraft();
        const onSubmit = jest.fn().mockRejectedValue(new Error('db is down'));
        let result: any;
        await act(async () => {
            result = await r.hook.submit(onSubmit);
        });
        expect(result.ok).toBe(false);
        expect((result.error as Error).message).toBe('db is down');
    });
});
