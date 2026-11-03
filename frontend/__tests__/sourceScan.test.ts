/**
 * Pins the source-scan helper itself (testing/sourceScan.ts): reads are confined
 * to the repo, and stripComments blanks comments without eating code. If the
 * confinement broke, a scan test could read (and pass on) a file outside the repo.
 */
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  APP_ROOT,
  REPO_ROOT,
  listSourceFiles,
  readRepoFile,
  readSource,
  resolveInside,
  stripComments,
} from '@/testing/sourceScan';

describe('roots', () => {
  it('APP_ROOT is frontend/ and REPO_ROOT is its git root', () => {
    expect(readSource('app.json')).toContain('"expo"');
    expect(readRepoFile('.github/workflows/pr-checks.yml')).toContain('jest');
    expect(REPO_ROOT).not.toBe(APP_ROOT);
    expect(APP_ROOT.startsWith(REPO_ROOT)).toBe(true);
  });
});

describe('resolveInside confines reads to the root', () => {
  it.each(['../../etc/passwd', '../package.json', 'components/../../../etc/passwd', '..'])(
    'rejects the escape %s',
    (rel) => {
      expect(() => resolveInside(APP_ROOT, rel)).toThrow(/escapes/);
    },
  );

  it.each(['/etc/passwd', '\\windows\\system32', join(APP_ROOT, 'app.json')])(
    'rejects the absolute path %s',
    (rel) => {
      expect(() => resolveInside(APP_ROOT, rel)).toThrow(/absolute/);
    },
  );

  it('readSource and readRepoFile refuse an escape', () => {
    expect(() => readSource('../../etc/passwd')).toThrow(/escapes/);
    expect(() => readRepoFile('../etc/passwd')).toThrow(/escapes/);
  });

  it('allows a nested path and a `..` that stays inside', () => {
    expect(resolveInside(APP_ROOT, 'components/../app.json')).toBe(join(APP_ROOT, 'app.json'));
  });

  it('rejects a symlink that points outside the root', () => {
    const root = mkdtempSync(join(tmpdir(), 'scan-root-'));
    const outside = mkdtempSync(join(tmpdir(), 'scan-outside-'));
    writeFileSync(join(outside, 'secret.txt'), 'x');
    mkdirSync(join(root, 'src'));
    symlinkSync(outside, join(root, 'src', 'link'));
    expect(() => resolveInside(root, 'src/link/secret.txt')).toThrow(/escapes/);
  });
});

describe('listSourceFiles', () => {
  it('lists ts/tsx under the dirs, sorted, never tests or d.ts', () => {
    const files = listSourceFiles(['databases', 'components/visualisations']);
    expect(files).toContain('databases/entries.ts');
    expect(files).toEqual([...files].sort());
    expect(files.some((f) => f.includes('__tests__') || f.endsWith('.d.ts'))).toBe(false);
  });

  it('refuses a dir outside the root', () => {
    expect(() => listSourceFiles(['..'])).toThrow(/escapes/);
  });
});

describe('stripComments', () => {
  it('blanks line and block comments, keeping line numbers', () => {
    const src = 'a(); // withTxn()\n/* x\n y() */ b();\n';
    const out = stripComments(src);
    expect(out).not.toContain('withTxn');
    expect(out).not.toContain('y()');
    expect(out.split('\n')).toHaveLength(src.split('\n').length);
    expect(out).toContain('a();');
    expect(out).toContain('b();');
  });

  it('keeps comment markers that sit inside string and template literals', () => {
    const src = [
      "const u = 'http://example.com'; // gone",
      'const g = "/* not a comment */";',
      'const t = `//x ${f("// y")} /* z */`; // gone too',
      'done();',
    ].join('\n');
    const out = stripComments(src);
    expect(out).toContain("'http://example.com'");
    expect(out).toContain('"/* not a comment */"');
    expect(out).toContain('`//x ${f("// y")} /* z */`');
    expect(out).not.toContain('gone');
    expect(out).toContain('done();');
  });

  it('handles escaped quotes and nested template holes', () => {
    const src = "const a = 'it\\'s // fine'; const b = `${`${1}`} // keep`; real(); // drop";
    const out = stripComments(src);
    expect(out).toContain("'it\\'s // fine'");
    expect(out).toContain('// keep`');
    expect(out).toContain('real();');
    expect(out).not.toContain('drop');
  });

  it('does not treat division as a comment', () => {
    expect(stripComments('const x = a / b / c;')).toBe('const x = a / b / c;');
  });

  it('never unbalances a real source file whose braces balance raw', () => {
    // A mis-parsed string/template would swallow code or leave a comment's
    // braces behind. Comments hold unbalanced braces, so compare to the raw file.
    const balanced = (s: string) => s.split('{').length === s.split('}').length;
    const broken = listSourceFiles(['app', 'components', 'databases', 'lib', 'hooks', 'context'])
      .map((f) => [f, readSource(f)] as const)
      .filter(([, raw]) => balanced(raw) && !balanced(stripComments(raw)))
      .map(([f]) => f);
    expect(broken).toEqual([]);
  });
});
