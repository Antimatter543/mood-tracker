// plugins/withHealthConnect.js
//
// Local Expo config plugin for Android Health Connect (react-native-health-connect).
//
// The library's bundled `app.plugin.js` (listed BEFORE this plugin in app.json)
// only adds the Android-13 rationale intent-filter to MainActivity. Everything
// else Health Connect needs is hand-written here, applied on every CNG prebuild
// (local + CI) so the gitignored, regenerated `android/` always ends up correct:
//
//   1. withAndroidManifest — declare the health read permissions we use and the
//      Android-14+ <activity-alias> that routes the system "permission usage"
//      screen back into MainActivity.
//   2. withMainActivity — register the Health Connect permission delegate in
//      MainActivity.onCreate (Kotlin), so requestPermission() has an
//      ActivityResultLauncher to drive the system permission dialog.
//
// Every mutation THIS plugin makes is idempotent (guarded), so re-running
// prebuild never duplicates one of our entries. Modeled on ./withReleaseAbis.js.
//
// BUILD KNOB — EXPO_PUBLIC_HEALTH_CONNECT (TEMPORARY, 2026-07-17): when this env
// var is '0' at prebuild time, this plugin applies NOTHING — no health
// <uses-permission>, no ViewPermissionUsageActivity <activity-alias>, no
// MainActivity delegate edit — so the generated manifest carries ZERO
// `android.permission.health.*`. That is the Play "no-HC" AAB variant, needed
// only until Google's "Health Apps" declaration is approved (undeclared health
// permissions risk Play removal). See lib/healthConnectConfig.ts for the WHY and
// the matching runtime flag (the SAME env var drives both, so manifest ⇆ JS
// agree). REVERT once approved: build the AAB with EXPO_PUBLIC_HEALTH_CONNECT=1
// (or drop the env) and this plugin declares HC exactly as the APK does.
//   NOTE — harmless residue when disabled: the library's own bundled
//   app.plugin.js (listed BEFORE us in app.json) still adds a rationale
//   intent-filter to MainActivity. That is an <intent-filter> (action
//   `androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE`), NOT a permission — it
//   contains no `android.permission.health.*`, so it does not trip Play's
//   health-permission detection. Verified against the generated manifest (the CI
//   Play-variant build asserts `grep -c android.permission.health == 0`).
//
// KNOWN upstream quirk (not ours): the library's bundled app.plugin.js pushes
// the rationale intent-filter with NO guard, so re-running `expo prebuild` over
// an existing android/ (without --clean) accumulates duplicate rationale
// filters. Harmless (Android ignores the redundant declaration) and never on the
// ship path — CI/EAS prebuild once on a fresh tree, yielding exactly one. We do
// NOT try to dedupe it here: the fixed plugin order (library BEFORE us, required
// so its manifest mod is present) means the library's push effectively runs
// after ours, so a post-clean can't reach it. Fix belongs upstream.

const {
  withAndroidManifest,
  withMainActivity,
  AndroidConfig,
  WarningAggregator,
} = require('@expo/config-plugins');

// Health Connect read permissions this app declares in the Android manifest.
// This MUST stay in sync with the permissions requested at runtime in
// lib/healthConnect.ts (REQUIRED + OPTIONAL record types): a permission absent
// here is never offered/granted, so Health Connect returns NOTHING for it —
// which is exactly how HRV silently never populated after 2.4.0 (it was in the
// runtime request but never declared here). The invariant is locked by
// __tests__/healthPermissionInvariant.test.ts, which asserts this array exactly
// equals the runtime record-type set mapped to READ_* permission names.
//   SleepSession                → READ_SLEEP
//   HeartRate                   → READ_HEART_RATE
//   HeartRateVariabilityRmssd   → READ_HEART_RATE_VARIABILITY
//   RestingHeartRate            → READ_RESTING_HEART_RATE
const HEALTH_PERMISSIONS = [
  'android.permission.health.READ_SLEEP',
  'android.permission.health.READ_HEART_RATE',
  'android.permission.health.READ_HEART_RATE_VARIABILITY',
  'android.permission.health.READ_RESTING_HEART_RATE',
];

const ACTIVITY_ALIAS_NAME = 'ViewPermissionUsageActivity';

const DELEGATE_IMPORT =
  'import dev.matinzd.healthconnect.permissions.HealthConnectPermissionDelegate';
const DELEGATE_CALL =
  'HealthConnectPermissionDelegate.setPermissionDelegate(this)';

/**
 * Ensure a <uses-permission android:name="..."> exists exactly once.
 * @param {object} manifest parsed AndroidManifest (config.modResults.manifest)
 * @param {string} name permission name
 */
function ensureUsesPermission(manifest, name) {
  if (!Array.isArray(manifest['uses-permission'])) {
    manifest['uses-permission'] = [];
  }
  const exists = manifest['uses-permission'].some(
    (perm) => perm?.$?.['android:name'] === name
  );
  if (!exists) {
    manifest['uses-permission'].push({ $: { 'android:name': name } });
  }
}

/**
 * Ensure the ViewPermissionUsageActivity <activity-alias> exists exactly once
 * inside the main <application>.
 * @param {object} application the main application node
 */
function ensureActivityAlias(application) {
  if (!Array.isArray(application['activity-alias'])) {
    application['activity-alias'] = [];
  }
  const exists = application['activity-alias'].some(
    (alias) => alias?.$?.['android:name'] === ACTIVITY_ALIAS_NAME
  );
  if (exists) return;

  application['activity-alias'].push({
    $: {
      'android:name': ACTIVITY_ALIAS_NAME,
      'android:exported': 'true',
      'android:targetActivity': '.MainActivity',
      'android:permission': 'android.permission.START_VIEW_PERMISSION_USAGE',
    },
    'intent-filter': [
      {
        action: [
          { $: { 'android:name': 'android.intent.action.VIEW_PERMISSION_USAGE' } },
        ],
        category: [
          { $: { 'android:name': 'android.intent.category.HEALTH_PERMISSIONS' } },
        ],
      },
    ],
  });
}

/**
 * Inject the Health Connect permission delegate into a Kotlin MainActivity.
 * Idempotent: does nothing if the delegate call is already present.
 * @param {string} contents MainActivity.kt source
 * @returns {string} modified source
 */
function addDelegateToKotlin(contents) {
  let next = contents;

  // 1. Import (after the package declaration) — skip if already imported.
  if (!next.includes(DELEGATE_IMPORT)) {
    next = next.replace(
      /^(package .*\n)/m,
      (match) => `${match}\n${DELEGATE_IMPORT}`
    );
  }

  // 2. Delegate registration, immediately after super.onCreate(...) — skip if
  //    already present. Preserve the indentation of the super.onCreate line.
  if (!next.includes(DELEGATE_CALL)) {
    next = next.replace(
      /^([ \t]*)super\.onCreate\([^)]*\)\s*\n/m,
      (match, indent) => `${match}${indent}${DELEGATE_CALL}\n`
    );
  }

  return next;
}

/** Adds the health permissions + activity-alias to AndroidManifest.xml. */
const withHealthConnectManifest = (config) =>
  withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    HEALTH_PERMISSIONS.forEach((name) => ensureUsesPermission(manifest, name));

    const application =
      AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    ensureActivityAlias(application);

    return cfg;
  });

/** Registers the Health Connect permission delegate in MainActivity.onCreate. */
const withHealthConnectMainActivity = (config) =>
  withMainActivity(config, (cfg) => {
    const { language } = cfg.modResults;
    if (language !== 'kt') {
      // SoulSync's MainActivity is Kotlin. Bail loudly rather than silently
      // producing an activity that never registers the delegate.
      WarningAggregator.addWarningAndroid(
        'withHealthConnect',
        `Expected a Kotlin (.kt) MainActivity but found "${language}". ` +
          'The Health Connect permission delegate was NOT injected; ' +
          'requestPermission() will fail until this is handled.'
      );
      return cfg;
    }
    cfg.modResults.contents = addDelegateToKotlin(cfg.modResults.contents);
    return cfg;
  });

/**
 * Root plugin: applies the manifest + MainActivity mods. Order within is
 * irrelevant (independent mods); both are idempotent.
 *
 * BUILD KNOB: `EXPO_PUBLIC_HEALTH_CONNECT === '0'` → apply NOTHING (the Play
 * no-HC variant). Read at CALL time (prebuild invocation), not module-load, so a
 * single required copy of this plugin honours the env of the prebuild that runs
 * it. Falls SAFE toward "declare HC" — only the exact string '0' disables it, so
 * a missing/typo'd env can never silently strip HC from the normal GitHub build.
 */
const withHealthConnect = (config) => {
  if (process.env.EXPO_PUBLIC_HEALTH_CONNECT === '0') {
    WarningAggregator.addWarningAndroid(
      'withHealthConnect',
      'Health Connect EXCLUDED from this build (EXPO_PUBLIC_HEALTH_CONNECT=0): ' +
        'no health uses-permissions, no ViewPermissionUsageActivity activity-alias, ' +
        'no MainActivity permission delegate. This is the Google Play no-HC variant, ' +
        'temporary until the "Health Apps" declaration is approved.'
    );
    return config;
  }
  return withHealthConnectMainActivity(withHealthConnectManifest(config));
};

module.exports = withHealthConnect;
// Exported for the manifest-vs-runtime permission-drift invariant test
// (__tests__/healthPermissionInvariant.test.ts). Not used by the prebuild path.
module.exports.HEALTH_PERMISSIONS = HEALTH_PERMISSIONS;
