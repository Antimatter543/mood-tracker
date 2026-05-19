import { useCallback, useMemo, useState } from 'react';

/**
 * Shape of an in-progress entry draft. Mirrors the persisted form payload that
 * `EntryForm` eventually hands to `addMoodEntry`. Kept separate from the DB
 * row type so we never accidentally feed UI-only state to SQL.
 */
export type EntryDraft = {
    mood: number;
    activities: number[];
    notes: string;
    date: Date;
};

export type EntryDraftInit = Partial<EntryDraft>;

/** Validation result surfaced to the UI so it can show inline errors. */
export type EntryDraftValidation = {
    isValid: boolean;
    /** Map of field name -> human-readable error. Only populated when invalid. */
    errors: Partial<Record<keyof EntryDraft, string>>;
};

const DEFAULT_DRAFT: EntryDraft = {
    mood: 5.0,
    activities: [],
    notes: '',
    date: new Date(0), // placeholder; replaced in init
};

/**
 * Build a fresh draft, layering caller-supplied overrides on top of defaults.
 * Always returns a NEW Date instance so consumers can mutate freely.
 */
function buildInitialDraft(init?: EntryDraftInit): EntryDraft {
    return {
        mood: init?.mood ?? DEFAULT_DRAFT.mood,
        activities: init?.activities ? [...init.activities] : [],
        notes: init?.notes ?? '',
        date: init?.date ? new Date(init.date) : new Date(),
    };
}

/**
 * Validate a draft against the same rules `addMoodEntry` enforces server-side
 * (mood ∈ [0,10], finite number). We surface validation in the UI so users
 * don't submit and *then* see a generic DB error — they see "Mood must be
 * between 0 and 10" before the submit button fires.
 */
export function validateDraft(draft: EntryDraft): EntryDraftValidation {
    const errors: EntryDraftValidation['errors'] = {};

    if (
        typeof draft.mood !== 'number' ||
        Number.isNaN(draft.mood) ||
        !Number.isFinite(draft.mood)
    ) {
        errors.mood = 'Mood must be a number';
    } else if (draft.mood < 0 || draft.mood > 10) {
        errors.mood = 'Mood must be between 0 and 10';
    }

    if (!(draft.date instanceof Date) || Number.isNaN(draft.date.getTime())) {
        errors.date = 'Invalid date';
    }

    // Notes can be empty; activities can be empty. No errors required.

    return {
        isValid: Object.keys(errors).length === 0,
        errors,
    };
}

/**
 * Hook returned object — kept reducer-flat (one setter per field, plus a
 * single `submit`) so unit tests don't need to drive a React component to
 * exercise validation/dispatch paths.
 */
export type UseEntryDraft = {
    draft: EntryDraft;
    setMood: (mood: number) => void;
    setNotes: (notes: string) => void;
    /** Toggle an activity in/out of the selected set. Idempotent on the value. */
    toggleActivity: (activityId: number) => void;
    setActivities: (activities: number[]) => void;
    setDate: (date: Date) => void;
    validation: EntryDraftValidation;
    isValid: boolean;
    reset: (init?: EntryDraftInit) => void;
    /**
     * Validate and hand off to `onSubmit`. Returns:
     *   - `{ ok: true }` on successful submission
     *   - `{ ok: false, errors }` if validation fails (onSubmit is NOT called)
     *   - `{ ok: false, error }` if onSubmit throws
     */
    submit: (
        onSubmit: (draft: EntryDraft) => Promise<void>
    ) => Promise<
        | { ok: true }
        | { ok: false; errors: EntryDraftValidation['errors'] }
        | { ok: false; error: unknown }
    >;
};

/**
 * useEntryDraft — reducer-style form state for the entry form.
 *
 * Split out of `EntryForm` so we can unit-test the state machine without
 * mounting a React tree. The component stays focused on rendering and just
 * wires hook outputs to children.
 */
export function useEntryDraft(init?: EntryDraftInit): UseEntryDraft {
    const [draft, setDraft] = useState<EntryDraft>(() => buildInitialDraft(init));

    const setMood = useCallback((mood: number) => {
        setDraft(prev => ({ ...prev, mood }));
    }, []);

    const setNotes = useCallback((notes: string) => {
        setDraft(prev => ({ ...prev, notes }));
    }, []);

    const setActivities = useCallback((activities: number[]) => {
        setDraft(prev => ({ ...prev, activities: [...activities] }));
    }, []);

    const toggleActivity = useCallback((activityId: number) => {
        setDraft(prev => ({
            ...prev,
            activities: prev.activities.includes(activityId)
                ? prev.activities.filter(id => id !== activityId)
                : [...prev.activities, activityId],
        }));
    }, []);

    const setDate = useCallback((date: Date) => {
        setDraft(prev => ({ ...prev, date }));
    }, []);

    const reset = useCallback((nextInit?: EntryDraftInit) => {
        setDraft(buildInitialDraft(nextInit));
    }, []);

    const validation = useMemo(() => validateDraft(draft), [draft]);

    const submit: UseEntryDraft['submit'] = useCallback(
        async (onSubmit) => {
            const v = validateDraft(draft);
            if (!v.isValid) {
                return { ok: false, errors: v.errors } as const;
            }
            try {
                await onSubmit(draft);
                return { ok: true } as const;
            } catch (error) {
                return { ok: false, error } as const;
            }
        },
        [draft]
    );

    return {
        draft,
        setMood,
        setNotes,
        toggleActivity,
        setActivities,
        setDate,
        validation,
        isValid: validation.isValid,
        reset,
        submit,
    };
}
