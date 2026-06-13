#!/usr/bin/env node
/**
 * SoulSync demo-data generator.
 *
 * Produces a SoulSync export-format JSON (schema version 2) that can be loaded
 * into ANY build via Settings -> Import Data — including a release APK that has
 * no `__DEV__` "Generate sample entries" button. Use it to seed a clean,
 * good-looking dataset for a demo recording or store screenshots.
 *
 *   node scripts/make-demo-data.js > /tmp/soulsync-demo.json
 *   node scripts/make-demo-data.js --days 35 --today 2026-06-13 > out.json
 *   node scripts/make-demo-data.js --seed 7 > out.json
 *
 * Design goals (so the data LOOKS real, not random):
 *   - ~35 days ending TODAY, with today AND yesterday present so the Home
 *     streak shows ("2-day streak").
 *   - A believable wavy mood curve in the ~3..9 range: a gentle weekly rhythm,
 *     a weekend lift, and ONE rough patch mid-month (a few low days), plus a
 *     little day-to-day jitter — never a flat line or pure noise.
 *   - 1-3 activities per entry, drawn ONLY from the activities that exist on a
 *     fresh install (see DEFAULT_GROUPS / DEFAULT_ACTIVITIES below, mirrored
 *     from components/seedData.ts). The importer maps activities by
 *     (name, group_id) to the install's own seeded rows, so referencing the
 *     default set "just works" on a fresh device.
 *   - Short, human notes on ~40% of entries (NOTE_POOL).
 *   - NO photos: the export schema carries photo FILE-PATH references only (not
 *     the image bytes), and those paths won't exist on the importing device, so
 *     we omit media entirely — entries import clean with no broken thumbnails.
 *
 * Dates are emitted as UTC ISO instants pinned to LOCAL NOON of each day. The
 * app keys "which local day is this entry on" via localDateString() in the
 * device's timezone (see databases/dateHelpers.ts); local noon is far from
 * either midnight boundary, so every entry lands on its intended calendar day
 * regardless of the importing device's timezone.
 *
 * The generation logic is the pure, exported `generateDemoData()` — the CLI at
 * the bottom is a thin wrapper. The pure function is what the jest round-trip
 * test exercises (scripts/__tests__/make-demo-data.test.js).
 */

'use strict';

// ---------------------------------------------------------------------------
// Default seed data — MUST mirror components/seedData.ts (group + activity
// names and group_ids). Activity ids follow the install's AUTOINCREMENT order:
// activities are inserted grouped by group_id, in array order, starting at 1.
// We reproduce that numbering here so each entry's `activity_ids` references
// the same rows the importer will match by (name, group_id).
// ---------------------------------------------------------------------------

const DEFAULT_GROUPS = [
  { id: 1, name: 'Emotions' },
  { id: 2, name: 'Sleep' },
  { id: 3, name: 'Social' },
  { id: 4, name: 'Activities' },
  { id: 5, name: 'Health' },
];

// Mirrors initialActivities order exactly; ids assigned 1..N in this order.
const DEFAULT_ACTIVITIES = [
  // Emotions (1)
  { name: 'Happy', group_id: 1, icon_family: 'Feather', icon_name: 'smile' },
  { name: 'Content', group_id: 1, icon_family: 'Feather', icon_name: 'sun' },
  { name: 'Grateful', group_id: 1, icon_family: 'Feather', icon_name: 'heart' },
  { name: 'Anxious', group_id: 1, icon_family: 'MaterialCommunityIcons', icon_name: 'weather-lightning-rainy' },
  { name: 'Stressed', group_id: 1, icon_family: 'Feather', icon_name: 'alert-circle' },
  { name: 'Tired', group_id: 1, icon_family: 'MaterialCommunityIcons', icon_name: 'sleep' },
  { name: 'Frustrated', group_id: 1, icon_family: 'Feather', icon_name: 'frown' },
  { name: 'Unmotivated', group_id: 1, icon_family: 'Feather', icon_name: 'meh' },
  { name: 'Overwhelmed', group_id: 1, icon_family: 'MaterialCommunityIcons', icon_name: 'brain' },
  { name: 'Calm', group_id: 1, icon_family: 'Feather', icon_name: 'cloud' },
  { name: 'Hopeful', group_id: 1, icon_family: 'Feather', icon_name: 'sun' },
  { name: 'Energetic', group_id: 1, icon_family: 'MaterialCommunityIcons', icon_name: 'lightning-bolt' },
  { name: 'Confident', group_id: 1, icon_family: 'MaterialCommunityIcons', icon_name: 'arm-flex-outline' },
  // Sleep (2)
  { name: 'Good Sleep', group_id: 2, icon_family: 'MaterialCommunityIcons', icon_name: 'sleep' },
  { name: 'Okay Sleep', group_id: 2, icon_family: 'FontAwesome6', icon_name: 'bed' },
  { name: 'Bad Sleep', group_id: 2, icon_family: 'MaterialCommunityIcons', icon_name: 'sleep-off' },
  { name: 'Nap', group_id: 2, icon_family: 'Feather', icon_name: 'sun' },
  // Social (3)
  { name: 'Family Time', group_id: 3, icon_family: 'Feather', icon_name: 'users' },
  { name: 'Friends', group_id: 3, icon_family: 'Feather', icon_name: 'users' },
  { name: 'Dates', group_id: 3, icon_family: 'Feather', icon_name: 'heart' },
  { name: 'Event', group_id: 3, icon_family: 'MaterialCommunityIcons', icon_name: 'party-popper' },
  { name: 'Me Time', group_id: 3, icon_family: 'Feather', icon_name: 'user' },
  // Activities (4)
  { name: 'Exercise', group_id: 4, icon_family: 'MaterialCommunityIcons', icon_name: 'run' },
  { name: 'Reading', group_id: 4, icon_family: 'Feather', icon_name: 'book' },
  { name: 'Music', group_id: 4, icon_family: 'Feather', icon_name: 'music' },
  { name: 'Gaming', group_id: 4, icon_family: 'MaterialCommunityIcons', icon_name: 'gamepad-variant' },
  { name: 'Work', group_id: 4, icon_family: 'Feather', icon_name: 'briefcase' },
  { name: 'Study', group_id: 4, icon_family: 'MaterialCommunityIcons', icon_name: 'book-open-page-variant' },
  { name: 'Coding', group_id: 4, icon_family: 'Feather', icon_name: 'code' },
  { name: 'Nature', group_id: 4, icon_family: 'MaterialCommunityIcons', icon_name: 'tree' },
  // Health (5)
  { name: 'Healthy Food', group_id: 5, icon_family: 'MaterialCommunityIcons', icon_name: 'fruit-watermelon' },
  { name: 'Fast Food', group_id: 5, icon_family: 'MaterialCommunityIcons', icon_name: 'hamburger' },
  { name: 'Sick', group_id: 5, icon_family: 'MaterialCommunityIcons', icon_name: 'emoticon-sick-outline' },
  { name: 'Headache', group_id: 5, icon_family: 'MaterialCommunityIcons', icon_name: 'head-sync' },
].map((a, i) => ({ id: i + 1, position: 0, ...a }));

// Convenience id lookups by name (keeps the curve logic readable).
const ID = Object.fromEntries(DEFAULT_ACTIVITIES.map((a) => [a.name, a.id]));

// 12-15 short, human notes. Drawn for ~40% of entries.
const NOTE_POOL = [
  'Slept badly, dragging all day.',
  'Good gym session this morning — felt clear after.',
  'Long day at work but got the big thing shipped.',
  'Quiet evening to myself, exactly what I needed.',
  'Dinner with friends, laughed a lot.',
  'Bit anxious about the deadline but okay.',
  'Went for a walk in the park, sun was nice.',
  'Couldn\'t focus today, scattered.',
  'Cooked something healthy for once.',
  'Headache crept in by the afternoon.',
  'Played guitar for an hour, lost track of time.',
  'Called family, good to catch up.',
  'Slow start but turned the day around.',
  'Feeling hopeful about this week.',
  'Just tired. Early night.',
];

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) — a fixed seed makes the generated dataset
// reproducible, so the round-trip test asserts against stable output.
// ---------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function roundHalf(v) {
  return Math.round(v * 2) / 2;
}

/**
 * Parse a `YYYY-MM-DD` string (or accept a Date) into a Date at LOCAL midnight.
 * Throws on a malformed string so a bad --today fails loudly.
 */
function toLocalMidnight(input) {
  if (input instanceof Date) {
    return new Date(input.getFullYear(), input.getMonth(), input.getDate());
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(input));
  if (!m) {
    throw new Error(`Invalid date "${input}" — expected YYYY-MM-DD`);
  }
  // Local-time constructor: month is 0-indexed.
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/**
 * The mood curve. Returns a value in [3, 9] (0.5 steps) for `daysAgo` days
 * before the end, over a `days`-long window. Combines:
 *   - a gentle long wave across the month,
 *   - a weekend lift (Sat/Sun),
 *   - one "rough patch" dip centered ~60% through the window,
 *   - small seeded jitter.
 */
function moodFor(date, daysAgo, days, rng) {
  const dow = date.getDay(); // 0 Sun .. 6 Sat
  const isWeekend = dow === 0 || dow === 6;

  // Long, slow wave (about one full cycle across the window).
  const phase = ((days - daysAgo) / days) * Math.PI * 2;
  const wave = Math.sin(phase) * 1.2;

  // Rough patch: a dip a few days wide, centered ~60% through the window
  // (i.e. mid-month for a 35-day window). Gaussian-ish bump downward.
  const roughCenter = Math.round(days * 0.6);
  const idxFromStart = days - 1 - daysAgo;
  const dist = idxFromStart - roughCenter;
  const rough = -3.0 * Math.exp(-(dist * dist) / (2 * 2.2 * 2.2));

  const weekend = isWeekend ? 0.9 : 0;
  const jitter = (rng() - 0.5) * 1.4;

  const base = 6.2; // pleasant baseline
  return roundHalf(clamp(base + wave + weekend + rough + jitter, 3, 9));
}

/**
 * Choose 1-3 activities for an entry, biased by mood + day so the picks read as
 * coherent (low-mood days lean stressed/tired/bad-sleep; weekends lean social).
 * Always returns at least one id.
 */
function activitiesFor(mood, date, rng) {
  const dow = date.getDay();
  const isWeekend = dow === 0 || dow === 6;
  const picks = new Set();

  if (mood <= 4.5) {
    // Rough day: an emotion + a sleep/health signal.
    picks.add(pickOne([ID.Stressed, ID.Tired, ID.Anxious, ID.Overwhelmed, ID.Frustrated], rng));
    picks.add(pickOne([ID['Bad Sleep'], ID['Okay Sleep'], ID.Headache, ID['Fast Food']], rng));
  } else if (mood >= 7.5) {
    // Good day: a positive emotion + something nice.
    picks.add(pickOne([ID.Happy, ID.Content, ID.Grateful, ID.Energetic, ID.Hopeful, ID.Confident], rng));
    picks.add(pickOne([ID.Exercise, ID['Good Sleep'], ID.Friends, ID.Nature, ID['Healthy Food']], rng));
  } else {
    // Middling day: a calm/neutral emotion + a routine activity.
    picks.add(pickOne([ID.Calm, ID.Content, ID.Tired, ID.Unmotivated], rng));
    picks.add(pickOne([ID.Work, ID.Study, ID.Coding, ID.Reading, ID.Music], rng));
  }

  if (isWeekend) {
    picks.add(pickOne([ID.Friends, ID['Family Time'], ID.Dates, ID['Me Time'], ID.Event], rng));
  }

  // Occasionally add a third/extra from anywhere for variety, capped at 3.
  const extra = Math.floor(rng() * 100);
  if (extra < 35 && picks.size < 3) {
    picks.add(pickOne(DEFAULT_ACTIVITIES.map((a) => a.id), rng));
  }

  return Array.from(picks).slice(0, 3);
}

function pickOne(arr, rng) {
  return arr[Math.floor(rng() * arr.length)];
}

/**
 * Generate the full SoulSync export-format object.
 *
 * @param {Object} [opts]
 * @param {Date|string} [opts.today] End date (inclusive). Default: now (machine
 *        local date). Accepts a Date or a 'YYYY-MM-DD' string.
 * @param {number} [opts.days=35] Number of days, ending at `today`.
 * @param {number} [opts.seed=42] PRNG seed for reproducible output.
 * @returns {Object} export object: { version, exportDate, data: { entries,
 *          activities, activityGroups, settings } }
 */
function generateDemoData(opts = {}) {
  const days = Number.isFinite(opts.days) ? Math.max(1, Math.floor(opts.days)) : 35;
  const seed = Number.isFinite(opts.seed) ? opts.seed : 42;
  const endMidnight = toLocalMidnight(opts.today != null ? opts.today : new Date());
  const rng = mulberry32(seed);

  const entries = [];
  // Build oldest -> newest so ids increase with time (natural insertion order).
  for (let daysAgo = days - 1; daysAgo >= 0; daysAgo--) {
    const dayMidnight = new Date(
      endMidnight.getFullYear(),
      endMidnight.getMonth(),
      endMidnight.getDate() - daysAgo
    );
    // Pin to LOCAL NOON so the local-day key is timezone-robust.
    const at = new Date(
      dayMidnight.getFullYear(),
      dayMidnight.getMonth(),
      dayMidnight.getDate(),
      12,
      0,
      0,
      0
    );

    const mood = moodFor(dayMidnight, daysAgo, days, rng);
    const activityIds = activitiesFor(mood, dayMidnight, rng);
    const hasNote = rng() < 0.4;
    const note = hasNote ? NOTE_POOL[Math.floor(rng() * NOTE_POOL.length)] : '';

    const id = days - daysAgo; // 1..days, oldest=1
    entries.push({
      id,
      mood,
      notes: note,
      date: at.toISOString(),
      // Importer expects a comma-joined string of activity ids (mapped by
      // (name, group_id) to the install's seeded rows).
      activity_ids: activityIds.join(','),
      activity_names: activityIds
        .map((aid) => DEFAULT_ACTIVITIES.find((a) => a.id === aid)?.name)
        .filter(Boolean)
        .join(','),
      // No photos — see file header.
      photos: [],
    });
  }

  return {
    version: 2,
    exportDate: new Date().toISOString(),
    _note:
      'SoulSync demo dataset generated by scripts/make-demo-data.js. Photos are intentionally omitted.',
    data: {
      entries,
      activities: DEFAULT_ACTIVITIES,
      activityGroups: DEFAULT_GROUPS,
      settings: [],
    },
  };
}

// ---------------------------------------------------------------------------
// CLI wrapper (thin). Parses --days / --today / --seed and prints JSON.
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--days') out.days = Number(argv[++i]);
    else if (arg === '--today') out.today = argv[++i];
    else if (arg === '--seed') out.seed = Number(argv[++i]);
    else if (arg === '--help' || arg === '-h') out.help = true;
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(
      'Usage: node scripts/make-demo-data.js [--days 35] [--today YYYY-MM-DD] [--seed 42]\n' +
        'Writes a SoulSync import-format JSON (schema v2) to stdout.\n'
    );
    return;
  }
  const data = generateDemoData(args);
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}

// Run the CLI only when invoked directly, so requiring this module in tests is
// side-effect free.
if (require.main === module) {
  main();
}

module.exports = {
  generateDemoData,
  // Exported for the test's assertions.
  DEFAULT_ACTIVITIES,
  DEFAULT_GROUPS,
  NOTE_POOL,
};
