/**
 * __tests__/healthPermissionInvariant.test.ts
 *
 * CLASS-LEVEL INVARIANT (Anti's "validate the whole catalog, not one instance"
 * doctrine): the Health Connect permissions DECLARED in the Android manifest
 * (HEALTH_PERMISSIONS in plugins/withHealthConnect.js) must EXACTLY match the
 * full set of record types the app REQUESTS at runtime (REQUIRED + OPTIONAL in
 * lib/healthConnectPure), each mapped to its `android.permission.health.READ_*`
 * name.
 *
 * WHY THIS EXISTS: a permission absent from the manifest is never offered or
 * granted, so Health Connect returns NOTHING for it — even though the runtime
 * dutifully requests it and getGrantedPermissions never reports it. That silent
 * drift is EXACTLY how HRV never populated after 2.4.0 (added to the runtime
 * OPTIONAL request, never declared in the manifest) and how a naive
 * RestingHeartRate read would have failed too. This test makes the whole CLASS
 * of drift impossible: add a record type to the runtime and this fails until the
 * manifest (and the mapping below) is updated to match.
 *
 * The record-type arrays are imported from the native-free pure module (no
 * react-native), and the manifest array from the plain CJS config plugin, so the
 * whole test loads under jest with no device / native module.
 */
import {
  REQUIRED_READ_RECORD_TYPES,
  OPTIONAL_READ_RECORD_TYPES,
} from '../lib/healthConnectPure';

// @expo/config-plugins is mocked so the config plugin's mods can be observed
// WITHOUT running the real Expo mod pipeline: each `with*` helper becomes a spy
// that returns config untouched, so invoking `withHealthConnect(config)` reveals
// (by call count) whether the plugin APPLIED its manifest/MainActivity mods or
// short-circuited to a no-op. The factory returns fresh jest.fn()s each time it
// re-runs (after jest.resetModules), so per-env spy counts never bleed across cases.
jest.mock('@expo/config-plugins', () => ({
  withAndroidManifest: jest.fn((config: unknown) => config),
  withMainActivity: jest.fn((config: unknown) => config),
  AndroidConfig: { Manifest: { getMainApplicationOrThrow: jest.fn(() => ({})) } },
  WarningAggregator: { addWarningAndroid: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports -- plain CJS config plugin; only the exported HEALTH_PERMISSIONS constant is read
const { HEALTH_PERMISSIONS } = require('../plugins/withHealthConnect');

/**
 * Every runtime-requested record type → its Android manifest READ_* permission.
 * The single place this mapping lives for the test; adding a runtime record type
 * without extending this map makes the parity assertion below fail loudly.
 */
const RECORD_TYPE_TO_PERMISSION: Record<string, string> = {
  SleepSession: 'android.permission.health.READ_SLEEP',
  HeartRate: 'android.permission.health.READ_HEART_RATE',
  HeartRateVariabilityRmssd:
    'android.permission.health.READ_HEART_RATE_VARIABILITY',
  RestingHeartRate: 'android.permission.health.READ_RESTING_HEART_RATE',
};

describe('Health Connect manifest ↔ runtime permission parity', () => {
  const runtimeRecordTypes = [
    ...REQUIRED_READ_RECORD_TYPES,
    ...OPTIONAL_READ_RECORD_TYPES,
  ];

  it('every runtime-requested record type has a known READ_* permission mapping', () => {
    for (const type of runtimeRecordTypes) {
      // A missing mapping means a NEW record type was requested at runtime
      // without anyone deciding its manifest permission — the drift starts here.
      expect(RECORD_TYPE_TO_PERMISSION[type]).toBeDefined();
    }
  });

  it('the manifest-declared permission set EXACTLY equals the runtime set (no drift, no extras)', () => {
    const runtimePermissions = runtimeRecordTypes.map(
      (t) => RECORD_TYPE_TO_PERMISSION[t]
    );
    // Order-independent set equality — each side must fully cover the other, so a
    // manifest permission with no runtime request (dead grant) fails too.
    expect(new Set(HEALTH_PERMISSIONS)).toEqual(new Set(runtimePermissions));
    // A Set would hide accidental duplicates on either side — assert 1:1.
    expect(HEALTH_PERMISSIONS.length).toBe(new Set(HEALTH_PERMISSIONS).size);
    expect(runtimeRecordTypes.length).toBe(new Set(runtimeRecordTypes).size);
  });

  it('specifically declares the HRV + RestingHeartRate permissions that silently never populated', () => {
    // Named explicitly so a future removal is loud, not silent: HRV was the 2.4.0
    // regression (requested but never declared → no HRV data ever); RestingHeartRate
    // is the Fitbit resting-HR fix (Fitbit writes only a daily resting record).
    expect(HEALTH_PERMISSIONS).toContain(
      'android.permission.health.READ_HEART_RATE_VARIABILITY'
    );
    expect(HEALTH_PERMISSIONS).toContain(
      'android.permission.health.READ_RESTING_HEART_RATE'
    );
  });
});

/**
 * The EXPO_PUBLIC_HEALTH_CONNECT build knob (Play "no-HC" variant): manifest ⇆
 * runtime parity must hold in BOTH modes.
 *   - ENABLED  → the plugin APPLIES its 4 permissions (== the runtime request set),
 *     and the runtime asks for exactly those 4.
 *   - DISABLED → the plugin is a NO-OP (declares nothing, emits an info warning)
 *     AND the runtime requests NOTHING (the shared gate is off). Both empty.
 *
 * The plugin reads `process.env.EXPO_PUBLIC_HEALTH_CONNECT` at CALL time and the
 * flag module reads it at LOAD time, so each case sets the env, resets the module
 * registry, and re-requires @expo/config-plugins (fresh spies) + the plugin + the
 * flag. `HEALTH_PERMISSIONS` stays the canonical 4 in every mode (it's the drift
 * anchor above); what changes is whether the plugin APPLIES them.
 */
describe('Health Connect build knob — manifest ⇆ runtime parity in both modes', () => {
  const ORIG = process.env.EXPO_PUBLIC_HEALTH_CONNECT;
  afterEach(() => {
    if (ORIG === undefined) delete process.env.EXPO_PUBLIC_HEALTH_CONNECT;
    else process.env.EXPO_PUBLIC_HEALTH_CONNECT = ORIG;
    jest.resetModules();
  });

  /** The permissions the app actually requests at runtime for a given build. */
  const runtimeRequestSet = (shouldShow: (os: string) => boolean): string[] =>
    shouldShow('android')
      ? [...REQUIRED_READ_RECORD_TYPES, ...OPTIONAL_READ_RECORD_TYPES].map(
          (t) => RECORD_TYPE_TO_PERMISSION[t]
        )
      : [];

  const loadUnderEnv = (val: string | undefined) => {
    if (val === undefined) delete process.env.EXPO_PUBLIC_HEALTH_CONNECT;
    else process.env.EXPO_PUBLIC_HEALTH_CONNECT = val;
    jest.resetModules();
    /* eslint-disable @typescript-eslint/no-require-imports -- fresh per-env module loads */
    const cp = require('@expo/config-plugins');
    const withHealthConnect = require('../plugins/withHealthConnect');
    const { shouldShowHealthConnect } = require('../lib/healthConnectConfig');
    /* eslint-enable @typescript-eslint/no-require-imports */
    return { cp, withHealthConnect, shouldShowHealthConnect };
  };

  it.each([undefined, '1'])(
    'ENABLED (env=%s): plugin applies the 4 perms === the runtime request set',
    (val) => {
      const { cp, withHealthConnect, shouldShowHealthConnect } =
        loadUnderEnv(val);

      const out = withHealthConnect({ modResults: {} });

      // The plugin ran BOTH mods (manifest perms/alias + MainActivity delegate).
      expect(cp.withAndroidManifest).toHaveBeenCalledTimes(1);
      expect(cp.withMainActivity).toHaveBeenCalledTimes(1);
      expect(cp.WarningAggregator.addWarningAndroid).not.toHaveBeenCalled();
      expect(out).toBeTruthy();

      const runtime = runtimeRequestSet(shouldShowHealthConnect);
      expect(runtime).toHaveLength(4);
      // manifest (what the plugin declares) === runtime request set, order-free.
      expect(new Set(withHealthConnect.HEALTH_PERMISSIONS)).toEqual(
        new Set(runtime)
      );
    }
  );

  it("DISABLED (env='0'): plugin is a NO-OP and the runtime requests NOTHING — both empty", () => {
    const { cp, withHealthConnect, shouldShowHealthConnect } =
      loadUnderEnv('0');

    const config = { modResults: { sentinel: true } };
    const out = withHealthConnect(config);

    // No manifest mod, no MainActivity mod — config returned untouched, plus an
    // info line explaining the exclusion. This is what makes the generated
    // manifest carry ZERO android.permission.health.* (CI asserts grep -c == 0).
    expect(cp.withAndroidManifest).not.toHaveBeenCalled();
    expect(cp.withMainActivity).not.toHaveBeenCalled();
    expect(cp.WarningAggregator.addWarningAndroid).toHaveBeenCalledTimes(1);
    expect(out).toBe(config);

    // Runtime side: the shared gate is off, so no permission is ever requested.
    expect(runtimeRequestSet(shouldShowHealthConnect)).toEqual([]);
  });
});
