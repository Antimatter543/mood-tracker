/**
 * Distress wipe: WHAT it erases, pure (unit-tested in __tests__/distressScope.test.ts).
 *
 * Stored in user_settings as `distress_wipe_scope`, a JSON {category: bool}
 * (default: every category on). Device-only: never restored from a backup.
 *
 * WHEN it fires: when the distress PIN is typed (context/AppLock.tsx).
 *
 * By default every logged day keeps its date, time and mood score and its
 * links to the default activities: that is what keeps the journal believable.
 * Two categories that are OFF by default (OFF_BY_DEFAULT) remove those too.
 */

export const DISTRESS_CATEGORIES = [
    'notes',
    'photos',
    'stars',
    'customActivities',
    'recycleBin',
    'health',
    'reminderNames',
    'backupKey',
    'leftoverFiles',
    // Off by default: together with everything above they empty the journal
    // completely, like a fresh install.
    'defaultActivityLinks',
    'entries',
] as const;
export type DistressCategory = (typeof DISTRESS_CATEGORIES)[number];
export type DistressScope = Record<DistressCategory, boolean>;

/**
 * Categories that are OFF by default. They remove what makes the journal look
 * real (the default activities of each day, or every entry and score), so they
 * are only for someone who would rather show an empty app.
 */
export const OFF_BY_DEFAULT: readonly DistressCategory[] = ['defaultActivityLinks', 'entries'];

/** The default: erase everything private, keep a believable journal. */
export const DEFAULT_DISTRESS_SCOPE: DistressScope = Object.fromEntries(
    DISTRESS_CATEGORIES.map(c => [c, !OFF_BY_DEFAULT.includes(c)])
) as DistressScope;

/** Settings copy for each category, in display order. */
export const DISTRESS_CATEGORY_COPY: Record<DistressCategory, { label: string; detail: string }> = {
    notes: { label: 'Notes', detail: 'The text of every entry' },
    photos: { label: 'Photos', detail: 'Attached photos, from the app and from storage' },
    stars: { label: 'Stars', detail: 'Which entries you starred' },
    customActivities: {
        label: 'Your own activities and groups',
        detail: 'Everything you created or renamed, and its use on each day',
    },
    recycleBin: { label: 'Recycle bin', detail: 'Entries you deleted that are still kept for 30 days' },
    health: { label: 'Health data', detail: 'Sleep and heart data; Health Connect sync turns off' },
    reminderNames: { label: 'Reminder names', detail: 'Times and on/off stay' },
    backupKey: {
        label: 'Saved backup key',
        detail: 'Without it, encrypted backups need the password again; backup encryption turns off',
    },
    leftoverFiles: {
        label: 'Leftover backup files and caches',
        detail: 'Backup copies and picker files the app left in its own storage',
    },
    defaultActivityLinks: {
        label: 'Default activities on each day',
        detail: 'Off by default. Each day keeps only its mood score',
    },
    entries: {
        label: 'All entries and mood scores',
        detail: 'Off by default. The journal is empty afterwards, like a fresh install',
    },
};

/**
 * The "always kept" line under the switches, for the current selection. Settings
 * outside the journal (display, app lock, the default activity catalogue) always stay.
 */
export function keptSummary(scope: DistressScope): string {
    if (scope.entries) {
        return 'Kept: your display settings, the app lock and the default activity list. The journal itself is emptied, like a fresh install.';
    }
    if (scope.defaultActivityLinks) {
        return 'Kept: every logged day with its date, time and mood score, your display settings and the app lock.';
    }
    return 'Kept: every logged day with its date, time, mood score and default activities, your display settings and the app lock.';
}

/** Whether a selection is exactly the recommended default. */
export function isDefaultScope(scope: DistressScope): boolean {
    return DISTRESS_CATEGORIES.every(c => scope[c] === DEFAULT_DISTRESS_SCOPE[c]);
}

/** Labels of the categories a scope erases, in display order. */
export function erasedCategoryLabels(scope: DistressScope): string[] {
    return DISTRESS_CATEGORIES.filter(c => scope[c]).map(c => DISTRESS_CATEGORY_COPY[c].label);
}

/** Read a stored scope. Missing or broken keys fall back to the default (erase). */
export function parseDistressScope(raw: unknown): DistressScope {
    let parsed: unknown = null;
    if (typeof raw === 'string' && raw.trim()) {
        try {
            parsed = JSON.parse(raw);
        } catch {
            parsed = null;
        }
    }
    const obj = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    return Object.fromEntries(
        DISTRESS_CATEGORIES.map(c => [c, typeof obj[c] === 'boolean' ? obj[c] : DEFAULT_DISTRESS_SCOPE[c]])
    ) as DistressScope;
}

export function serializeDistressScope(scope: DistressScope): string {
    return JSON.stringify(Object.fromEntries(DISTRESS_CATEGORIES.map(c => [c, scope[c]])));
}
