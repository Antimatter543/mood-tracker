import { unzipSync } from 'fflate';

import { base64ToBytes } from '@/lib/backupCrypto';

/**
 * Daylio backup (.daylio) -> SoulSync v3 backup object. Pure: no React, no DB.
 *
 * THE DAYLIO FORMAT (schema v15-v18; no official spec, reconstructed from
 * open-source readers: DaylioBackupTools, dayligo, daylio-markdown-export):
 *  - The file is a ZIP. `backup.daylio` inside it is base64 of UTF-8 JSON.
 *    Daylio's own exports deflate it; tools that rewrite backups store it.
 *  - `customMoods`: the 5 predefined moods (`predefined_name_id` 1..5) plus
 *    user moods (`predefined_name_id` -1), each in a `mood_group_id` 1..5,
 *    where 1 = rad (best) ... 5 = awful.
 *  - `tags` are activities, grouped by `id_tag_group` -> `tag_groups[].id`
 *    (0 = no group). `order` is the display order.
 *  - `dayEntries`: `mood` (a customMoods id), `tags` (ids), `assets` (ids),
 *    `note_title` + `note` (HTML: `<br>` line breaks, entities), and the
 *    local wall-clock time as `year` / `month` (0-BASED) / `day` / `hour` /
 *    `minute` plus `timeZoneOffset` (ms east of UTC). `datetime` is the epoch
 *    ms, but files rewritten by tools carry placeholders there, so the
 *    explicit fields are the source of truth.
 *  - `assets`: `{ id, type: 1 photo | 2 audio, checksum }`. A photo's bytes
 *    are the zip member `assets/photos/<year>/<month>/<checksum>` (no
 *    extension). Matched on the exact file name (extension stripped), by
 *    checksum, or by asset id as other readers fall back to.
 *  - `tags[].state`: 0 = in use; anything else is archived in Daylio.
 *
 * MEMORY: a phone has far less RAM than a backup can claim. Only
 * `backup.daylio` and the photos actually used are ever inflated, each under
 * a size ceiling checked BEFORE inflating (fflate allocates a member's
 * claimed size up front), and photos are inflated a batch at a time while
 * they are written (daylioPhotoReader), never all at once.
 */

/** Daylio mood level (1 = rad ... 5 = awful) -> SoulSync 0-10 mood. */
export const DAYLIO_MOOD_VALUES: Readonly<Record<number, number>> = {
  1: 9, // rad   -> "Terrific"
  2: 7, // good  -> "Good"
  3: 5, // meh   -> "Neutral"
  4: 3, // bad
  5: 1, // awful
};

/** Group for Daylio activities that are not in any tag group. */
export const UNGROUPED_ACTIVITIES_GROUP = 'Daylio';

const PHOTO_ASSET = 1;
const AUDIO_ASSET = 2;

/** Largest `backup.daylio` (base64 JSON text) that is inflated. Real ones are a few MB. */
export const MAX_DAYLIO_JSON_BYTES = 64 * 1024 * 1024;
/** Largest single photo that is inflated; a bigger one is left out. */
export const MAX_DAYLIO_PHOTO_BYTES = 30 * 1024 * 1024;
/** Photos inflated together at most (one unzip pass per batch). */
const PHOTO_BATCH_BYTES = 48 * 1024 * 1024;

/**
 * A user-readable reason the file cannot be imported. `notDaylio` = the file
 * is something else entirely (any other ZIP), as opposed to a Daylio backup
 * that is damaged, so the caller can say "not a supported backup" instead.
 */
export class DaylioFormatError extends Error {
  constructor(message: string, readonly notDaylio = false) {
    super(message);
    this.name = 'DaylioFormatError';
  }
}

interface DaylioMood {
  id: number;
  mood_group_id: number;
}

interface DaylioTag {
  id: number;
  name: string;
  order?: number;
  id_tag_group?: number;
  /** 0 = in use; other values = archived. */
  state?: number;
}

interface DaylioTagGroup {
  id: number;
  name: string;
  order?: number;
}

interface DaylioEntry {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  timeZoneOffset?: number;
  datetime?: number;
  mood: number;
  note?: string;
  note_title?: string;
  tags?: number[];
  assets?: number[];
}

interface DaylioAsset {
  id: number;
  type: number;
  checksum: string;
}

export interface DaylioBackup {
  version?: number;
  customMoods: DaylioMood[];
  tags?: DaylioTag[];
  tag_groups?: DaylioTagGroup[];
  dayEntries: DaylioEntry[];
  assets?: DaylioAsset[];
}

/** A zip member as its central directory describes it (nothing inflated). */
export interface DaylioZipMember {
  name: string;
  /** The uncompressed size the archive CLAIMS (inflating allocates this much). */
  originalSize: number;
}

export interface DaylioArchive {
  backup: DaylioBackup;
  /** Every other zip member (photos live here), not inflated. */
  members: DaylioZipMember[];
  /** The whole .daylio file, to inflate photos from as they are needed. */
  bytes: Uint8Array;
}

const isMainMember = (name: string) => name === 'backup.daylio' || name.endsWith('/backup.daylio');

/** Open a .daylio file (raw bytes). Throws DaylioFormatError if it is not one. */
export function readDaylioArchive(bytes: Uint8Array): DaylioArchive {
  const members: DaylioZipMember[] = [];
  const found: { main?: DaylioZipMember } = {};
  let inflated: Record<string, Uint8Array>;
  try {
    // Only backup.daylio is inflated here, and only when its claimed size is
    // sane; everything else is just listed.
    inflated = unzipSync(bytes, {
      filter: ({ name, originalSize }) => {
        if (!found.main && isMainMember(name)) {
          found.main = { name, originalSize };
          return originalSize <= MAX_DAYLIO_JSON_BYTES;
        }
        if (!name.endsWith('/')) members.push({ name, originalSize });
        return false;
      },
    });
  } catch {
    throw new DaylioFormatError('This is not a Daylio backup (expected a .daylio file).', true);
  }
  const main = found.main;
  if (!main) {
    throw new DaylioFormatError('This file does not contain a Daylio backup.', true);
  }
  if (main.originalSize > MAX_DAYLIO_JSON_BYTES) {
    throw new DaylioFormatError('This Daylio backup is too large to import.');
  }

  let backup: unknown;
  try {
    const base64 = new TextDecoder().decode(inflated[main.name]).replace(/\s+/g, '');
    backup = JSON.parse(new TextDecoder().decode(base64ToBytes(base64)));
  } catch {
    throw new DaylioFormatError('The Daylio backup inside this file is damaged.');
  }
  // A ZIP can hold anything; only Daylio's own JSON shape counts as Daylio.
  if (
    !backup ||
    typeof backup !== 'object' ||
    typeof (backup as DaylioBackup).version !== 'number' ||
    !Array.isArray((backup as DaylioBackup).dayEntries) ||
    !Array.isArray((backup as DaylioBackup).customMoods)
  ) {
    throw new DaylioFormatError('This file does not contain a Daylio backup.', true);
  }

  return { backup: backup as DaylioBackup, members, bytes };
}

/** A zip member's file name without folders or extension, lowercased: how photos are matched. */
const memberStem = (name: string) =>
  (name.split('/').pop() ?? '').replace(/\.[^.]*$/, '').toLowerCase();

/** Photo bytes as base64 plus the extension detected from them. */
export interface DaylioPhoto {
  base64: string;
  ext: string;
}

/**
 * Reads photo members on demand, for the import to write one at a time.
 * `order` is the order photos will be asked for; each unzip pass inflates the
 * asked-for photo plus the next ones up to PHOTO_BATCH_BYTES, so memory stays
 * bounded and the archive is not rescanned per photo. Returns null for a
 * missing, oversized or non-image member.
 */
export function daylioPhotoReader(
  archive: Pick<DaylioArchive, 'members' | 'bytes'>,
  order: readonly string[]
): (member: string) => DaylioPhoto | null {
  const sizeOf = new Map(archive.members.map(m => [m.name, m.originalSize]));
  const fits = (name: string) => (sizeOf.get(name) ?? Infinity) <= MAX_DAYLIO_PHOTO_BYTES;
  const queue = [...new Set(order)].filter(fits);
  let batch: Record<string, Uint8Array> = {};

  const inflateBatchFrom = (member: string) => {
    const wanted = new Set<string>([member]);
    let total = sizeOf.get(member) ?? 0;
    const start = queue.indexOf(member);
    for (let i = start + 1; start >= 0 && i < queue.length; i++) {
      const size = sizeOf.get(queue[i]) ?? 0;
      if (total + size > PHOTO_BATCH_BYTES) break;
      wanted.add(queue[i]);
      total += size;
    }
    batch = {}; // let the previous batch go before inflating the next
    batch = unzipSync(archive.bytes, {
      filter: ({ name, originalSize }) => wanted.has(name) && originalSize <= MAX_DAYLIO_PHOTO_BYTES,
    });
  };

  return (member: string) => {
    if (!fits(member)) return null;
    if (!(member in batch)) {
      try {
        inflateBatchFrom(member);
      } catch {
        return null;
      }
    }
    const bytes = batch[member];
    const ext = bytes ? detectImageExtension(bytes) : null;
    return bytes && ext ? { base64: bytesToBase64Chunked(bytes), ext } : null;
  };
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Daylio note HTML -> plain text: `<br>` / block ends become newlines, entities decoded, other tags dropped. */
export function daylioHtmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    // Only things shaped like tags: "I <3 you" and "a < b" are text.
    .replace(/<\/?[a-z][^<>]*>/gi, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
      if (code[0] === '#') {
        const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : match;
      }
      return ENTITIES[code.toLowerCase()] ?? match;
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The entry's note: "Title\n\nBody", either part optional; null when both are empty. */
export function daylioNote(entry: Pick<DaylioEntry, 'note' | 'note_title'>): string | null {
  const title = daylioHtmlToText(entry.note_title ?? '');
  const body = daylioHtmlToText(entry.note ?? '');
  const note = [title, body].filter(Boolean).join('\n\n');
  return note || null;
}

/**
 * The entry's instant as UTC ISO (how SoulSync stores `entries.date`): the
 * local wall-clock fields minus the zone offset they were recorded in.
 */
export function daylioEntryDate(entry: DaylioEntry): string | null {
  const { year, month, day, hour, minute } = entry;
  if ([year, month, day, hour, minute].every(Number.isInteger)) {
    const offset = Number.isFinite(entry.timeZoneOffset) ? (entry.timeZoneOffset as number) : 0;
    const ms = Date.UTC(year, month, day, hour, minute) - offset;
    if (Number.isFinite(ms)) return new Date(ms).toISOString();
  }
  if (Number.isFinite(entry.datetime)) return new Date(entry.datetime as number).toISOString();
  return null;
}

/** Image file extension from the first bytes, or null when not a supported image. */
export function detectImageExtension(bytes: Uint8Array): string | null {
  const at = (i: number) => bytes[i];
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length < 12) return null;
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'jpg';
  if (at(0) === 0x89 && ascii(1, 4) === 'PNG') return 'png';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
  if (ascii(0, 4) === 'GIF8') return 'gif';
  if (ascii(4, 8) === 'ftyp' && ['heic', 'heix', 'mif1', 'msf1'].includes(ascii(8, 12))) return 'heic';
  return null;
}

/** Base64 of bytes, in chunks (one char per byte would be quadratic-ish on Hermes for multi-MB photos). */
function bytesToBase64Chunked(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(binary);
}

export interface DaylioImportSummary {
  entries: number;
  activities: number;
  groups: number;
  photos: number;
  /** Earliest and latest entry date (UTC ISO), null when there are no entries. */
  firstDate: string | null;
  lastDate: string | null;
  /** Things that exist in Daylio but are not imported. */
  skipped: {
    audioNotes: number;
    missingPhotos: number;
    unreadableEntries: number;
  };
}

export interface DaylioConversion {
  /** A SoulSync v3 backup object; import it with `appendEntries`. */
  backup: {
    version: 3;
    exportDate: string;
    source: 'daylio';
    data: {
      entries: unknown[];
      activities: unknown[];
      activityGroups: unknown[];
      settings: never[];
    };
  };
  summary: DaylioImportSummary;
  /**
   * The zip member of every photo in `backup`, in the order the import reads
   * them (for daylioPhotoReader). Photos in `backup` carry only
   * `daylio_member`, no bytes, until they are written.
   */
  photoMembers: string[];
}

const key = (name: string) => name.trim().toLowerCase();

/** Convert an opened Daylio archive into a SoulSync v3 backup object plus a summary. */
export function convertDaylio({ backup, members }: Pick<DaylioArchive, 'backup' | 'members'>): DaylioConversion {
  // Groups, in Daylio's order; same-named groups merge. Ungrouped tags get one extra group.
  const groups: { id: number; name: string }[] = [];
  const groupIdByKey = new Map<string, number>();
  const groupFor = (name: string): number => {
    const k = key(name);
    let id = groupIdByKey.get(k);
    if (id === undefined) {
      id = groups.length + 1;
      groups.push({ id, name: name.trim() });
      groupIdByKey.set(k, id);
    }
    return id;
  };
  const daylioGroupName = new Map<number, string>();
  for (const g of [...(backup.tag_groups ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
    if (typeof g?.name === 'string' && g.name.trim()) daylioGroupName.set(g.id, g.name);
  }

  // Activities, in display order; a name repeated within one group is one activity.
  const activities: { id: number; name: string; group_id: number; icon_family: string; icon_name: string; position: number }[] = [];
  const activityIdByTagId = new Map<number, number>();
  const activityIdByKey = new Map<string, number>();
  // An archived tag (state != 0) only comes along when an entry still uses it.
  const usedTagIds = new Set(backup.dayEntries.flatMap(e => (Array.isArray(e?.tags) ? e.tags : [])));
  const isArchived = (t: DaylioTag) => typeof t.state === 'number' && t.state !== 0;
  const tags = [...(backup.tags ?? [])].filter(
    t => typeof t?.name === 'string' && t.name.trim() && (!isArchived(t) || usedTagIds.has(t.id))
  );
  tags.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  for (const tag of tags) {
    const groupId = groupFor(daylioGroupName.get(tag.id_tag_group ?? 0) ?? UNGROUPED_ACTIVITIES_GROUP);
    const k = `${groupId}|${key(tag.name)}`;
    let id = activityIdByKey.get(k);
    if (id === undefined) {
      id = activities.length + 1;
      activities.push({
        id,
        name: tag.name.trim(),
        group_id: groupId,
        // Daylio's icon ids map to its own icon set; SoulSync's default icon instead.
        icon_family: 'Feather',
        icon_name: 'circle',
        position: activities.filter(a => a.group_id === groupId).length,
      });
      activityIdByKey.set(k, id);
    }
    activityIdByTagId.set(tag.id, id);
  }

  const moodValueById = new Map<number, number>();
  for (const mood of backup.customMoods) {
    const value = DAYLIO_MOOD_VALUES[mood?.mood_group_id];
    if (value !== undefined) moodValueById.set(mood.id, value);
  }

  const assetsById = new Map<number, DaylioAsset>();
  for (const asset of backup.assets ?? []) {
    if (asset && Number.isInteger(asset.id)) assetsById.set(asset.id, asset);
  }
  // Photo members by exact file name (extension stripped); first one wins.
  const memberByStem = new Map<string, DaylioZipMember>();
  for (const member of members) {
    const stem = memberStem(member.name);
    if (stem && !memberByStem.has(stem)) memberByStem.set(stem, member);
  }
  const photoMembers: string[] = [];
  const photoFor = (asset: DaylioAsset) => {
    const byChecksum = typeof asset.checksum === 'string' && asset.checksum ? memberByStem.get(asset.checksum.toLowerCase()) : undefined;
    const member = byChecksum ?? memberByStem.get(String(asset.id));
    if (!member || member.originalSize > MAX_DAYLIO_PHOTO_BYTES) return null;
    photoMembers.push(member.name);
    return { media_type: 'image', file_path: '', daylio_member: member.name };
  };

  const summary: DaylioImportSummary = {
    entries: 0,
    activities: activities.length,
    groups: groups.length,
    photos: 0,
    firstDate: null,
    lastDate: null,
    skipped: { audioNotes: 0, missingPhotos: 0, unreadableEntries: 0 },
  };

  const entries: unknown[] = [];
  for (const entry of backup.dayEntries) {
    const mood = moodValueById.get(entry?.mood);
    const date = entry ? daylioEntryDate(entry) : null;
    if (mood === undefined || date === null) {
      summary.skipped.unreadableEntries += 1;
      continue;
    }

    const photos = [];
    for (const assetId of entry.assets ?? []) {
      const asset = assetsById.get(assetId);
      if (asset?.type === AUDIO_ASSET) {
        summary.skipped.audioNotes += 1;
        continue;
      }
      const photo = asset && asset.type === PHOTO_ASSET ? photoFor(asset) : null;
      if (photo) photos.push(photo);
      else summary.skipped.missingPhotos += 1;
    }

    const activityIds = [...new Set((entry.tags ?? []).map(t => activityIdByTagId.get(t)).filter(Boolean))];
    entries.push({
      // Only used to pair photos with their entry during the import; the
      // database assigns the real id (append mode).
      id: entries.length + 1,
      mood,
      notes: daylioNote(entry),
      date,
      starred_at: null,
      activity_ids: activityIds.length ? activityIds.join(',') : null,
      photos,
    });
    summary.entries += 1;
    summary.photos += photos.length;
    if (!summary.firstDate || date < summary.firstDate) summary.firstDate = date;
    if (!summary.lastDate || date > summary.lastDate) summary.lastDate = date;
  }

  return {
    backup: {
      version: 3,
      exportDate: new Date().toISOString(),
      source: 'daylio',
      data: { entries, activities, activityGroups: groups, settings: [] },
    },
    summary,
    photoMembers,
  };
}
