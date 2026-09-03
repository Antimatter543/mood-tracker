/**
 * lib/reminders.ts
 *
 * The reminder LIST model: types, validation, (de)serialization and pure CRUD.
 *
 * A user can configure several named reminders ("Morning check-in", "Evening
 * reflection", ...), each with its own time and enabled flag. The list is stored
 * as ONE JSON string in the `reminders` key of the `user_settings` KV table (see
 * databases/settings.ts + migration 14), because:
 *   - it is settings-shaped data: tiny, capped, read whole, never joined/queried;
 *   - SettingsContext already reloads + re-renders on every settings write, so
 *     editing a reminder automatically re-arms the schedule (NotificationReArm
 *     keys off `settings.reminders`) with no second reactive data path.
 *
 * Because the stored value is a free-form string, EVERY function here treats it
 * as untrusted input: `parseReminders` is total (never throws, never returns
 * junk) and the CRUD helpers re-validate. That is the price of a JSON blob in a
 * KV cell, and it is paid in one place, under test.
 *
 * Everything in this module is PURE — no native modules, no DB, no clock reads
 * except where a caller passes them in. That keeps the whole model unit-testable
 * without a native build.
 */

/** Hard cap on how many reminders a user may configure. */
export const MAX_REMINDERS = 10;

/** Fallback time used whenever a stored/typed time is unusable. */
export const DEFAULT_REMINDER_TIME = '20:00';

/** Label shown for a reminder the user never named. */
export const DEFAULT_REMINDER_LABEL = 'Reminder';

/** Labels are user-typed; clamp so one can't blow out the row / notification. */
export const REMINDER_LABEL_MAX_LENGTH = 40;

/**
 * Label given to the single pre-existing daily reminder when an upgrading user's
 * legacy `reminder_enabled` / `reminder_time` settings are folded into the list.
 * Referenced by migration 14 — changing it changes what upgraders see.
 */
export const LEGACY_REMINDER_LABEL = 'Daily reminder';

export interface Reminder {
    /** Stable within the list; derives the OS notification identifier. */
    id: string;
    /** User-facing name, e.g. "Morning check-in". May be empty. */
    label: string;
    /** 24-hour local "HH:MM". Always normalized on the way in. */
    time: string;
    enabled: boolean;
}

/** The fields a caller may supply when creating/editing a reminder. */
export type ReminderDraft = Partial<Pick<Reminder, 'label' | 'time' | 'enabled'>>;

// ─── Validation / normalization ───────────────────────────────────────────────

/**
 * Strict "HH:MM" 24-hour check. Deliberately stricter than
 * `notifications.parseReminderTime` (which is lenient by design for legacy
 * values): this is what the UI and storage layers validate against, so the
 * canonical stored form is always zero-padded.
 */
export function isValidReminderTime(time: unknown): time is string {
    if (typeof time !== 'string') return false;
    const match = time.match(/^(\d{2}):(\d{2})$/);
    if (!match) return false;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

/**
 * Coerce any input into a canonical "HH:MM". Accepts a lenient single-digit hour
 * ("9:05" — the shape migration 4's legacy value could technically hold) and
 * falls back to DEFAULT_REMINDER_TIME for anything out of range or unparseable.
 */
export function normalizeReminderTime(time: unknown): string {
    if (typeof time !== 'string') return DEFAULT_REMINDER_TIME;
    const match = time.trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return DEFAULT_REMINDER_TIME;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return DEFAULT_REMINDER_TIME;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** Trim + clamp a user-typed label. Non-strings collapse to ''. */
export function sanitizeReminderLabel(label: unknown): string {
    if (typeof label !== 'string') return '';
    return label.trim().slice(0, REMINDER_LABEL_MAX_LENGTH);
}

/** What to show for a reminder with no label of its own. */
export function reminderDisplayLabel(reminder: Reminder): string {
    return reminder.label.trim() || DEFAULT_REMINDER_LABEL;
}

// ─── Identity ─────────────────────────────────────────────────────────────────

const ID_PREFIX = 'reminder-';

/**
 * Next free id for `list`: `reminder-<n>` where n is one past the highest numeric
 * suffix in use. Deterministic (no clock, no randomness) so it is trivially
 * testable, and unique WITHIN the list, which is all the id has to be — the
 * identifier is local-notification scoped, never a security token.
 *
 * A number freed by a deletion can be reused later; that is safe because every
 * re-arm cancels and re-schedules by identifier, so the slot always carries the
 * current reminder's content.
 */
export function makeReminderId(list: readonly Reminder[]): string {
    let max = 0;
    for (const r of list) {
        if (!r.id.startsWith(ID_PREFIX)) continue;
        const n = Number(r.id.slice(ID_PREFIX.length));
        if (Number.isInteger(n) && n > max) max = n;
    }
    return `${ID_PREFIX}${max + 1}`;
}

// ─── (De)serialization ────────────────────────────────────────────────────────

/**
 * Parse the stored JSON into a valid reminder list. TOTAL function: any failure
 * mode degrades to the closest usable value rather than throwing, because the
 * input is a free-form settings string that a bad write, a downgrade, or a
 * hand-edited DB could corrupt — and a settings screen must never crash.
 *
 *   - not a string / not JSON / not an array  -> []
 *   - element not an object, or with no usable id -> dropped
 *   - duplicate id                            -> first wins, rest dropped
 *   - invalid time                            -> DEFAULT_REMINDER_TIME
 *   - missing/odd label or enabled            -> '' / false
 *   - more than MAX_REMINDERS entries         -> truncated to the cap
 *
 * Unknown extra fields are ignored (so a future `days` mask can be added without
 * breaking older parsers).
 */
export function parseReminders(raw: unknown): Reminder[] {
    if (typeof raw !== 'string' || raw.trim() === '') return [];

    let decoded: unknown;
    try {
        decoded = JSON.parse(raw);
    } catch {
        return [];
    }
    if (!Array.isArray(decoded)) return [];

    const out: Reminder[] = [];
    const seen = new Set<string>();

    for (const item of decoded) {
        if (typeof item !== 'object' || item === null) continue;
        const candidate = item as Record<string, unknown>;
        const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push({
            id,
            label: sanitizeReminderLabel(candidate.label),
            time: normalizeReminderTime(candidate.time),
            enabled: candidate.enabled === true,
        });
        if (out.length >= MAX_REMINDERS) break;
    }

    return out;
}

/** Serialize a list for storage. Only the known fields are written. */
export function serializeReminders(list: readonly Reminder[]): string {
    return JSON.stringify(
        list.map(({ id, label, time, enabled }) => ({ id, label, time, enabled }))
    );
}

// ─── Pure CRUD ────────────────────────────────────────────────────────────────

/** Whether another reminder may be added (the UI disables Add when false). */
export function canAddReminder(list: readonly Reminder[]): boolean {
    return list.length < MAX_REMINDERS;
}

/**
 * Append a reminder built from `draft`. At the cap this is a no-op that returns
 * the SAME array reference — callers gate on `canAddReminder`, so the refusal is
 * unreachable from the UI, but storage can never exceed MAX_REMINDERS even if a
 * caller forgets.
 */
export function addReminder(list: readonly Reminder[], draft: ReminderDraft = {}): Reminder[] {
    if (!canAddReminder(list)) return list as Reminder[];
    const reminder: Reminder = {
        id: makeReminderId(list),
        label: sanitizeReminderLabel(draft.label),
        time: normalizeReminderTime(draft.time ?? DEFAULT_REMINDER_TIME),
        enabled: draft.enabled ?? true,
    };
    return [...list, reminder];
}

/**
 * Apply `patch` to the reminder with `id`. Unknown id -> the SAME array
 * reference (nothing to update). Patched fields are re-validated, so an invalid
 * time can never reach storage.
 */
export function updateReminder(
    list: readonly Reminder[],
    id: string,
    patch: ReminderDraft
): Reminder[] {
    if (!list.some(r => r.id === id)) return list as Reminder[];
    return list.map(r =>
        r.id === id
            ? {
                  ...r,
                  ...(patch.label !== undefined && { label: sanitizeReminderLabel(patch.label) }),
                  ...(patch.time !== undefined && { time: normalizeReminderTime(patch.time) }),
                  ...(patch.enabled !== undefined && { enabled: patch.enabled === true }),
              }
            : r
    );
}

/** Remove the reminder with `id`. Unknown id -> the SAME array reference. */
export function removeReminder(list: readonly Reminder[], id: string): Reminder[] {
    if (!list.some(r => r.id === id)) return list as Reminder[];
    return list.filter(r => r.id !== id);
}

/** Only the reminders that should actually be armed. */
export function enabledReminders(list: readonly Reminder[]): Reminder[] {
    return list.filter(r => r.enabled);
}

/**
 * Display order: earliest time first, ties broken by id so the order is stable
 * (Array.prototype.sort is only guaranteed stable for the same comparator, and
 * an explicit tiebreak documents the intent).
 */
export function sortRemindersByTime(list: readonly Reminder[]): Reminder[] {
    return [...list].sort((a, b) => a.time.localeCompare(b.time) || a.id.localeCompare(b.id));
}

// ─── Legacy single-reminder migration ─────────────────────────────────────────

/**
 * Build the initial list for a user upgrading from the single daily reminder.
 * ALWAYS returns exactly one reminder so no state is lost: a user who had the
 * reminder OFF keeps their configured time, disabled, instead of the row
 * silently disappearing.
 *
 * Used by migration 14 (databases/migrations.ts) and by nothing else — keep it
 * here (pure, tested) rather than inline in the migration.
 */
export function legacyReminderToList(
    enabled: unknown,
    time: unknown
): Reminder[] {
    return [
        {
            id: `${ID_PREFIX}1`,
            label: LEGACY_REMINDER_LABEL,
            time: normalizeReminderTime(time),
            // The legacy value is stored as the STRING 'true'/'false' in
            // user_settings (SettingsContext coerces on read), so accept both.
            enabled: enabled === true || enabled === 'true',
        },
    ];
}
