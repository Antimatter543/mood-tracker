/**
 * __tests__/playVariantBundleGuard.test.ts
 *
 * Guards the CI shape that keeps the Google Play AAB honest about Health Connect.
 *
 * The knob is '1' today (the Health Apps declaration was actioned, so Play ships HC
 * like the GitHub APK), and '0' is the documented rollback. So nothing here asserts a
 * VALUE: the properties are that every Play-lane gate DERIVES from one knob, that all
 * four Play steps read the same one, and that the cache wipe still stands between the
 * two bundle passes for the day someone takes the rollback.
 *
 * WHY THIS EXISTS (2026-09-11): v2.11.2 shipped to Play with an HC-free MANIFEST and
 * an HC-ENABLED JS BUNDLE. `EXPO_PUBLIC_*` values are inlined by babel at transform
 * time, but they are NOT part of Metro's transform cache key, and the cache root
 * (`os.tmpdir()/metro-cache`) survives `expo prebuild --clean`. One CI job bundles the
 * GitHub APK (knob unset) and then the Play AAB (knob '0'), so the second pass got
 * cache HITS and reused the first pass's inlined `HEALTH_CONNECT_ENABLED === true`.
 * The two bundles came out byte-identical, the Settings card rendered on Play, and
 * `requestPermission()` crashed in a MainActivity with no permission delegate.
 *
 * Two properties must hold forever, and neither is visible in application code:
 *   1. the Metro transform cache is WIPED between the two bundle steps, and
 *   2. the shipped ARTIFACT is asserted (marker greps + md5 inequality), because the
 *      env was correct the entire time the bug was live. Asserting the env, or a log
 *      line echoing the env, would have passed throughout.
 *
 * Pure fs/string assertions on the workflow: no device, no network, no YAML dependency
 * (the parse below is deliberately dependency-free so a transitive js-yaml bump can
 * never silently disable this guard).
 */
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../..');
const WORKFLOW = path.join(REPO_ROOT, '.github/workflows/release-apk.yml');
const workflow = fs.readFileSync(WORKFLOW, 'utf8');

/** One `- name:` step of the single job, with its whole body and its line number. */
type Step = { name: string; body: string; line: number };

function parseSteps(src: string): Step[] {
  const lines = src.split('\n');
  const heads: { name: string; line: number }[] = [];
  lines.forEach((line, i) => {
    const m = /^ {6}- name: (.+)$/.exec(line);
    if (m) heads.push({ name: m[1].trim(), line: i });
  });
  return heads.map((h, k) => ({
    name: h.name,
    line: h.line,
    body: lines.slice(h.line, k + 1 < heads.length ? heads[k + 1].line : lines.length).join('\n'),
  }));
}

const steps = parseSteps(workflow);

/**
 * Exactly one step must match each predicate. Ambiguity is as bad as absence: two
 * matching steps would pin the ordering assertions to whichever came first.
 *
 * No `expect()` here — this runs at module scope, where a thrown assertion kills the
 * whole file and reports as "0 tests ran" instead of naming the missing step. A
 * sentinel with `line: -1` and an empty body fails the locator test below by name,
 * and every content assertion after it, loudly.
 */
const MISSING = -1;
const find = (predicate: (s: Step) => boolean, what: string): Step => {
  const hit = steps.filter(predicate);
  return hit.length === 1
    ? hit[0]
    : { name: `<${hit.length} steps matched: ${what}>`, body: '', line: MISSING };
};

/** The two marker literals the APP actually emits, derived from the module itself. */
const markerFor = (knob: string | undefined): string => {
  const ORIG = process.env.EXPO_PUBLIC_HEALTH_CONNECT;
  if (knob === undefined) delete process.env.EXPO_PUBLIC_HEALTH_CONNECT;
  else process.env.EXPO_PUBLIC_HEALTH_CONNECT = knob;
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- fresh module load per env value
  const marker: string = require('../lib/healthConnectConfig').HEALTH_CONNECT_BUILD_VARIANT;
  if (ORIG === undefined) delete process.env.EXPO_PUBLIC_HEALTH_CONNECT;
  else process.env.EXPO_PUBLIC_HEALTH_CONNECT = ORIG;
  jest.resetModules();
  return marker;
};

const ENABLED_MARKER = markerFor(undefined);
const EXCLUDED_MARKER = markerFor('0');

const apkBuild = find((s) => s.body.includes('./gradlew assembleRelease'), 'APK build');
const aabBuild = find((s) => s.body.includes('./gradlew bundleRelease'), 'AAB build');
const wipe = find(
  (s) => s.body.includes('rm -rf') && s.body.includes('metro-cache'),
  'Metro cache wipe'
);
const apkAssert = find(
  (s) => s.body.includes('unzip -p') && s.body.includes('assets/index.android.bundle')
    && !s.body.includes('base/assets/index.android.bundle'),
  'APK bundle assertion'
);
const aabAssert = find(
  (s) => s.body.includes('base/assets/index.android.bundle'),
  'AAB bundle assertion'
);
const playPrebuild = find(
  // Match the RUN line, not a comment that merely mentions the command (the cache
  // wipe step explains itself by naming `expo prebuild --clean`).
  (s) => s.body.includes('run: npx expo prebuild') && s.body.includes('--clean'),
  'Play variant prebuild'
);
const manifestAssert = find(
  (s) =>
    s.body.includes('AndroidManifest.xml') &&
    s.body.includes('ViewPermissionUsageActivity'),
  'Play manifest assertion'
);

/** The knob a step declares in its own `env:` block, or undefined. */
const knobOf = (s: Step): string | undefined =>
  /EXPO_PUBLIC_HEALTH_CONNECT: '([^']*)'/.exec(s.body)?.[1];

describe('release-apk.yml still has every step this guard reasons about', () => {
  it.each([
    ['APK gradle build', apkBuild],
    ['Play AAB gradle build', aabBuild],
    ['Metro transform cache wipe', wipe],
    ['APK JS bundle assertion', apkAssert],
    ['Play AAB JS bundle assertion', aabAssert],
  ])('%s exists exactly once', (_label: string, step: Step) => {
    // A deleted or duplicated step is the failure mode that would silently disarm
    // everything below, so it is named here first rather than discovered as a
    // confusing content mismatch.
    expect(step.line).not.toBe(MISSING);
  });
});

describe('release-apk.yml wipes the Metro transform cache between the two bundle passes', () => {
  it('wipes the real cache root, os.tmpdir()/metro-cache', () => {
    // The path matters: @expo/metro-config puts the FileStore at
    // path.join(os.tmpdir(), 'metro-cache'), which honours TMPDIR. Wiping only
    // node_modules/.cache (the intuitive guess) would not have fixed the leak.
    expect(wipe.body).toContain('"${TMPDIR:-/tmp}/metro-cache"');
  });

  it('runs AFTER the APK bundle pass and BEFORE the Play AAB bundle pass', () => {
    // This ordering IS the fix. A wipe before the APK build, or after the AAB
    // build, restores the bug while still looking like a cache wipe in the diff.
    expect(apkBuild.line).toBeLessThan(wipe.line);
    expect(wipe.line).toBeLessThan(aabBuild.line);
  });

  it('explains WHY in the step, so nobody deletes it as dead weight', () => {
    expect(wipe.body).toMatch(/cache key/i);
    expect(wipe.body).toMatch(/EXPO_PUBLIC/);
  });
});

describe('release-apk.yml asserts the ARTIFACT, in both directions', () => {
  it('extracts the JS bundle from each artifact at the right zip path', () => {
    expect(apkAssert.body).toContain('unzip -p');
    expect(apkAssert.body).toContain('assets/index.android.bundle');
    expect(aabAssert.body).toContain('unzip -p');
    // AABs nest the base split's assets one level down.
    expect(aabAssert.body).toContain('base/assets/index.android.bundle');
  });

  it('greps for the exact marker literals the app emits (not a remembered string)', () => {
    // Ties the CI grep to lib/healthConnectConfig.ts: rename the marker and this
    // fails here, instead of leaving a grep that can never match anything again.
    for (const step of [apkAssert, aabAssert]) {
      expect(step.body).toContain(ENABLED_MARKER);
      expect(step.body).toContain(EXCLUDED_MARKER);
    }
  });

  it('checks the presence of the expected marker AND the absence of the other', () => {
    // A one-directional check passes on a bundle containing both markers, which is
    // exactly what an unfolded ternary would produce.
    for (const step of [apkAssert, aabAssert]) {
      expect(step.body).toMatch(/-lt 1/);
      expect(step.body).toMatch(/-ne 0/);
    }
  });

  it('compares the two bundles by md5, but ONLY when the lanes were built differently', () => {
    // With both lanes on the same knob the bundles are supposed to agree, so an
    // unconditional "they must differ" would fail on the normal build. The converse
    // ("they must be identical") is not asserted either: two same-env passes still
    // differ in md5, so it would be a flaky gate. The marker greps are the real gate.
    expect(apkAssert.body).toMatch(/id: apkbundle/);
    expect(apkAssert.body).toContain('md5=$MD5" >> "$GITHUB_OUTPUT"');
    expect(aabAssert.body).toContain('steps.apkbundle.outputs.md5');
    expect(aabAssert.body).toMatch(
      /if \[ "\$EXPECT_NAME" = "excluded" \] && \[ "\$MD5" = "\$APK_BUNDLE_MD5" \]/
    );
  });

  it('derives the AAB expectation from the SAME knob value the bundle step used', () => {
    // So that taking the '0' rollback flips the assertion with it, instead of
    // turning the release lane red.
    expect(knobOf(aabBuild)).toBeDefined();
    expect(knobOf(aabAssert)).toBe(knobOf(aabBuild));
    expect(aabAssert.body).toMatch(/EXPO_PUBLIC_HEALTH_CONNECT:-/);
  });

  it('fails LOUDLY: every bundle guard emits ::error:: and exits non-zero', () => {
    for (const step of [apkAssert, aabAssert]) {
      expect(step.body).toContain('::error::');
      expect(step.body).toContain('exit 1');
      // Without pipefail a broken `unzip | strings` pipeline reads as zero matches.
      expect(step.body).toContain('set -euo pipefail');
    }
  });

  it('runs on workflow_dispatch too, so branch QA builds are gated as well', () => {
    // The assertions are worthless if they only run on a tag. None of the Play-variant
    // steps may carry an `if:` that narrows them to a subset of triggers.
    for (const step of [wipe, apkAssert, aabAssert, aabBuild]) {
      expect(step.body).not.toMatch(/^ {8}if:/m);
    }
    expect(workflow).toContain('workflow_dispatch');
  });
});

describe('the Play variant gates all DERIVE from one knob', () => {
  it('the manifest assertion exists and branches on the knob, not on a hardcoded expectation', () => {
    // Before 2026-09-11 this step asserted ZERO health permissions unconditionally.
    // With the Health Apps declaration actioned the Play build SHIPS Health Connect,
    // so a hardcoded expectation would now have to be rewritten (and re-reviewed)
    // every time the knob moves. It branches instead.
    expect(manifestAssert.line).not.toBe(MISSING);
    expect(manifestAssert.body).toMatch(/EXPO_PUBLIC_HEALTH_CONNECT:-.*\}" \] ?= "0"|= "0" \]/);
    expect(manifestAssert.body).toContain('::error::Play AAB manifest STILL declares');
    expect(manifestAssert.body).toContain('::error::Play AAB manifest is MISSING');
  });

  it('the enabled branch requires all 4 health permissions AND the usage alias', () => {
    // The alias is the Android 14+ route from the system "permission usage" screen
    // back into MainActivity. The plugin adds it together with the permissions, so
    // its absence means the plugin did not run, even if a permission grep passed.
    for (const perm of [
      'READ_SLEEP',
      'READ_HEART_RATE',
      'READ_HEART_RATE_VARIABILITY',
      'READ_RESTING_HEART_RATE',
    ]) {
      expect(manifestAssert.body).toContain(perm);
    }
    // Assert the alias is GATED, not merely mentioned: counting it into $ALIAS and
    // then never testing $ALIAS is exactly the shape that passes a naive grep test
    // while letting a delegate-less manifest ship.
    expect(manifestAssert.body).toContain('ViewPermissionUsageActivity');
    expect(manifestAssert.body).toContain('"$ALIAS" -lt 1'); // enabled: must exist
    expect(manifestAssert.body).toContain('"$ALIAS" -ne 0'); // rollback: must not
    expect(manifestAssert.body).toContain('"$COUNT" -ne 4'); // enabled: exactly 4
    expect(manifestAssert.body).toContain('"$COUNT" -ne 0'); // rollback: none
  });

  it('every Play-variant step reads the SAME knob value', () => {
    // The manifest comes from the prebuild and the JS from gradle's metro run. Those
    // two disagreeing IS the v2.11.2 crash, so lockstep is the property, not the
    // particular value: this passes at '1' today and at '0' after a rollback.
    const knobs = [playPrebuild, manifestAssert, aabBuild, aabAssert].map(knobOf);
    expect(knobs[0]).toBeDefined();
    expect(new Set(knobs).size).toBe(1);
  });

  it('the GitHub APK lane never sets the knob (it is the always-enabled reference)', () => {
    // The APK assertion hardcodes "enabled"; that is only sound while the APK lane
    // inherits the default. A stray knob here would make that assertion a lie.
    expect(knobOf(apkBuild)).toBeUndefined();
    expect(knobOf(apkAssert)).toBeUndefined();
  });
});

describe('the build-variant markers are usable as grep needles', () => {
  it('are distinct, and neither aliases the other', () => {
    expect(ENABLED_MARKER).not.toBe(EXCLUDED_MARKER);
    expect(ENABLED_MARKER.includes(EXCLUDED_MARKER)).toBe(false);
    expect(EXCLUDED_MARKER.includes(ENABLED_MARKER)).toBe(false);
  });

  it('are plain ASCII, so `strings` on Hermes bytecode can find them', () => {
    for (const marker of [ENABLED_MARKER, EXCLUDED_MARKER]) {
      expect(marker).toMatch(/^[\x21-\x7e]+$/);
      // `strings` skips runs shorter than 4 characters.
      expect(marker.length).toBeGreaterThanOrEqual(8);
    }
  });

  it('is referenced from live, always-rendered code (not dead-code-eliminable)', () => {
    // The marker only reaches the Hermes string table if something renders it. The
    // Health Connect card itself is the wrong host: it returns null in exactly the
    // build we need to inspect. The Settings About block always renders.
    const settings = fs.readFileSync(
      path.join(__dirname, '../app/(tabs)/settings.tsx'),
      'utf8'
    );
    expect(settings).toContain('HEALTH_CONNECT_BUILD_VARIANT');
    expect(settings).toMatch(/testID=\{HEALTH_CONNECT_BUILD_VARIANT\}/);
  });
});
