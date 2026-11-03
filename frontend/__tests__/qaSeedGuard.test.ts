/**
 * @jest-environment node
 *
 * RELEASE-ABSENCE PROOF for the QA seed channel (lib/qa), the PR-gate half.
 *
 * lib/qa is a test-only backdoor: a deep link that wipes and reseeds the
 * on-device database. It may exist ONLY in builds made with EXPO_PUBLIC_QA=1.
 * The mechanism (see app/_layout.tsx + lib/qa/index.ts): babel-preset-expo
 * inlines `process.env.EXPO_PUBLIC_QA` to a literal at transform time, and in a
 * production transform Metro's constant-folding pass deletes `if (undefined ===
 * '1') { require(...) }` BEFORE it collects dependencies, so the module never
 * enters the graph. That only holds for the exact guard shape, so this suite
 * pins:
 *   1. shape: one guard, dot access, compared inline, nothing else reaching lib/qa;
 *   2. config: no release configuration can set the flag, and the only
 *      workflows that do are secret-free and never publish;
 *   3. the mechanism itself: the REAL production transform (babel-preset-expo +
 *      Metro's folding + Expo's dependency collector) drops the dependency when
 *      the flag is unset and keeps it at '1', with counterfactual guard shapes
 *      that must NOT fold (proving the test can fail);
 *   4. the CI bundle-grep script, on fixture files (exit codes both ways), and
 *      that its literals match lib/qa.
 * The artifact half is the bundle grep in .github/workflows/qa-seed-guard.yml
 * (release vs QA bundle) and release-apk.yml (the real APK + AAB).
 *
 * Source-scan verdict: KEEP. "This guard folds away in a release build" is a
 * build-pipeline shape no compiler or behaviour test sees.
 */
import { execFileSync, spawnSync } from 'child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { transformFromAstSync, transformSync, type PluginObj } from '@babel/core';
import { APP_ROOT, REPO_ROOT, code, listSourceFiles, readRepoFile, readSource } from '@/testing/sourceScan';
import { QA_LINK_SCHEME, QA_SEED_MARKER, QA_SEED_PATH } from '@/lib/qa';

const LAYOUT = 'app/_layout.tsx';
const GUARD = "process.env.EXPO_PUBLIC_QA === '1'";
const QA_MODULE = '@/lib/qa/QaSeedHost';

// ---------------------------------------------------------------------------
// 1. Shape
// ---------------------------------------------------------------------------
describe('guard shape', () => {
  const SOURCE_DIRS = ['app', 'components', 'context', 'databases', 'hooks', 'lib', 'styles', 'plugins'];
  const appSource = () =>
    listSourceFiles(SOURCE_DIRS.filter((d) => readdirSync(APP_ROOT).includes(d)));

  it('app/_layout.tsx requires lib/qa only inside the exact inline guard', () => {
    const src = code(LAYOUT);
    expect(src.split(GUARD)).toHaveLength(2); // exactly one guard
    expect(src).toMatch(
      /if \(process\.env\.EXPO_PUBLIC_QA === '1'\) \{\s*QaSeedHost = require\('@\/lib\/qa\/QaSeedHost'\)\.QaSeedHost;\s*\}/
    );
    // ...and that guarded require is the ONLY mention of lib/qa in the file.
    expect(src.match(/lib\/qa/g)).toHaveLength(1);
  });

  it('nothing outside lib/qa and app/_layout.tsx reaches lib/qa', () => {
    const offenders = appSource().filter(
      (rel) => rel !== LAYOUT && !rel.startsWith('lib/qa/') && /lib\/qa|['"]\.{1,2}\/qa['"/]/.test(code(rel))
    );
    expect(offenders).toEqual([]);
  });

  it('app/_layout.tsx is the only app source that reads EXPO_PUBLIC_QA', () => {
    const readers = appSource().filter((rel) => /EXPO_PUBLIC_QA\b/.test(code(rel)));
    expect(readers).toEqual([LAYOUT]);
  });

  it('no route file under app/ is named after the seed path', () => {
    // A route file ships in EVERY build (expo-router's require.context), so the
    // handler must never become one.
    const routes = listSourceFiles(['app']).filter((rel) => /(^|\/)qa(\/|\.|$)|seed/i.test(rel));
    expect(routes).toEqual([]);
  });

  it('the deep-link scheme matches app.json', () => {
    const appJson = JSON.parse(readSource('app.json'));
    expect(appJson.expo.scheme).toBe(QA_LINK_SCHEME);
  });
});

// ---------------------------------------------------------------------------
// 2. Release configuration can't set the flag
// ---------------------------------------------------------------------------
/** A workflow with its YAML comments removed (a comment may NAME the flag). */
const yamlCode = (rel: string): string =>
  readRepoFile(rel)
    .split('\n')
    .map((line) => line.replace(/(^|\s)#.*$/, ''))
    .join('\n');

describe('release configuration never sets EXPO_PUBLIC_QA', () => {
  const SETS_FLAG = /EXPO_PUBLIC_QA\s*[:=]/;

  it.each([
    ['.github/workflows/release-apk.yml', yamlCode],
    ['eas.json', readSource],
    ['app.json', readSource],
  ] as const)('%s', (rel, read) => {
    expect(read(rel)).not.toMatch(/EXPO_PUBLIC_QA/);
  });

  it('no tracked frontend .env file sets it', () => {
    const tracked = execFileSync('git', ['ls-files', '-z', '--', '.env*', '**/.env*'], {
      cwd: APP_ROOT,
      encoding: 'utf8',
    })
      .split('\0')
      .filter(Boolean);
    for (const rel of tracked) expect(readSource(rel)).not.toMatch(SETS_FLAG);
  });

  it('only QA workflows set it, and none of them holds secrets or publishes', () => {
    const dir = join(REPO_ROOT, '.github/workflows');
    const setters = readdirSync(dir).filter((f) => SETS_FLAG.test(yamlCode(`.github/workflows/${f}`)));
    for (const file of setters) {
      expect(file).toMatch(/^(qa-seed-guard|e2e[\w-]*)\.ya?ml$/);
      const wf = yamlCode(`.github/workflows/${file}`);
      expect(wf).not.toMatch(/\$\{\{\s*secrets\./);
      expect(wf).not.toMatch(/gh release|action-gh-release|gplay|pull_request_target/);
    }
    // The PR-gate workflow itself must be among them (positive control).
    expect(setters).toContain('qa-seed-guard.yml');
  });

  it('the release lane greps BOTH shipped bundles for the channel before any upload', () => {
    const wf = readRepoFile('.github/workflows/release-apk.yml');
    const check = wf.indexOf('qa-seed-bundle-check.sh "$RUNNER_TEMP/apk-index.android.bundle" absent');
    expect(check).toBeGreaterThan(-1);
    expect(wf).toContain('qa-seed-bundle-check.sh "$RUNNER_TEMP/aab-index.android.bundle" absent');
    for (const later of ['Upload AAB artifact', 'Publish GitHub Release', 'Publish rolling dev build']) {
      expect(wf.indexOf(later)).toBeGreaterThan(check);
    }
  });

  it('the PR-gate workflow checks a release bundle absent AND a QA bundle present', () => {
    const wf = yamlCode('.github/workflows/qa-seed-guard.yml');
    expect(wf).toMatch(/^on:\n {2}pull_request:/m);
    expect(wf).not.toMatch(/pull_request_target|\$\{\{\s*secrets\./);
    expect(wf).toMatch(/permissions:\n {2}contents: read/);
    expect(wf).toMatch(/env -u EXPO_PUBLIC_QA npx expo export:embed/);
    expect(wf).toMatch(/qa-seed-bundle-check\.sh "\$RUNNER_TEMP\/release\.android\.bundle" absent/);
    expect(wf).toMatch(/EXPO_PUBLIC_QA: '1'/);
    expect(wf).toMatch(/qa-seed-bundle-check\.sh "\$RUNNER_TEMP\/qa\.android\.bundle" present/);
    // The Metro cache trap: a wipe before EACH bundle pass.
    expect(wf.match(/rm -rf "\$\{TMPDIR:-\/tmp\}"\/metro-\* "\$RUNNER_TEMP"\/metro-\* node_modules\/\.cache/g)).toHaveLength(2);
    for (const uses of wf.match(/uses: \S+/g) ?? []) expect(uses).toMatch(/@[0-9a-f]{40}$/);
  });
});

// ---------------------------------------------------------------------------
// 3. The mechanism: the production transform really drops the dependency
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-require-imports */
const { constantFoldingPlugin } = require('metro-transform-plugins');
const collectDependencies = require('@expo/metro-config/build/transform-worker/collect-dependencies').default;
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * The dependencies Metro would record for `source` in a production Android
 * bundle with EXPO_PUBLIC_QA = `flag`. Mirrors @expo/metro-config's
 * transform-worker: babel-preset-expo with Metro's caller (isDev false), then
 * `performConstantFolding` (re-crawl scope + constantFoldingPlugin, which runs
 * when !options.dev), then Expo's collect-dependencies.
 */
function productionDependencies(source: string, flag: string | undefined): string[] {
  const saved = process.env.EXPO_PUBLIC_QA;
  if (flag === undefined) delete process.env.EXPO_PUBLIC_QA;
  else process.env.EXPO_PUBLIC_QA = flag;
  try {
    const filename = join(APP_ROOT, LAYOUT);
    const babel = transformSync(source, {
      filename,
      ast: true,
      code: false,
      babelrc: false,
      configFile: false,
      presets: ['babel-preset-expo'],
      caller: {
        name: 'metro',
        bundler: 'metro',
        platform: 'android',
        isDev: false,
        isServer: false,
        isHMREnabled: false,
        projectRoot: APP_ROOT,
        routerRoot: 'app',
        supportsStaticESM: false,
        isNodeModule: false,
      } as never,
    });
    const clearProgramScope: PluginObj = {
      visitor: { Program: { enter: (path) => path.scope.crawl() } },
    };
    const folded = transformFromAstSync(babel!.ast!, '', {
      ast: true,
      code: false,
      babelrc: false,
      configFile: false,
      filename,
      plugins: [clearProgramScope, constantFoldingPlugin],
      cloneInputAst: false,
    });
    const { dependencies } = collectDependencies(folded!.ast, {
      asyncRequireModulePath: 'expo/internal/async-require-module',
      dynamicRequires: 'reject',
      inlineableCalls: [],
      keepRequireNames: false,
      allowOptionalDependencies: false,
      dependencyMapName: null,
      unstable_allowRequireContext: true,
      unstable_isESMImportAtSource: null,
      collectOnly: false,
    });
    return dependencies.map((d: { name: string }) => d.name);
  } finally {
    if (saved === undefined) delete process.env.EXPO_PUBLIC_QA;
    else process.env.EXPO_PUBLIC_QA = saved;
  }
}

describe('production transform of app/_layout.tsx', () => {
  const real = readSource(LAYOUT);
  // The guard as CODE (the bare GUARD text also appears in the file's comment).
  const IF_GUARD = `if (${GUARD})`;

  it('flag unset (every release build): lib/qa is NOT a dependency', () => {
    const deps = productionDependencies(real, undefined);
    expect(deps).toContain('expo-router'); // the collector really ran
    expect(deps.filter((d) => d.includes('lib/qa'))).toEqual([]);
  });

  it.each(['0', '', 'true', 'yes'])("flag '%s': lib/qa is NOT a dependency", (flag) => {
    expect(productionDependencies(real, flag).filter((d) => d.includes('lib/qa'))).toEqual([]);
  });

  it("flag '1' (QA build): lib/qa IS a dependency (positive control)", () => {
    expect(productionDependencies(real, '1')).toContain(QA_MODULE);
  });

  // Counterfactuals: guard shapes that LOOK equivalent but do not fold. Each one
  // keeps the dependency with the flag unset, so the shape test above is what
  // stands between a refactor and shipping the backdoor.
  const counterfactuals: [string, string][] = [
    // (Destructuring `const { EXPO_PUBLIC_QA } = process.env` is NOT here: babel-preset-expo
    // inlines that form too, so it folds. Aliasing the object or a computed key does not.)
    [
      'aliased env object',
      real.replace(IF_GUARD, "if (env.EXPO_PUBLIC_QA === '1')").replace(
        'let QaSeedHost',
        'const env = process.env;\nlet QaSeedHost'
      ),
    ],
    [
      'computed key',
      real.replace(IF_GUARD, "if (process.env[QA_KEY] === '1')").replace(
        'let QaSeedHost',
        "const QA_KEY = 'EXPO_PUBLIC_QA';\nlet QaSeedHost"
      ),
    ],
    [
      'helper indirection',
      real.replace(IF_GUARD, 'if (isQaBuild())').replace(
        'let QaSeedHost',
        "function isQaBuild() { const e = process.env; return e.EXPO_PUBLIC_QA === '1'; }\nlet QaSeedHost"
      ),
    ],
    ['guard removed', real.replace(IF_GUARD, 'if (true)')],
  ];

  it.each(counterfactuals)('counterfactual (%s): the dependency SURVIVES with the flag unset', (_, src) => {
    expect(src).not.toBe(real); // the mutation applied
    expect(productionDependencies(src, undefined)).toContain(QA_MODULE);
  });
});

// ---------------------------------------------------------------------------
// 4. The CI bundle-grep script
// ---------------------------------------------------------------------------
describe('.github/scripts/qa-seed-bundle-check.sh', () => {
  const script = join(REPO_ROOT, '.github/scripts/qa-seed-bundle-check.sh');
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'qa-seed-check-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const bundle = (name: string, body: string) => {
    const p = join(dir, name);
    writeFileSync(p, body);
    return p;
  };
  const run = (...args: string[]) => spawnSync('bash', [script, ...args], { encoding: 'utf8' }).status;

  const CLEAN = 'var a="soulsync-hc-variant:enabled";function f(){return 1}';
  const BOTH = `${CLEAN};console.log("[${QA_SEED_MARKER}] ok");var p="${QA_SEED_PATH}";`;

  it('keeps its literals in sync with lib/qa', () => {
    const src = readRepoFile('.github/scripts/qa-seed-bundle-check.sh');
    expect(src).toContain(`MARKER='${QA_SEED_MARKER}'`);
    expect(src).toContain(`SEED_PATH='${QA_SEED_PATH}'`);
  });

  it('absent: passes on a clean bundle, fails on the marker OR the path alone', () => {
    expect(run(bundle('clean', CLEAN), 'absent')).toBe(0);
    expect(run(bundle('marker', `${CLEAN}"${QA_SEED_MARKER}"`), 'absent')).toBe(1);
    expect(run(bundle('path', `${CLEAN}"${QA_SEED_PATH}"`), 'absent')).toBe(1);
    expect(run(bundle('both', BOTH), 'absent')).toBe(1);
  });

  it('present: passes only when BOTH strings are there', () => {
    expect(run(bundle('both', BOTH), 'present')).toBe(0);
    expect(run(bundle('clean', CLEAN), 'present')).toBe(1);
    expect(run(bundle('marker', `${CLEAN}"${QA_SEED_MARKER}"`), 'present')).toBe(1);
  });

  it('finds the strings inside binary (Hermes-like) content', () => {
    const p = join(dir, 'hbc');
    writeFileSync(
      p,
      Buffer.concat([Buffer.from([0xc6, 0x1f, 0xbc, 0x03, 0, 0, 0]), Buffer.from(`\0${QA_SEED_MARKER}\0${QA_SEED_PATH}\0`), Buffer.alloc(16)])
    );
    expect(run(p, 'absent')).toBe(1);
    expect(run(p, 'present')).toBe(0);
  });

  it('a missing or empty bundle is a usage error (2), never a pass', () => {
    expect(run(join(dir, 'nope'), 'absent')).toBe(2);
    expect(run(bundle('empty', ''), 'absent')).toBe(2);
    expect(run(bundle('clean', CLEAN), 'maybe')).toBe(2);
    expect(run()).toBe(2);
  });
});
