/**
 * Distress wipe: WHAT it erases, pure (unit-tested in __tests__/distressScope.test.ts).
 *
 * Stored in user_settings as `distress_wipe_scope`, a JSON {category: bool}
 * (default: every category on). Device-only: never restored from a backup.
 *
 * WHEN it fires is not a setting: Android decides how many wrong biometrics
 * lock the sensor (see DISTRESS_TECH_DETAILS in lib/appLock.ts).
 *
 * Every logged day's date, time and mood score, and its links to the default
 * activities, are ALWAYS kept: that is what keeps the journal believable, so it
 * is not a choice here.
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
] as const;
export type DistressCategory = (typeof DISTRESS_CATEGORIES)[number];
export type DistressScope = Record<DistressCategory, boolean>;

/** The default: erase every category (the approach the feature shipped with). */
export const DEFAULT_DISTRESS_SCOPE: DistressScope = Object.fromEntries(
    DISTRESS_CATEGORIES.map(c => [c, true])
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
};

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
