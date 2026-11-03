/**
 * Test builders: ONE builder per domain type, every default derived from the
 * production source of that value (never invented here).
 *
 *   makeEntry      mood/notes from the entry form's DEFAULT_DRAFT
 *   makeActivity   the first shipped seed activity, positioned like seedActivitiesV1
 *   makeGroup      the first shipped seed group
 *   makePhoto      a file under the real MEDIA_DIR
 *   makeReminder   whatever addReminder([]) creates
 *   makeHealthDay  an empty day (what the sync writes when Health Connect has nothing)
 *   makeEntryRow   the raw row getEntriesWindow selects (GROUP_CONCAT columns null)
 *
 * Production modules are loaded with jest.requireActual, so a test that mocks
 * seedData / mediaHelpers / useEntryDraft still gets real defaults here.
 * Override only the fields your test is ABOUT: `makeEntry({ mood: 9 })`.
 *
 * Dates: TZ is pinned to Australia/Brisbane (jest.globalSetup.js, no DST), so
 * every local-time helper below is deterministic. Days are 'YYYY-MM-DD' strings
 * (no 0- vs 1-based month arguments to get wrong).
 */
import type { Activity, ActivityGroup, EntryPhoto, MoodEntry } from '@/components/types';
import type { Reminder } from '@/lib/reminders';
import type { StoredHealthMetric } from '@/databases/health-metrics';

type SeedData = typeof import('@/components/seedData');
type DraftModule = typeof import('@/components/forms/hooks/useEntryDraft');
type MediaModule = typeof import('@/databases/mediaHelpers');
type RemindersModule = typeof import('@/lib/reminders');

const seed = () => jest.requireActual<SeedData>('@/components/seedData');

// ── time ────────────────────────────────────────────────────────────────────

/** The fixed day every wall-clock default is pinned to. Never the real clock. */
export const FIXED_DAY = '2026-06-15';

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDay(day: string): [number, number, number] {
    const m = DAY_RE.exec(day);
    if (!m) throw new Error(`testing/builders: expected a 'YYYY-MM-DD' day, got '${day}'`);
    return [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
}

/** Local time on a 'YYYY-MM-DD' day (default local noon). */
export function localAt(day: string, hour = 12, minute = 0): Date {
    const [y, m0, d] = parseDay(day);
    return new Date(y, m0, d, hour, minute, 0, 0);
}

/** Local midnight of a 'YYYY-MM-DD' day. */
export function localMidnight(day: string): Date {
    return localAt(day, 0, 0);
}

/** UTC ISO string of a local time: the form entries.date is stored in (`.toISOString()`). */
export function localIso(day: string, hour = 12, minute = 0): string {
    return localAt(day, hour, minute).toISOString();
}

/** The local 'YYYY-MM-DD' key of a Date. */
export function dayKey(date: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

/** `day` shifted by `delta` calendar days (negative = earlier). */
export function addDays(day: string, delta: number): string {
    const [y, m0, d] = parseDay(day);
    return dayKey(new Date(y, m0, d + delta, 12));
}

/** `n` consecutive day keys starting at `from` (inclusive). */
export function dayKeys(n: number, from = '2026-06-01'): string[] {
    return Array.from({ length: n }, (_, i) => addDays(from, i));
}

/** The fixed instant: local noon of FIXED_DAY. */
export const FIXED_NOW = localAt(FIXED_DAY);
export const FIXED_NOW_ISO = FIXED_NOW.toISOString();

// ── domain builders ─────────────────────────────────────────────────────────

/** A mood entry as the app reads it back: the form's default draft, saved at FIXED_NOW. */
export function makeEntry(over: Partial<MoodEntry> = {}): MoodEntry {
    const { DEFAULT_DRAFT } = jest.requireActual<DraftModule>(
        '@/components/forms/hooks/useEntryDraft'
    );
    return {
        id: 1,
        mood: DEFAULT_DRAFT.mood,
        notes: DEFAULT_DRAFT.notes,
        date: FIXED_NOW_ISO,
        activities: [],
        photos: [],
        starred_at: null,
        ...over,
    };
}

/**
 * The activity a fresh install has at `seedIndex` in initialActivities, with
 * the id/position seedActivitiesV1 gives it (ids in seed order, position i+1
 * within its group). Names are seedData's v1 names: a fresh install's
 * migration 6 later renames "Event" to "Social event" (pinned in
 * __tests__/testingHelpers.test.tsx).
 */
export function seedActivity(nameOrIndex: string | number = 0): Activity {
    const { initialActivities } = seed();
    const index =
        typeof nameOrIndex === 'number'
            ? nameOrIndex
            : initialActivities.findIndex((a) => a.name === nameOrIndex);
    const a = initialActivities[index];
    if (!a) throw new Error(`testing/builders: no seed activity '${nameOrIndex}'`);
    const position =
        initialActivities.slice(0, index + 1).filter((x) => x.group_id === a.group_id).length;
    return {
        id: index + 1,
        group_id: a.group_id,
        name: a.name,
        icon_name: a.icon_name,
        icon_family: a.icon_family as Activity['icon_family'],
        position,
    };
}

/** An activity: the first shipped seed activity unless overridden. */
export function makeActivity(over: Partial<Activity> = {}): Activity {
    return { ...seedActivity(0), ...over };
}

/** An activity group: the first shipped seed group (sort_order backfilled = id, migration 10). */
export function makeGroup(over: Partial<ActivityGroup> = {}): ActivityGroup {
    const { initialActivityGroups } = seed();
    return { id: 1, name: initialActivityGroups[0].name, sort_order: 1, ...over };
}

/** A photo attachment stored under the real media dir. */
export function makePhoto(over: Partial<EntryPhoto> = {}): EntryPhoto {
    const { MEDIA_DIR } = jest.requireActual<MediaModule>('@/databases/mediaHelpers');
    const id = over.id ?? 1;
    return {
        id,
        entry_id: 1,
        file_path: `${MEDIA_DIR}photo-${id}.jpg`,
        media_type: 'image',
        created_at: FIXED_NOW_ISO,
        ...over,
    };
}

/** A reminder exactly as addReminder creates the first one. */
export function makeReminder(over: Partial<Reminder> = {}): Reminder {
    const { addReminder } = jest.requireActual<RemindersModule>('@/lib/reminders');
    return { ...addReminder([])[0], ...over };
}

/** A stored health-metrics day with no data (all metrics null), written by the Health Connect sync. */
export function makeHealthDay(over: Partial<StoredHealthMetric> = {}): StoredHealthMetric {
    const { HEALTH_CONNECT_SOURCE } = jest.requireActual<
        typeof import('@/lib/healthConnectConfig')
    >('@/lib/healthConnectConfig');
    return {
        date: FIXED_DAY,
        sleepTotalMinutes: null,
        sleepStages: {},
        avgHeartRate: null,
        minHeartRate: null,
        restingHeartRate: null,
        avgHrvMillis: null,
        source: HEALTH_CONNECT_SOURCE,
        syncedAt: FIXED_NOW_ISO,
        ...over,
    };
}

/** The raw row shape getEntriesWindow (databases/entries.ts) selects: one entry, no activities. */
export type EntryRow = {
    id: number;
    mood: number;
    notes: string;
    date: string;
    starred_at: string | null;
    activity_ids: string | null;
    activity_names: string | null;
    activity_group_ids: string | null;
    activity_icon_names: string | null;
    activity_icon_families: string | null;
};

export function makeEntryRow(over: Partial<EntryRow> = {}): EntryRow {
    const e = makeEntry();
    return {
        id: e.id,
        mood: e.mood,
        notes: e.notes,
        date: e.date,
        starred_at: null,
        activity_ids: null,
        activity_names: null,
        activity_group_ids: null,
        activity_icon_names: null,
        activity_icon_families: null,
        ...over,
    };
}
