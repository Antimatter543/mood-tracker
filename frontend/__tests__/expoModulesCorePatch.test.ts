import { readdirSync } from 'fs';

import { APP_ROOT, readRepoFile, readSource, REPO_ROOT, resolveInside } from '@/testing/sourceScan';

/**
 * WHY THIS EXISTS: expo-modules-core reads its SharedObjectRegistry map without
 * the lock on a background thread while the JS thread inserts into it. During a
 * resize a LIVE statement looks released, so a cold start can die with "Cannot
 * use shared object that was already released" (expo/expo#50855). No SDK 56
 * release has the fix, so we carry upstream's two-line fix (expo/expo#50939) as a
 * patch-package patch.
 *
 * A patch fails quietly in every way that matters: it stops running if postinstall
 * is dropped, and an SDK bump can make it stale. Green jest would still say nothing
 * about Kotlin. So this pins the file CI actually compiles. CI runs `npm ci` first,
 * which runs postinstall, so a patch that did not apply fails here.
 *
 * Failing after an expo-modules-core bump? Check whether #50939 shipped in the new
 * version. If so, delete the patch and this test. If not, regenerate the patch.
 * Detail: tasks/lessons.md 2026-11-04.
 */
const CORE = 'node_modules/expo-modules-core';
const REGISTRY = `${CORE}/android/src/main/java/expo/modules/kotlin/sharedobjects/SharedObjectRegistry.kt`;

/** Pure: every line touching `pairs` outside a `synchronized(this)` block. */
function unlockedPairsAccesses(kotlin: string): string[] {
  const unlocked: string[] = [];
  let depth = 0;
  let lockedAtDepth: number | null = null;
  for (const raw of kotlin.split('\n')) {
    const line = raw.trim();
    if (lockedAtDepth === null && /synchronized\(this\)\s*\{/.test(line)) lockedAtDepth = depth;
    const isDeclaration = /\bvar pairs\b/.test(line);
    if (/\bpairs\b/.test(line) && !isDeclaration && lockedAtDepth === null) unlocked.push(line);
    depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
    if (lockedAtDepth !== null && depth <= lockedAtDepth) lockedAtDepth = null;
  }
  return unlocked;
}

// ensureWasNotRelease is the one helper that touches `pairs` outside a lexical
// lock. It is safe only because its sole caller holds the lock (asserted below).
const HELPER_LINE = 'if (!pairs.contains(this) && value != 0 && value < currentId.value) {';

describe('unlockedPairsAccesses', () => {
  it('flags the unlocked read and accepts the locked forms', () => {
    const source = `
      internal var pairs = mutableMapOf<Int, Int>()
      fun a(id: Int) = pairs[id]
      fun b(id: Int) = synchronized(this) {
        pairs[id]
      }
      fun c(id: Int) {
        synchronized(this) {
          pairs.remove(id)
        }
        pairs.clear()
      }`;
    expect(unlockedPairsAccesses(source)).toEqual(['fun a(id: Int) = pairs[id]', 'pairs.clear()']);
  });
});

describe('expo-modules-core SharedObjectRegistry patch', () => {
  it('reads the registry map only under the lock', () => {
    expect(unlockedPairsAccesses(readSource(REGISTRY))).toEqual([HELPER_LINE]);
  });

  it('calls ensureWasNotRelease only from inside the locked read', () => {
    const calls = readSource(REGISTRY)
      .split('\n')
      .filter((l) => l.includes('ensureWasNotRelease()'));
    // The one call the patch moved under synchronized, plus the definition.
    expect(calls.map((l) => l.trim())).toEqual([
      'pairs[id.ensureWasNotRelease()]?.first',
      'private fun SharedObjectId.ensureWasNotRelease() = apply {',
    ]);
  });

  it('has a patch for exactly the installed version', () => {
    const { version } = JSON.parse(readSource(`${CORE}/package.json`));
    const patches = readdirSync(resolveInside(APP_ROOT, 'patches')).filter((f) =>
      f.startsWith('expo-modules-core+')
    );
    expect(patches).toEqual([`expo-modules-core+${version}.patch`]);
  });

  it('applies the patch on every install and fails the install if it cannot', () => {
    const pkg = JSON.parse(readSource('package.json'));
    expect(pkg.scripts.postinstall).toBe('patch-package --error-on-fail');
    expect(pkg.devDependencies['patch-package']).toBeDefined();
  });

  it('is not skipped by any CI lane', () => {
    const workflows = readdirSync(resolveInside(REPO_ROOT, '.github/workflows')).filter((f) =>
      /\.ya?ml$/.test(f)
    );
    const installs = workflows.flatMap((f) =>
      readRepoFile(`.github/workflows/${f}`)
        .split('\n')
        .filter((l) => /\bnpm (ci|install|i)\b/.test(l))
        .map((l) => `${f}: ${l.trim()}`)
    );
    expect(installs.length).toBeGreaterThan(0);
    expect(installs.filter((l) => l.includes('--ignore-scripts'))).toEqual([]);
    // A production install would omit patch-package and fail postinstall.
    expect(installs.filter((l) => /--omit[= ]dev|--production/.test(l))).toEqual([]);
  });
});
