import * as FileSystem from 'expo-file-system/legacy';

import type { ApplyBackupResult } from '@/databases/data-export';
import { base64ToBytes } from '@/lib/backupCrypto';
import {
  DaylioConversion,
  DaylioImportSummary,
  convertDaylio,
  readDaylioArchive,
} from '@/lib/daylioImport';

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

/** Read and convert a picked Daylio backup. Throws DaylioFormatError for a file it cannot read. */
export async function readDaylioFile(uri: string): Promise<DaylioConversion> {
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  return convertDaylio(readDaylioArchive(base64ToBytes(base64)));
}

/** The result line after a Daylio import. */
export function daylioImportMessage({ importedEntries, skippedDuplicates }: ApplyBackupResult): string {
  const entries = (n: number) => `${n} ${n === 1 ? 'entry' : 'entries'}`;
  if (importedEntries === 0) {
    return `Nothing new to import: ${skippedDuplicates === 1 ? 'the entry is' : `all ${entries(skippedDuplicates)} are`} already here.`;
  }
  const skipped = skippedDuplicates
    ? ` ${entries(skippedDuplicates)} ${skippedDuplicates === 1 ? 'was' : 'were'} already here and skipped.`
    : '';
  return `Imported ${entries(importedEntries)} from Daylio.${skipped}`;
}
