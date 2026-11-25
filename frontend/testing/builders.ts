/**
 * Test builders: ONE builder per domain type, every default derived from the
 * production source of that value (never invented here).
 *
 *   makeEntry      mood/notes from the entry form's DEFAULT_DRAFT
 *   makeEntries    n of them, ids 1..n, one day apart ending FIXED_DAY
 *   seedActivity   a fresh install's activity row (seed order, shipped name)
 *   makeActivity   the first shipped seed activity, positioned like seedActivitiesV1
 *   seedGroup      a fresh install's group row
 *   makeGroup      the first shipped seed group
 *   makePhoto      a file under the MEDIA_DIR the app under test compares against
 *   makeReminder   whatever addReminder([]) creates
 *   makeHealthDay  an empty day (what the sync writes when Health Connect has nothing)
 *   makeEntryRow   the raw row getEntriesWindow selects (GROUP_CONCAT columns null)
 *
 * Shipped VALUES (seed data, DEFAULT_DRAFT, addReminder) are loaded with
 * jest.requireActual, so a test that mocks seedData / useEntryDraft still gets
 * real defaults. Constants the app COMPARES against (MEDIA_DIR) come from the
 * module the app sees, mocked or not, so a fixture takes the same code path.
 * Override only the fields your test is ABOUT: `makeEntry({ mood: 9 })`.
 *
 * Dates: TZ is pinned to Australia/Brisbane (jest.globalSetup.js, no DST), so
 * every local-time helper below is deterministic. Days are 'YYYY-MM-DD' strings
 * (no 0- vs 1-based month arguments to get wrong).
 */
import type { Activity, ActivityGroup, EntryPhoto, MoodEntry } from '@/components/types';
import type { Reminder } from '@/lib/reminders';
import type { StoredHealthMetric } from '@/databases/health-metrics';
import { DATETIME_FORMAT_RE } from '@/databases/dateHelpers';

type SeedData = typeof import('@/components/seedData');
type DraftModule = typeof import('@/components/forms/hooks/useEntryDraft');
type MediaModule = typeof import('@/databases/mediaHelpers');
type RemindersModule = typeof import('@/lib/reminders');

const seed = () => jest.requireActual<SeedData>('@/components/seedData');

// ── time ────────────────────────────────────────────────────────────────────

/** The fixed day every wall-clock default is pinned to. Never the real clock. */
export const FIXED_DAY = '2026-06-15';


/** [year, 0-based month, day]; throws on a malformed OR impossible day ('2026-02-30'). */
function parseDay(day: string): [number, number, number, number?, number?, number?] {
    const m = DATETIME_FORMAT_RE.exec(day);
    if (!m) throw new Error(`testing/builders: expected a 'YYYY-MM-DD' day + optional 'HH:mm:ss[.sss]' time, got '${day}'`);
    const parts: [number, number, number, number?, number?, number?] = [
        Number(m[1]), Number(m[2]) - 1, Number(m[3]), // date
        Number(m[5]), Number(m[6]), Number(m[8]), // time
    ];
    // Date silently rolls '2026-02-30' to Mar 2 and month 00 to December: a
    // month off-by-one in a converted fixture would shift the input and the
    // expectation together and still pass. Round-trip instead. Compare against
    // the day part of the input string.
    if (dayKey(new Date(parts[0], parts[1], parts[2], 12)) !== day.split('T')[0]) {
        throw new Error(`testing/builders: '${day.split('T')[0]}' is not a real calendar day`);
    }
    return parts;
}

/** Local time on a 'YYYY-MM-DD' day (default local noon). */
export function localAt(date: string, hour = 12, minute = 0): Date {
    const [y, m0, d] = parseDay(date);
    return new Date(y, m0, d, hour, minute, 0, 0);
}

/** Local midnight of a 'YYYY-MM-DD' day. */
export function localMidnight(day: string): Date {
    return localAt(day, 0, 0);
}

/** UTC ISO string of a local date: the form entries.date is stored in (`.toISOString()`). */
export function localIso(day: string, hour = 12, minute = 0): string {
    return localAt(day, hour, minute).toISOString();
}

/** UTC ISO string of a local date and time: the form entries.date is stored in (`.toISOString()`). */
export function localDateTimeIso(datetime: string): string {
    const [y, m0, d, h, m, s] = parseDay(datetime);
    return new Date(y, m0, d, h ?? 12, m ?? 0, s ?? 0).toISOString();
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

/** `n` consecutive day keys starting at `from` (inclusive; default: the n days ending FIXED_DAY). */
export function dayKeys(n: number, from = addDays(FIXED_DAY, 1 - n)): string[] {
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
 * `n` entries with ids 1..n, the last on FIXED_DAY and each earlier one a day
 * before (local noon). `over(i)` customises entry i (0-based).
 */
export function makeEntries(
    n: number,
    over: (i: number) => Partial<MoodEntry> = () => ({})
): MoodEntry[] {
    const days = dayKeys(n);
    return days.map((day, i) => makeEntry({ id: i + 1, date: localIso(day), ...over(i) }));
}

/**
 * Seed names a fresh install renames during its migrations (seedData keeps the
 * v1 names). Migration 6: "Event" -> "Social event". testingHelpers.test.tsx
 * pins seedActivity() to every row of a freshly migrated database, so a new
 * rename fails there until it is listed here.
 */
export const SHIPPED_SEED_RENAMES: Readonly<Record<string, string>> = { Event: 'Social event' };

const shippedName = (v1Name: string) => SHIPPED_SEED_RENAMES[v1Name] ?? v1Name;

/**
 * The activity row a fresh install has at `nameOrIndex` (an index into
 * initialActivities, or a name: the shipped name or seedData's v1 name), with
 * the id/position seedActivitiesV1 gives it (ids in seed order, position i+1
 * within its group) and the name the user actually sees.
 */
export function seedActivity(nameOrIndex: string | number = 0): Activity {
    const { initialActivities } = seed();
    const index =
        typeof nameOrIndex === 'number'
            ? nameOrIndex
            : initialActivities.findIndex(
                  (a) => a.name === nameOrIndex || shippedName(a.name) === nameOrIndex
              );
    const a = initialActivities[index];
    if (!a) throw new Error(`testing/builders: no seed activity '${nameOrIndex}'`);
    const position =
        initialActivities.slice(0, index + 1).filter((x) => x.group_id === a.group_id).length;
    return {
        id: index + 1,
        group_id: a.group_id,
        name: shippedName(a.name),
        icon_name: a.icon_name,
        icon_family: a.icon_family as Activity['icon_family'],
        position,
    };
}

/** An activity: the first shipped seed activity unless overridden. */
export function makeActivity(over: Partial<Activity> = {}): Activity {
    return { ...seedActivity(0), ...over };
}

/** The group row a fresh install has at `index` in initialActivityGroups (id index+1, sort_order = id: migration 13's backfill). */
export function seedGroup(index = 0): ActivityGroup {
    const g = seed().initialActivityGroups[index];
    if (!g) throw new Error(`testing/builders: no seed group ${index}`);
    return { id: index + 1, name: g.name, sort_order: index + 1 };
}

/** An activity group: the first shipped seed group; sort_order follows an overridden id, as the backfill does. */
export function makeGroup(over: Partial<ActivityGroup> = {}): ActivityGroup {
    const id = over.id ?? 1;
    return { ...seedGroup(0), id, sort_order: id, ...over };
}

/**
 * A photo attachment already stored under MEDIA_DIR. The dir is read from the
 * mediaHelpers module the app under test sees (a suite's mock included), so
 * updateMoodEntry classifies the path as KEPT, not as a fresh pick to copy.
 * Under jest-expo's expo-file-system mock documentDirectory is undefined, so
 * the unmocked value is 'undefinedentry_media/': odd-looking, but it is the
 * same string the app compares against.
 */
export function makePhoto(over: Partial<EntryPhoto> = {}): EntryPhoto {
    const MEDIA_DIR =
        (require('@/databases/mediaHelpers') as Partial<MediaModule>).MEDIA_DIR ??
        jest.requireActual<MediaModule>('@/databases/mediaHelpers').MEDIA_DIR;
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
