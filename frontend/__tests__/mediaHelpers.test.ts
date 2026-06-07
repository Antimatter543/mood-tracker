import * as FileSystem from 'expo-file-system';
jest.mock('expo-file-system');

import {
  MEDIA_DIR,
  buildMediaFilename,
  copyToMediaDir,
  deleteMediaFile,
  ensureMediaDir,
} from '@/databases/mediaHelpers';

beforeEach(() => {
  jest.clearAllMocks();
  // Restore mock defaults that individual tests may have overridden.
  (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({ exists: false });
  (FileSystem.makeDirectoryAsync as jest.Mock).mockResolvedValue(undefined);
  (FileSystem.copyAsync as jest.Mock).mockResolvedValue(undefined);
  (FileSystem.deleteAsync as jest.Mock).mockResolvedValue(undefined);
});

describe('MEDIA_DIR', () => {
  it('lives under the app documentDirectory in an entry_media folder', () => {
    expect(MEDIA_DIR).toBe(`${FileSystem.documentDirectory}entry_media/`);
    expect(MEDIA_DIR.endsWith('entry_media/')).toBe(true);
  });
});

describe('buildMediaFilename', () => {
  it('preserves the source extension', () => {
    expect(buildMediaFilename('file:///cache/IMG_1234.jpg').endsWith('.jpg')).toBe(true);
  });

  it('lowercases an uppercase extension', () => {
    expect(buildMediaFilename('some/path/photo.PNG').endsWith('.png')).toBe(true);
  });

  it('strips a query string from the extension', () => {
    expect(buildMediaFilename('https://x/y.jpeg?token=abc').endsWith('.jpeg')).toBe(true);
  });

  it('defaults to jpg when the source has no extension', () => {
    // A path with no dot must not yield the whole path as the "extension".
    expect(buildMediaFilename('file:///cache/no_extension_here').endsWith('.jpg')).toBe(true);
  });

  it('begins with a 13-digit millisecond timestamp', () => {
    expect(/^\d{13}_/.test(buildMediaFilename('x.jpg'))).toBe(true);
  });

  it('produces a unique filename on repeated calls with the same source', () => {
    const a = buildMediaFilename('x.jpg');
    const b = buildMediaFilename('x.jpg');
    expect(a).not.toBe(b);
  });
});

describe('ensureMediaDir', () => {
  it('creates the directory (with intermediates) when it is missing', async () => {
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({ exists: false });
    await ensureMediaDir();
    expect(FileSystem.makeDirectoryAsync).toHaveBeenCalledWith(MEDIA_DIR, {
      intermediates: true,
    });
  });

  it('does not recreate the directory when it already exists', async () => {
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({ exists: true });
    await ensureMediaDir();
    expect(FileSystem.makeDirectoryAsync).not.toHaveBeenCalled();
  });
});

describe('copyToMediaDir', () => {
  it('copies the source into MEDIA_DIR and returns the destination path', async () => {
    const dest = await copyToMediaDir('file:///cache/shot.jpg');

    expect(dest.startsWith(MEDIA_DIR)).toBe(true);
    expect(dest.endsWith('.jpg')).toBe(true);

    const copyArg = (FileSystem.copyAsync as jest.Mock).mock.calls[0][0];
    expect(copyArg.from).toBe('file:///cache/shot.jpg');
    expect(copyArg.to).toBe(dest);
  });
});

describe('deleteMediaFile', () => {
  it('deletes the file when it exists', async () => {
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({ exists: true });
    await deleteMediaFile('/some/path.jpg');
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith('/some/path.jpg', {
      idempotent: true,
    });
  });

  it('skips deletion when the file does not exist', async () => {
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({ exists: false });
    await deleteMediaFile('/gone.jpg');
    expect(FileSystem.deleteAsync).not.toHaveBeenCalled();
  });

  it('never throws when the underlying delete rejects', async () => {
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({ exists: true });
    (FileSystem.deleteAsync as jest.Mock).mockRejectedValue(new Error('io error'));
    await expect(deleteMediaFile('/bad.jpg')).resolves.toBeUndefined();
  });
});
