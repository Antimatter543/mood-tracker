/**
 * The ONE place that knows where production source lives, for source-scan tests.
 *
 * A scan test is allowed only for a SHAPE bug that neither the compiler nor a
 * behavioural test can see (a banned import, call order, "every X also does Y").
 * It reads through this helper, cites the bug commit in its header, and is
 * deleted once tsc/lint enforces the shape. Nothing outside this file builds a
 * path from `__dirname`.
 *
 * Every read is confined: an absolute path, a `..` escape, or a symlink that
 * resolves outside the root throws. A scan test reads repo files and nothing
 * else. Mirrors the Nudge repo's `testing/SourceScan.kt` (`resolveInside`).
 *
 * Lives in `testing/`, not `__tests__/`: jest treats every file under
 * `__tests__/` as a suite. App code must never import from `@/testing`.
 */
import { existsSync, readdirSync, readFileSync, realpathSync } from 'fs';
import { dirname, isAbsolute, join, resolve, sep } from 'path';

/** Nearest ancestor of `from` that contains `marker`. Throws if none does. */
function findUp(from: string, marker: string): string {
  for (let dir = from; ; dir = dirname(dir)) {
    if (existsSync(join(dir, marker))) return dir;
    if (dirname(dir) === dir) {
      throw new Error(`sourceScan: no ancestor of ${from} contains ${marker}`);
    }
  }
}

/** The Expo app (`frontend/`): the folder holding `app.json`. Found once. */
export const APP_ROOT: string = realpathSync(findUp(__dirname, 'app.json'));

/** The git repo root (the folder holding `.github/`): workflows, store assets. */
export const REPO_ROOT: string = realpathSync(findUp(APP_ROOT, '.github'));

const isInside = (root: string, path: string): boolean =>
  path === root || path.startsWith(root + sep);

/**
 * `rel` resolved under `root`, or a throw. Rejects absolute paths, and any path
 * that climbs out of `root` via `..` or a symlink (checked on real paths).
 */
export function resolveInside(root: string, rel: string): string {
  if (isAbsolute(rel) || rel.startsWith('/') || rel.startsWith('\\')) {
    throw new Error(`sourceScan: absolute path rejected: ${rel}`);
  }
  const realRoot = realpathSync(root);
  const lexical = resolve(realRoot, rel);
  // A missing file has no symlink to follow; the caller gets ENOENT from the read.
  const real = existsSync(lexical) ? realpathSync(lexical) : lexical;
  if (!isInside(realRoot, lexical) || !isInside(realRoot, real)) {
    throw new Error(`sourceScan: path escapes ${realRoot}: ${rel}`);
  }
  return real;
}

/**
 * `src` with comments blanked and newlines kept (line numbers stay valid).
 * String and template literals are respected, so `'http://x'` survives and a
 * doc-comment that merely NAMES a banned call is not code. A regex literal
 * holding a quote or `//` can confuse it; none of our scan targets do.
 */
export function stripComments(src: string): string {
  let out = '';
  let i = 0;
  let depth = 0; // `{` nesting in code
  const holes: number[] = []; // depth each open template `${` hole returns to
  const blank = (s: string) => s.replace(/[^\n]/g, ' ');

  // Copy template text up to the closing backtick, or into a `${` hole.
  const template = () => {
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') {
        out += src.slice(i, i + 2);
        i += 2;
      } else if (c === '`') {
        out += c;
        i += 1;
        return;
      } else if (c === '$' && src[i + 1] === '{') {
        out += '${';
        i += 2;
        holes.push(depth);
        depth += 1;
        return;
      } else {
        out += c;
        i += 1;
      }
    }
  };

  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      const end = src.indexOf('\n', i);
      const stop = end === -1 ? src.length : end;
      out += blank(src.slice(i, stop));
      i = stop;
    } else if (c === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      out += blank(src.slice(i, stop));
      i = stop;
    } else if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
    } else if (c === '`') {
      out += c;
      i += 1;
      template();
    } else {
      if (c === '{') depth += 1;
      out += c;
      i += 1;
      if (c === '}') {
        depth -= 1;
        if (holes.length && holes[holes.length - 1] === depth) {
          holes.pop();
          template();
        }
      }
    }
  }
  return out;
}

/** A file under `frontend/`, e.g. `readSource('databases/entries.ts')`. */
export function readSource(rel: string): string {
  return readFileSync(resolveInside(APP_ROOT, rel), 'utf8');
}

/** A file under the repo root, e.g. `readRepoFile('.github/workflows/release-apk.yml')`. */
export function readRepoFile(rel: string): string {
  return readFileSync(resolveInside(REPO_ROOT, rel), 'utf8');
}

/** `readSource(rel)` with comments stripped: what a scan should match against. */
export function code(rel: string): string {
  return stripComments(readSource(rel));
}

/**
 * Every `.ts`/`.tsx` file (no `.d.ts`) under the given `frontend/` subfolders,
 * as sorted posix paths relative to `frontend/`. Skips `node_modules` and
 * `__tests__`: a test's own SQL/imports are what does the asserting.
 */
export function listSourceFiles(dirs: readonly string[]): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const entry of readdirSync(resolveInside(APP_ROOT, rel), { withFileTypes: true })) {
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== '__tests__') walk(child);
      } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
        out.push(child);
      }
    }
  };
  dirs.forEach(walk);
  return out.sort();
}
