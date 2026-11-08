/**
 * Keeps the bench Pixel's unlock PIN and LAN address out of the public repo.
 *
 * Shape bug: both leaked into CLAUDE.md, docs and lessons (a public repo). The
 * PIN lives only in ~/bin/astra-pixel-unlock.sh; the address comes from
 * `adb devices`. Delete once a secret scanner in CI covers this.
 *
 * The literals are assembled at runtime so this file does not contain them.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { REPO_ROOT, resolveInside } from '@/testing/sourceScan';

const PIN = ['13', '37'].join('');
const ADDRESS = ['192', '168', '1', '68'].join('.');
const BANNED = new RegExp(`\\b${PIN}\\b|${ADDRESS.replace(/\./g, '\\.')}`);

const ROOTS = ['CLAUDE.md', 'frontend/docs', 'frontend/tasks', 'frontend/.maestro', 'frontend/scripts', '.github'];
const SKIP_DIRS = new Set(['node_modules', '.git']);

/** Text files under `rel` (a file or folder), as repo-relative posix paths. */
function textFiles(rel: string): string[] {
  const abs = resolveInside(REPO_ROOT, rel);
  if (!statSync(abs).isDirectory()) return [rel];
  return readdirSync(abs, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? (SKIP_DIRS.has(e.name) ? [] : textFiles(`${rel}/${e.name}`)) : [`${rel}/${e.name}`],
  );
}

/** `path:line` of every banned literal in the scanned roots. */
function hits(): string[] {
  return ROOTS.flatMap(textFiles).flatMap(file => {
    const text = readFileSync(resolveInside(REPO_ROOT, file));
    if (text.includes(0)) return []; // binary
    return text
      .toString('utf8')
      .split('\n')
      .flatMap((line, i) => (BANNED.test(line) ? [`${file}:${i + 1}`] : []));
  });
}

describe('device PIN and LAN address stay out of the repo', () => {
  it('appear in no tracked doc, task, script, flow or workflow', () => {
    expect({
      message:
        'The bench Pixel PIN or LAN address is committed (public repo). Say "unlock with ~/bin/astra-pixel-unlock.sh" or "the adb-tls address (`adb devices`)" instead.',
      hits: hits(),
    }).toEqual(expect.objectContaining({ hits: [] }));
  });
});
