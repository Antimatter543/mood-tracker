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
