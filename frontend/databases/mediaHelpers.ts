import * as FileSystem from 'expo-file-system';

/**
 * File-storage helpers for entry photo attachments.
 *
 * Privacy contract: every photo lives 100% on-device, copied out of the
 * picker's volatile cache directory into a stable, app-private folder under
 * `FileSystem.documentDirectory`. We never store a cache URI in the DB — those
 * get garbage-collected by the OS and would leave broken thumbnails.
 *
 * Filenames are generated with a timestamp + random suffix (no two-phase
 * rename), so a photo can be copied before its entry row even exists.
 */

/** Persistent directory for all entry photos. Created on first use. */
export const MEDIA_DIR = `${FileSystem.documentDirectory}entry_media/`;

/** Ensure the media directory exists (idempotent). */
export async function ensureMediaDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(MEDIA_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(MEDIA_DIR, { intermediates: true });
  }
}

/**
 * Build a unique destination filename for a picked source URI.
 *
 * Scheme: `<13-digit-timestamp>_<random>.<ext>` (e.g. `1717800000000_a1b2c3.jpg`).
 * The extension is derived from the source URI (query string stripped) and
 * normalised to lowercase; defaults to `jpg` when none is present. The
 * timestamp+random pair makes two calls with the same source produce distinct
 * names, so we never collide or need to rename after the DB insert returns.
 */
export function buildMediaFilename(sourceUri: string): string {
  const rawExt = sourceUri.split('.').pop()?.split('?')[0] ?? 'jpg';
  // Guard against a "filename with no dot" producing the whole path as ext.
  const ext = rawExt.includes('/') || rawExt === '' ? 'jpg' : rawExt.toLowerCase();
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `${ts}_${rand}.${ext}`;
}

/**
 * Copy `sourceUri` into MEDIA_DIR under a fresh filename. Returns the stable
 * absolute destination path. Ensures the directory exists first.
 */
export async function copyToMediaDir(sourceUri: string): Promise<string> {
  await ensureMediaDir();
  const filename = buildMediaFilename(sourceUri);
  const dest = `${MEDIA_DIR}${filename}`;
  await FileSystem.copyAsync({ from: sourceUri, to: dest });
  return dest;
}

/**
 * Delete a media file. Silently swallows "file not found" and any IO error —
 * the goal is no orphans, not crashing on a double-delete.
 */
export async function deleteMediaFile(filePath: string): Promise<void> {
  try {
    const info = await FileSystem.getInfoAsync(filePath);
    if (info.exists) {
      await FileSystem.deleteAsync(filePath, { idempotent: true });
    }
  } catch {
    // Swallow — file may already be gone, or the path may be on a volume we
    // can't touch. A failed cleanup must never block the user's action.
  }
}
