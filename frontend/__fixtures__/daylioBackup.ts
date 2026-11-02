/**
 * Builds synthetic Daylio backups (.daylio) for tests, shaped like real ones
 * (schema v15, as in the public sample backups of DaylioBackupTools and
 * dayligo): a ZIP whose `backup.daylio` member is base64 of the JSON, plus
 * photo members whose path ends with the asset checksum. All content here is
 * invented.
 */
import { strToU8, zipSync } from 'fflate';

/** Smallest byte prefixes the converter recognises as images. */
export const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 2, 3]);
export const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 9, 9]);

/** The 5 predefined moods (ids 1..5 = rad..awful) plus custom moods 6 (in rad) and 7 (in bad). */
export const daylioMoods = () => [
  { id: 1, custom_name: '', mood_group_id: 1, mood_group_order: 0, icon_id: 1, predefined_name_id: 1, state: 0, createdAt: 1_700_000_000_000 },
  { id: 2, custom_name: '', mood_group_id: 2, mood_group_order: 0, icon_id: 2, predefined_name_id: 2, state: 0, createdAt: 1_700_000_000_000 },
  { id: 3, custom_name: '', mood_group_id: 3, mood_group_order: 0, icon_id: 3, predefined_name_id: 3, state: 0, createdAt: 1_700_000_000_000 },
  { id: 4, custom_name: '', mood_group_id: 4, mood_group_order: 0, icon_id: 4, predefined_name_id: 4, state: 0, createdAt: 1_700_000_000_000 },
  { id: 5, custom_name: '', mood_group_id: 5, mood_group_order: 0, icon_id: 5, predefined_name_id: 5, state: 0, createdAt: 1_700_000_000_000 },
  { id: 6, custom_name: 'Ecstatic', mood_group_id: 1, mood_group_order: 1, icon_id: 14, predefined_name_id: -1, state: 0, createdAt: 1_700_000_000_000 },
  { id: 7, custom_name: 'Grumpy', mood_group_id: 4, mood_group_order: 1, icon_id: 15, predefined_name_id: -1, state: 0, createdAt: 1_700_000_000_000 },
];

let nextEntryId = 1;

/** One day entry; date fields are the LOCAL wall-clock time, month 0-based (as in Daylio). */
export function daylioEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: nextEntryId++,
    minute: 30,
    hour: 21,
    day: 15,
    month: 2, // March
    year: 2024,
    datetime: 1_710_534_600_000,
    timeZoneOffset: 3_600_000, // UTC+1
    mood: 2,
    note: '',
    note_title: '',
    tags: [],
    assets: [],
    ...overrides,
  };
}

/** A full backup JSON with sensible defaults; pass fields to override. */
export function daylioBackupJson(overrides: Record<string, unknown> = {}) {
  return {
    version: 15,
    isReminderOn: false,
    customMoods: daylioMoods(),
    tags: [
      { id: 14, name: 'Family', createdAt: 1_700_000_000_000, icon: 9, order: 2, state: 0, id_tag_group: 1 },
      { id: 15, name: 'Friends', createdAt: 1_700_000_000_000, icon: 10, order: 1, state: 0, id_tag_group: 1 },
      { id: 16, name: 'Running', createdAt: 1_700_000_000_000, icon: 300, order: 3, state: 0, id_tag_group: 2 },
      { id: 17, name: 'Reading', createdAt: 1_700_000_000_000, icon: 301, order: 4, state: 0, id_tag_group: 0 },
    ],
    tag_groups: [
      { id: 2, name: 'Hobbies', is_expanded: true, order: 2 },
      { id: 1, name: 'Social', is_expanded: true, order: 1 },
    ],
    dayEntries: [daylioEntry()],
    achievements: [],
    daysInRowLongestChain: 1,
    goals: [],
    prefs: [],
    metadata: { number_of_entries: 1, created_at: 1_710_534_600_000, is_auto_backup: false, platform: 'android', android_version: 15, number_of_photos: 0, photos_size: 0 },
    moodIconsPackId: 1,
    assets: [],
    goalEntries: [],
    goalSuccessWeeks: [],
    reminders: [],
    writingTemplates: [],
    moodIconsDefaultFreePackId: 1,
    ...overrides,
  };
}

/**
 * Zip a backup JSON the way Daylio does (deflated base64 member) or the way
 * rewriting tools do (`compress: false` = stored). `files` adds members such
 * as photos, by path.
 */
export function buildDaylioArchive(
  json: unknown,
  { files = {}, compress = true }: { files?: Record<string, Uint8Array>; compress?: boolean } = {}
): Uint8Array {
  const payload = strToU8(Buffer.from(JSON.stringify(json), 'utf8').toString('base64'));
  return zipSync({ 'backup.daylio': payload, ...files }, { level: compress ? 6 : 0 });
}

/**
 * A copy of `zip` whose member `name` CLAIMS to be `size` bytes uncompressed
 * (both the local header and the central directory say so), as a damaged or
 * hostile archive could. The real data is unchanged.
 */
export function claimUncompressedSize(zip: Uint8Array, name: string, size: number): Uint8Array {
  const out = zip.slice();
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const target = Buffer.from(name, 'utf8');
  let patched = 0;
  for (let i = 0; i + 4 <= out.length; i++) {
    const sig = view.getUint32(i, true);
    // local file header: name length at 26, name at 30, uncompressed size at 22
    // central directory header: name length at 28, name at 46, uncompressed size at 24
    const layout =
      sig === 0x04034b50 ? { len: 26, at: 30, size: 22 } : sig === 0x02014b50 ? { len: 28, at: 46, size: 24 } : null;
    if (!layout || i + layout.at > out.length) continue;
    const nameLength = view.getUint16(i + layout.len, true);
    if (Buffer.from(out.subarray(i + layout.at, i + layout.at + nameLength)).equals(target)) {
      view.setUint32(i + layout.size, size, true);
      patched += 1;
    }
  }
  if (patched !== 2) throw new Error(`expected a local and a central header for ${name}, patched ${patched}`);
  return out;
}
