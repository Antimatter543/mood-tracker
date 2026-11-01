/**
 * The Daylio -> SoulSync converter (lib/daylioImport.ts), on synthetic
 * backups shaped like real ones (__fixtures__/daylioBackup.ts).
 *
 * What this locks:
 *  - Both archive flavours open (Daylio's own deflated export, and the stored
 *    member tools write), and anything else fails with a readable reason.
 *  - Moods: the 5 levels map to 9/7/5/3/1, custom moods take their level's
 *    value, and every converted mood is on SoulSync's 0-10 scale.
 *  - Dates: month is 0-based and the zone offset is applied, giving the UTC
 *    instant SoulSync stores; the explicit fields win over `datetime`.
 *  - Notes: title + body, Daylio's HTML turned into plain text.
 *  - Activities: groups in Daylio's order, ungrouped tags in "Daylio",
 *    duplicates merged, every entry link mapped.
 *  - Photos: embedded with a detected extension; audio and unreadable files
 *    are counted, not imported.
 */
import { strToU8, zipSync } from 'fflate';

import {
  DAYLIO_MOOD_VALUES,
  DaylioFormatError,
  UNGROUPED_ACTIVITIES_GROUP,
  convertDaylio,
  daylioEntryDate,
  daylioHtmlToText,
  daylioNote,
  detectImageExtension,
  readDaylioArchive,
} from '@/lib/daylioImport';
import {
  JPEG_BYTES,
  PNG_BYTES,
  buildDaylioArchive,
  daylioBackupJson,
  daylioEntry,
} from '../__fixtures__/daylioBackup';

const convert = (json: unknown, files?: Record<string, Uint8Array>) =>
  convertDaylio(readDaylioArchive(buildDaylioArchive(json, { files })));
const entriesOf = (c: ReturnType<typeof convert>) => c.backup.data.entries as any[];

describe('readDaylioArchive', () => {
  it.each([
    ['deflated (Daylio export)', true],
    ['stored (tool-written)', false],
  ])('opens a %s backup', (_name, compress) => {
    const archive = readDaylioArchive(buildDaylioArchive(daylioBackupJson(), { compress }));
    expect(archive.backup.version).toBe(15);
    expect(archive.backup.dayEntries).toHaveLength(1);
  });

  it('keeps the other members (photos) and drops backup.daylio from them', () => {
    const archive = readDaylioArchive(
      buildDaylioArchive(daylioBackupJson(), { files: { 'assets/photos/2024/3/abc': JPEG_BYTES } })
    );
    expect(Object.keys(archive.files)).toEqual(['assets/photos/2024/3/abc']);
  });

  it.each([
    ['not a zip', strToU8('just some text')],
    ['a zip without backup.daylio', zipSync({ 'other.json': strToU8('{}') })],
    ['damaged base64/JSON', zipSync({ 'backup.daylio': strToU8('%%%not base64%%%') })],
    ['JSON without day entries', buildDaylioArchive({ version: 15, customMoods: [] })],
  ])('rejects %s with a readable DaylioFormatError', (_name, bytes) => {
    expect(() => readDaylioArchive(bytes)).toThrow(DaylioFormatError);
  });

  // A ZIP can hold anything: only a damaged DAYLIO backup is reported as such;
  // everything else is flagged "not Daylio" so Restore says "not supported".
  const errorOf = (bytes: Uint8Array) => {
    try {
      readDaylioArchive(bytes);
    } catch (e) {
      return e as DaylioFormatError;
    }
    throw new Error('expected a DaylioFormatError');
  };
  const b64 = (text: string) => strToU8(Buffer.from(text).toString('base64'));

  it.each([
    ['not a zip', strToU8('just some text')],
    ['a zip without backup.daylio', zipSync({ 'other.json': strToU8('{}') })],
    ['backup.daylio holding other JSON', zipSync({ 'backup.daylio': b64('{"foo":1}') })],
    ['backup.daylio holding a SoulSync backup', zipSync({ 'backup.daylio': b64('{"version":3,"data":{}}') })],
  ])('flags %s as not Daylio', (_name, bytes) => {
    expect(errorOf(bytes).notDaylio).toBe(true);
  });

  it('a damaged Daylio backup is NOT flagged as foreign', () => {
    expect(errorOf(zipSync({ 'backup.daylio': strToU8('%%%not base64%%%') })).notDaylio).toBe(false);
  });
});

describe('moods', () => {
  it('maps the five levels to 9 / 7 / 5 / 3 / 1 and custom moods to their level', () => {
    const json = daylioBackupJson({
      dayEntries: [1, 2, 3, 4, 5, 6, 7].map(mood => daylioEntry({ mood })),
    });
    expect(entriesOf(convert(json)).map(e => e.mood)).toEqual([9, 7, 5, 3, 1, 9, 3]);
  });

  it('every level maps onto the 0-10 scale, best to worst', () => {
    const values = [1, 2, 3, 4, 5].map(level => DAYLIO_MOOD_VALUES[level]);
    values.forEach(v => expect(v).toBeGreaterThanOrEqual(0));
    values.forEach(v => expect(v).toBeLessThanOrEqual(10));
    expect([...values].sort((a, b) => b - a)).toEqual(values);
  });

  it('skips (and counts) an entry whose mood does not exist', () => {
    const c = convert(daylioBackupJson({ dayEntries: [daylioEntry({ mood: 99 }), daylioEntry()] }));
    expect(c.summary.entries).toBe(1);
    expect(c.summary.skipped.unreadableEntries).toBe(1);
  });
});

describe('dates', () => {
  it('reads month as 0-based and applies the zone offset', () => {
    // 15 March 2024, 21:30 local at UTC+1 -> 20:30Z
    expect(daylioEntryDate(daylioEntry() as any)).toBe('2024-03-15T20:30:00.000Z');
  });

  it('handles negative offsets and day/year rollover', () => {
    // 31 December 2023, 22:00 local at UTC-5 -> 1 January 2024, 03:00Z
    const entry = daylioEntry({ year: 2023, month: 11, day: 31, hour: 22, minute: 0, timeZoneOffset: -5 * 3_600_000 });
    expect(daylioEntryDate(entry as any)).toBe('2024-01-01T03:00:00.000Z');
  });

  it('trusts the explicit fields over a placeholder datetime (tool-written backups)', () => {
    const entry = daylioEntry({ datetime: 0 });
    expect(daylioEntryDate(entry as any)).toBe('2024-03-15T20:30:00.000Z');
  });

  it('falls back to datetime when the fields are missing', () => {
    const entry = { ...daylioEntry(), year: undefined, datetime: 1_700_000_000_000 };
    expect(daylioEntryDate(entry as any)).toBe(new Date(1_700_000_000_000).toISOString());
  });

  it('reports the date range', () => {
    const c = convert(
      daylioBackupJson({
        dayEntries: [daylioEntry({ year: 2021, month: 0, day: 2 }), daylioEntry({ year: 2024, month: 5, day: 1 })],
      })
    );
    expect(c.summary.firstDate?.slice(0, 10)).toBe('2021-01-02');
    expect(c.summary.lastDate?.slice(0, 10)).toBe('2024-06-01');
  });
});

describe('notes', () => {
  it('turns Daylio HTML into plain text', () => {
    expect(daylioHtmlToText("Hey<br><br><br>there &amp; <b>bold</b> it&#39;s &#x1F642;<br/>end")).toBe(
      "Hey\n\nthere & bold it's \u{1F642}\nend"
    );
  });

  it('joins title and body, and is null when both are empty', () => {
    expect(daylioNote({ note_title: 'Title', note: 'Body<br>line' })).toBe('Title\n\nBody\nline');
    expect(daylioNote({ note_title: '', note: 'Only body' })).toBe('Only body');
    expect(daylioNote({ note_title: 'Only title', note: '' })).toBe('Only title');
    expect(daylioNote({ note_title: '', note: '<br>' })).toBeNull();
  });
});

describe('activities', () => {
  const groupsOf = (c: ReturnType<typeof convert>) => c.backup.data.activityGroups as any[];
  const activitiesOf = (c: ReturnType<typeof convert>) => c.backup.data.activities as any[];

  it('keeps Daylio group order and puts ungrouped tags in a "Daylio" group', () => {
    const c = convert(daylioBackupJson());
    expect(groupsOf(c).map(g => g.name)).toEqual(['Social', 'Hobbies', UNGROUPED_ACTIVITIES_GROUP]);
    const groupName = (id: number) => groupsOf(c).find(g => g.id === id).name;
    expect(activitiesOf(c).map(a => [a.name, groupName(a.group_id)])).toEqual([
      ['Friends', 'Social'],
      ['Family', 'Social'],
      ['Running', 'Hobbies'],
      ['Reading', UNGROUPED_ACTIVITIES_GROUP],
    ]);
    activitiesOf(c).forEach(a => expect([a.icon_family, a.icon_name]).toEqual(['Feather', 'circle']));
  });

  it('links each entry to its activities, merging same-named tags in a group', () => {
    const json = daylioBackupJson({
      tags: [
        ...daylioBackupJson().tags,
        { id: 18, name: ' family ', createdAt: 0, icon: 9, order: 5, state: 1, id_tag_group: 1 },
      ],
      dayEntries: [daylioEntry({ tags: [14, 16, 18, 999] })],
    });
    const c = convert(json);
    const names = new Map(activitiesOf(c).map(a => [String(a.id), a.name]));
    const linked = entriesOf(c)[0].activity_ids.split(',').map((id: string) => names.get(id));
    expect(linked).toEqual(['Family', 'Running']);
    expect(c.summary.activities).toBe(4);
  });

  it('an entry without tags has no activity_ids', () => {
    expect(entriesOf(convert(daylioBackupJson()))[0].activity_ids).toBeNull();
  });
});

describe('photos and audio', () => {
  const assets = [
    { id: 1, type: 1, checksum: 'aaa111', createdAt: 0, createdAtOffset: 0, android_metadata: '{}' },
    { id: 2, type: 1, checksum: 'bbb222', createdAt: 0, createdAtOffset: 0, android_metadata: '{}' },
    { id: 3, type: 2, checksum: 'ccc333', createdAt: 0, createdAtOffset: 0, android_metadata: '{}' },
    { id: 4, type: 1, checksum: 'ddd444', createdAt: 0, createdAtOffset: 0, android_metadata: '{}' },
    { id: 5, type: 1, checksum: 'eee555', createdAt: 0, createdAtOffset: 0, android_metadata: '{}' },
  ];
  const files = {
    'assets/photos/2024/3/aaa111': JPEG_BYTES,
    'assets/photos/2024/3/bbb222': PNG_BYTES,
    'assets/audio/2024/3/ccc333': new Uint8Array(20),
    'assets/photos/2024/3/ddd444': strToU8('not an image at all'),
  };

  it('embeds readable photos and counts what is left out', () => {
    const c = convert(daylioBackupJson({ assets, dayEntries: [daylioEntry({ assets: [1, 2, 3, 4, 5, 77] })] }), files);
    const photos = entriesOf(c)[0].photos;
    expect(photos.map((p: any) => p.ext)).toEqual(['jpg', 'png']);
    expect(Buffer.from(photos[0].data_base64, 'base64').equals(Buffer.from(JPEG_BYTES))).toBe(true);
    expect(c.summary.photos).toBe(2);
    // audio 3; unreadable file 4, missing file 5, unknown asset 77
    expect(c.summary.skipped).toEqual({ audioNotes: 1, missingPhotos: 3, unreadableEntries: 0 });
  });

  it.each([
    ['jpg', JPEG_BYTES],
    ['png', PNG_BYTES],
    ['webp', strToU8('RIFF\0\0\0\0WEBPVP8 ')],
    ['gif', strToU8('GIF89a\0\0\0\0\0\0')],
    ['heic', new Uint8Array([0, 0, 0, 0x18, ...strToU8('ftypheic'), 0, 0])],
  ])('detects %s', (ext, bytes) => {
    expect(detectImageExtension(bytes)).toBe(ext);
  });

  it('does not take arbitrary bytes for an image', () => {
    expect(detectImageExtension(strToU8('hello world, not an image'))).toBeNull();
    expect(detectImageExtension(new Uint8Array(3))).toBeNull();
  });
});

describe('output', () => {
  it('is a v3 SoulSync backup that changes no settings', () => {
    const c = convert(daylioBackupJson());
    expect(c.backup.version).toBe(3);
    expect(c.backup.data.settings).toEqual([]);
    expect(entriesOf(c)[0]).toMatchObject({ mood: 7, date: '2024-03-15T20:30:00.000Z', starred_at: null, photos: [] });
  });

  it('converts an empty diary to nothing', () => {
    const c = convert(daylioBackupJson({ dayEntries: [] }));
    expect(c.summary).toMatchObject({ entries: 0, firstDate: null, lastDate: null });
  });
});
