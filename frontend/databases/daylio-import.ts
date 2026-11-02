import * as FileSystem from 'expo-file-system/legacy';

import type { ApplyBackupResult, EmbeddedPhoto } from '@/databases/data-export';
import { base64ToBytes } from '@/lib/backupCrypto';
import {
  DaylioConversion,
  DaylioFormatError,
  DaylioImportSummary,
  convertDaylio,
  daylioPhotoReader,
  readDaylioArchive,
} from '@/lib/daylioImport';

/** Largest .daylio file Restore opens. The whole file is held in memory while it imports. */
export const MAX_DAYLIO_FILE_BYTES = 300 * 1024 * 1024;
/** Bytes per file read; a multiple of 3 so every base64 chunk decodes on its own. */
const READ_CHUNK_BYTES = 3 * 1024 * 1024;

/**
 * Daylio backups (.daylio) in the Restore flow: databases/data-export.ts
 * detects them by their ZIP signature and calls in here to read, convert
 * (lib/daylioImport.ts) and describe them, then APPENDS the result.
 */

/** Human-readable preview of what an import will add, for the confirm dialog. */
export function describeDaylioImport(summary: DaylioImportSummary): string {
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const years =
    summary.firstDate && summary.lastDate
      ? ` (${summary.firstDate.slice(0, 4)}${summary.lastDate.slice(0, 4) !== summary.firstDate.slice(0, 4) ? `–${summary.lastDate.slice(0, 4)}` : ''})`
      : '';
  const parts = [
    `${plural(summary.entries, 'entry', 'entries')}${years}`,
    ...(summary.activities ? [plural(summary.activities, 'activity', 'activities')] : []),
    ...(summary.photos ? [plural(summary.photos, 'photo')] : []),
  ];
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
  const lines = [
    `${list} will be added to your data.`,
    'Moods are converted to SoulSync\'s scale: rad 9, good 7, meh 5, bad 3, awful 1. Entries you already have are skipped.',
  ];
  const { audioNotes, missingPhotos, unreadableEntries } = summary.skipped;
  if (audioNotes) lines.push(`${plural(audioNotes, 'voice note')} can't be imported.`);
  if (missingPhotos) lines.push(`${plural(missingPhotos, 'photo')} could not be read and will be left out.`);
  if (unreadableEntries) lines.push(`${plural(unreadableEntries, 'entry', 'entries')} could not be read and will be left out.`);
  return lines.join('\n\n');
}

/**
 * True when a file's first bytes (given as base64) are the ZIP signature
 * "PK\x03\x04". Compared as decoded BYTES: base64 packs 3 bytes per 4 chars,
 * so the 4th signature byte shares a character with whatever follows it and
 * no fixed base64 prefix is reliable.
 */
export function isZipHeader(firstBytesBase64: string): boolean {
  let head: Uint8Array;
  try {
    head = base64ToBytes(firstBytesBase64.slice(0, 8));
  } catch {
    return false;
  }
  return head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
}

export interface DaylioFile extends DaylioConversion {
  /** Bytes for a converted photo (it carries only `daylio_member`); pass as applyBackupData's `readPhoto`. */
  readPhoto: (photo: { daylio_member?: unknown }) => EmbeddedPhoto | null;
}

/**
 * The file's bytes, read in chunks into one buffer so the whole file never
 * also sits in memory as a base64 string (a third bigger). Falls back to one
 * read when the size is unknown.
 */
async function readFileBytes(uri: string, size: number | undefined): Promise<Uint8Array> {
  const read = (position?: number, length?: number) =>
    FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64, position, length });
  if (!size) return base64ToBytes(await read());
  const bytes = new Uint8Array(size);
  let offset = 0;
  while (offset < size) {
    const chunk = base64ToBytes(await read(offset, Math.min(READ_CHUNK_BYTES, size - offset)));
    if (chunk.length === 0) break;
    bytes.set(chunk.subarray(0, size - offset), offset);
    offset += chunk.length;
  }
  return offset < size ? bytes.subarray(0, offset) : bytes;
}

/** Read and convert a picked Daylio backup. Throws DaylioFormatError for a file it cannot read. */
export async function readDaylioFile(uri: string): Promise<DaylioFile> {
  const info = await FileSystem.getInfoAsync(uri);
  const size = info.exists && typeof info.size === 'number' ? info.size : undefined;
  if (size !== undefined && size > MAX_DAYLIO_FILE_BYTES) {
    throw new DaylioFormatError(
      `This Daylio backup is too large to import (over ${MAX_DAYLIO_FILE_BYTES / 1024 / 1024} MB).`
    );
  }
  const archive = readDaylioArchive(await readFileBytes(uri, size));
  const conversion = convertDaylio(archive);
  const read = daylioPhotoReader(archive, conversion.photoMembers);
  return {
    ...conversion,
    readPhoto: photo => (typeof photo?.daylio_member === 'string' ? read(photo.daylio_member) : null),
  };
}

/** The result line after a Daylio import. */
export function daylioImportMessage({ importedEntries, skippedDuplicates, unreadablePhotos }: ApplyBackupResult): string {
  const entries = (n: number) => `${n} ${n === 1 ? 'entry' : 'entries'}`;
  if (importedEntries === 0) {
    return `Nothing new to import: ${skippedDuplicates === 1 ? 'the entry is' : `all ${entries(skippedDuplicates)} are`} already here.`;
  }
  const skipped = skippedDuplicates
    ? ` ${entries(skippedDuplicates)} ${skippedDuplicates === 1 ? 'was' : 'were'} already here and skipped.`
    : '';
  const photos = unreadablePhotos
    ? ` ${unreadablePhotos} ${unreadablePhotos === 1 ? 'photo' : 'photos'} could not be read and ${unreadablePhotos === 1 ? 'was' : 'were'} left out.`
    : '';
  return `Imported ${entries(importedEntries)} from Daylio.${skipped}${photos}`;
}
