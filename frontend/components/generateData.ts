import { SQLiteDatabase } from 'expo-sqlite';
import { Activity, DatabaseResult } from './types';
import { getActivities } from "@/databases/database";
import { withWriteTransaction } from "@/databases/writeTransaction";
import { writeBase64ToMediaDir } from "@/databases/mediaHelpers";

/// GENERATE DATA (SETTINGS / ADMIN STUFF)
//
// Two layers live in this file:
//   1. `planSeedEntries` — a PURE function that decides WHAT to seed (dates,
//      notes, activity/photo counts, starred flag). It takes an injectable RNG
//      so it is deterministically unit-testable (see
//      __tests__/generateDataSeed.test.ts) with no database/filesystem in the
//      loop at all.
//   2. `seedMoodEntries` — the I/O layer that turns a plan into real rows
//      (+ a handful of on-disk sample photo files) inside ONE
//      `withWriteTransaction` call, per the write-path contract in
//      frontend/databases/CLAUDE.md.

// Short one-liner notes (~45% of seeded entries land here).
const SHORT_NOTES = [
  'Feeling energized after a great workout!',
  'Had a productive day at work',
  'Feeling a bit stressed about deadlines',
  'Really enjoyed spending time with friends today',
  'Tired but satisfied with what I accomplished',
  'Meditation session helped calm my mind',
  'Struggling with anxiety today',
  'Perfect weather for a walk outside',
  'Need to work on getting better sleep',
  'Started a new book - feeling inspired',
  'Family dinner was lovely',
  'Missing home a bit today',
  'Proud of sticking to my goals',
  'Could use a mental health day',
  'Weekend plans looking promising',
];

// Sentences stitched together (4-6 at a time) to build the long, multi-sentence
// notes (~30% of seeded entries) that need to wrap 4+ lines on a Timeline card.
const LONG_NOTE_SENTENCES = [
  'Woke up feeling surprisingly great, even before coffee.',
  'The morning was slow, but things picked up after lunch.',
  'Work was a grind today, back-to-back meetings with barely a break.',
  'Spent the evening catching up with an old friend, which was exactly what I needed.',
  'Tried a new recipe for dinner and it actually turned out well.',
  'Went for a long walk to clear my head and it helped more than expected.',
  'Still thinking about the conversation from earlier - not sure how I feel about it.',
  'Got a lot done today and it feels good to finally be ahead for once.',
  'Anxiety crept in around mid-afternoon, but a short break helped settle it.',
  'Grateful for the small things - good weather, a decent night of sleep, a quiet house.',
  'Been putting off a few things I know I should deal with soon.',
  'Made time to meditate this morning and it set a calmer tone for the whole day.',
  'The gym session was tougher than usual but worth it.',
  'Family stuff took up most of the day, in a good way for once.',
  'Feeling a bit off today and not entirely sure why.',
];

/**
 * What `planSeedEntries` decides about one seeded entry. Everything here is
 * plain data — no DB/filesystem handles — so a caller can insert it however
 * it likes (and a test can assert on it directly).
 */
export interface SeedPlanEntry {
  mood: number; // integer or one-decimal value in [1, 10]
  notes: string; // '' (~25%), a short one-liner (~45%), or a long note (~30%)
  date: string; // UTC ISO-8601 instant, never later than the `now` passed in
  starred: boolean; // ~10% of entries
  activityCount: number; // 0-4, caller picks which activities
  photoCount: number; // 0-3 (~15% get 1, ~8% get 2-3, rest 0)
}

/** Local-hour [start, end) windows used to spread same-day entries across the day. */
const TIME_OF_DAY_WINDOWS: ReadonlyArray<readonly [number, number]> = [
  [6, 11], // morning
  [12, 16], // afternoon
  [17, 20], // evening
  [21, 23], // night
];

function shuffled<T>(items: readonly T[], rng: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Build `entriesToday` distinct-ish local times on the calendar day `dayStart`
 * falls on. For `dayOffset === 0` ("today"), no produced time may be later
 * than `now` — any window pick that overshoots is pulled back a few minutes
 * before `now` (staggered per entry so they stay distinct) instead of being
 * dropped, so the caller always gets exactly `entriesToday` times back.
 */
function pickTimesForDay(
  dayStart: Date,
  entriesToday: number,
  now: Date,
  dayOffset: number,
  rng: () => number
): Date[] {
  const windows = shuffled(TIME_OF_DAY_WINDOWS, rng).slice(0, entriesToday);
  const times = windows.map(([startHour, endHour]) => {
    const d = new Date(dayStart);
    const hourFloat = startHour + rng() * (endHour - startHour);
    const hour = Math.floor(hourFloat);
    const minute = Math.floor((hourFloat - hour) * 60);
    d.setHours(hour, minute, Math.floor(rng() * 60), 0);
    return d;
  });

  if (dayOffset !== 0) return times;

  // "Today": clamp any overshoot below `now`, staggered by a minute per slot
  // (ascending) so the latest entries never collide or land in the future.
  return times
    .slice()
    .sort((a, b) => a.getTime() - b.getTime())
    .map((d, i, arr) => {
      if (d.getTime() <= now.getTime()) return d;
      const minutesBack = (arr.length - i) * 5;
      return new Date(now.getTime() - minutesBack * 60 * 1000);
    });
}

function randomMood(rng: () => number): number {
  const raw = 1 + rng() * 9; // [1, 10)
  // Roughly half whole numbers, half one-decimal — matches how a mood slider
  // in the real entry form tends to land (mostly round, sometimes fine-tuned).
  return rng() < 0.5 ? Math.round(raw) : Math.round(raw * 10) / 10;
}

function randomNotes(rng: () => number): string {
  const r = rng();
  if (r < 0.25) return '';
  if (r < 0.7) return SHORT_NOTES[Math.floor(rng() * SHORT_NOTES.length)];

  const sentenceCount = 4 + Math.floor(rng() * 3); // 4-6 sentences
  const sentences: string[] = [];
  for (let i = 0; i < sentenceCount; i++) {
    sentences.push(LONG_NOTE_SENTENCES[Math.floor(rng() * LONG_NOTE_SENTENCES.length)]);
  }
  return sentences.join(' ');
}

function randomPhotoCount(rng: () => number): number {
  const r = rng();
  if (r < 0.15) return 1;
  if (r < 0.23) return 2 + Math.floor(rng() * 2); // 2 or 3
  return 0;
}

function makePlanEntry(date: Date, rng: () => number): SeedPlanEntry {
  return {
    mood: randomMood(rng),
    notes: randomNotes(rng),
    date: date.toISOString(),
    starred: rng() < 0.1,
    activityCount: Math.floor(rng() * 5), // 0-4 inclusive
    photoCount: randomPhotoCount(rng),
  };
}

/**
 * Plan `count` seeded entries clustered by day: walking back from `now`'s
 * calendar day, each chosen day gets 1-4 entries at different times of day,
 * with some days skipped entirely (never "today" itself, so the newest
 * entries stay recent) — this is what makes the Timeline show real multi-entry
 * day groups instead of one entry spread thinly across years.
 *
 * PURE: takes `now` and `rng` as parameters instead of reading `Date.now()` /
 * `Math.random()` itself, so it is exactly reproducible under test.
 */
export function planSeedEntries(
  count: number,
  now: Date,
  rng: () => number = Math.random
): SeedPlanEntry[] {
  if (count <= 0) return [];

  const plans: SeedPlanEntry[] = [];
  const skipChance = 0.2;
  // Generous safety valve: guards against runaway iteration if `count` is huge
  // and the RNG happens to roll "skip" repeatedly. Never bites at QA seed sizes
  // (11..300+) — expected days-needed is well under this for any count we seed.
  const maxDayOffset = count * 4 + 60;

  let dayOffset = 0;
  while (plans.length < count && dayOffset <= maxDayOffset) {
    const skip = dayOffset > 0 && rng() < skipChance;
    if (!skip) {
      const remaining = count - plans.length;
      const entriesToday = Math.min(remaining, 1 + Math.floor(rng() * 4)); // 1-4
      const dayStart = new Date(now);
      dayStart.setDate(dayStart.getDate() - dayOffset);
      const times = pickTimesForDay(dayStart, entriesToday, now, dayOffset, rng);
      for (const t of times) {
        plans.push(makePlanEntry(t, rng));
      }
    }
    dayOffset++;
  }

  // Pathological top-up (only reachable if the skip-heavy walk ran past
  // maxDayOffset before reaching `count`): keep adding one entry per day
  // further back until the count is exact.
  while (plans.length < count) {
    const dayStart = new Date(now);
    dayStart.setDate(dayStart.getDate() - dayOffset);
    const [t] = pickTimesForDay(dayStart, 1, now, dayOffset, rng);
    plans.push(makePlanEntry(t, rng));
    dayOffset++;
  }

  return plans;
}

// Three tiny (4x4) solid-color PNGs used for seeded photo attachments — real
// user photos vary per entry, but for dev/QA seed data reusing a handful of
// sample images is fine and avoids writing hundreds of files to disk. Cached
// per app session so a second seed run (e.g. the 50-entry button run after the
// 300-entry one) doesn't rewrite them.
const SAMPLE_PHOTO_PNGS_BASE64: readonly string[] = [
  // red
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR42mO4Y2MDRwzEcQAy0hVBhgVz1QAAAABJRU5ErkJggg==',
  // green
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR42mOw2RIFRwzEcQAWshShrvvMOQAAAABJRU5ErkJggg==',
  // blue
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR42mOwSbkDRwzEcQBf0hfB1TLtYgAAAABJRU5ErkJggg==',
];

let cachedSamplePhotoPaths: string[] | null = null;

/**
 * Write the sample photo PNGs into MEDIA_DIR (idempotent per process — see
 * `cachedSamplePhotoPaths`) and return their on-disk paths. Must run BEFORE
 * `withWriteTransaction`: file IO doesn't belong inside a DB transaction, and
 * `writeBase64ToMediaDir` already ensures the media directory exists.
 */
async function ensureSamplePhotoFiles(): Promise<string[]> {
  if (cachedSamplePhotoPaths) return cachedSamplePhotoPaths;
  cachedSamplePhotoPaths = await Promise.all(
    SAMPLE_PHOTO_PNGS_BASE64.map((b64) => writeBase64ToMediaDir(b64, 'png'))
  );
  return cachedSamplePhotoPaths;
}

// Random activities for an entry: the shared `shuffled` helper, then a prefix.
function getRandomActivities(activities: Activity[], count: number) {
  return shuffled(activities, Math.random).slice(0, Math.min(count, activities.length));
}

// Main seeding function. Used both by the Settings "Generate 50 Sample
// Entries" button and the "Generate 300 Timeline QA Entries" button — the
// realistic day-clustered/note-length/photo/starred mix applies at any count.
export async function seedMoodEntries(
  db: SQLiteDatabase,
  numberOfEntries: number = 11
): Promise<DatabaseResult> {
  try {
    // First, get all available activities
    const activities = await getActivities(db);

    if (!activities.length) {
      return {
        success: false,
        message: 'No activities found in database. Please ensure activities are seeded first.'
      };
    }

    const plans = planSeedEntries(numberOfEntries, new Date());

    // Photo files are written to disk BEFORE the transaction (see
    // ensureSamplePhotoFiles) — only ever 3 files regardless of how many
    // seeded entries want a photo.
    const samplePhotoPaths = plans.some((p) => p.photoCount > 0)
      ? await ensureSamplePhotoFiles()
      : [];

    // Real write transaction (statements on `txn`; dev-only seed path). See
    // databases/writeTransaction.ts.
    await withWriteTransaction(async (txn) => {
      for (const plan of plans) {
        // Insert the mood entry. ~10% of seeded entries come in pre-starred,
        // so the dev seed data exercises the starred-entries UI/filters too.
        const starredAt = plan.starred ? new Date().toISOString() : null;
        const result = await txn.runAsync(
          `INSERT INTO entries (mood, notes, date, starred_at) VALUES (?, ?, ?, ?)`,
          [plan.mood, plan.notes, plan.date, starredAt]
        );

        const entryId = result.lastInsertRowId;

        // Add 0-4 random activities for this entry
        const selectedActivities = getRandomActivities(activities, plan.activityCount);

        for (const activity of selectedActivities) {
          await txn.runAsync(
            `INSERT INTO entry_activities (entry_id, activity_id) VALUES (?, ?)`,
            [entryId, activity.id]
          );
        }

        // Add 0-3 sample photos for this entry, cycling through the 3 sample files.
        for (let i = 0; i < plan.photoCount; i++) {
          const filePath = samplePhotoPaths[(entryId + i) % samplePhotoPaths.length];
          await txn.runAsync(
            `INSERT INTO entry_media (entry_id, file_path, media_type) VALUES (?, ?, 'image')`,
            [entryId, filePath]
          );
        }
      }
    });

    return {
      success: true,
      message: `Successfully seeded ${numberOfEntries} mood entries`
    };
  } catch (error) {
    console.error('Error seeding mood entries:', error);
    return {
      success: false,
      message: `Error seeding mood entries: ${error}`
    };
  }
}

// Helper function to clear all entries (useful for testing)
export async function clearAllEntries(_db: SQLiteDatabase): Promise<DatabaseResult> {
  try {
    // Real write transaction (statements on `txn`; dev/test-only). See
    // databases/writeTransaction.ts.
    await withWriteTransaction(async (txn) => {
      // Delete from entry_activities first due to foreign key constraints
      await txn.runAsync('DELETE FROM entry_activities');
      await txn.runAsync('DELETE FROM entries');

      // Reset the autoincrement counters
      await txn.runAsync('DELETE FROM sqlite_sequence WHERE name IN (\'entries\', \'entry_activities\')');
    });

    return {
      success: true,
      message: 'Successfully cleared all entries'
    };
  } catch (error) {
    console.error('Error clearing entries:', error);
    return {
      success: false,
      message: `Error clearing entries: ${error}`
    };
  }
}
