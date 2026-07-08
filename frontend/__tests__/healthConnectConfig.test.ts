/**
 * __tests__/healthConnectConfig.test.ts
 *
 * Pure gating helpers for the Health Connect feature — no native module, no DB.
 */
import {
  HEALTH_CONNECT_MIN_UNSUPPORTED_API,
  isHealthConnectVersionSupported,
  resolveHealthConnectPhase,
  shouldShowHealthConnect,
} from '../lib/healthConnectConfig';
import type { HealthConnectStatus } from '../lib/healthConnect';

describe('isHealthConnectVersionSupported (Android-16 gate)', () => {
  it('supports API levels below the unsupported floor', () => {
    expect(isHealthConnectVersionSupported(34)).toBe(true); // Android 14
    expect(isHealthConnectVersionSupported(35)).toBe(true); // Android 15
    expect(isHealthConnectVersionSupported(HEALTH_CONNECT_MIN_UNSUPPORTED_API - 1)).toBe(true);
  });

  it('blocks the unsupported floor and above (Android 16+)', () => {
    expect(isHealthConnectVersionSupported(HEALTH_CONNECT_MIN_UNSUPPORTED_API)).toBe(false); // 36
    expect(isHealthConnectVersionSupported(37)).toBe(false);
  });

  it('pins the floor to Android 16 / API 36', () => {
    expect(HEALTH_CONNECT_MIN_UNSUPPORTED_API).toBe(36);
  });

  it('treats a non-numeric version as unsupported', () => {
    expect(isHealthConnectVersionSupported(Number.NaN)).toBe(false);
    expect(isHealthConnectVersionSupported(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe('shouldShowHealthConnect (feature flag + platform gate)', () => {
  it('shows only on Android with the flag on', () => {
    expect(shouldShowHealthConnect('android', true)).toBe(true);
  });

  it('hides on non-Android regardless of the flag', () => {
    expect(shouldShowHealthConnect('ios', true)).toBe(false);
    expect(shouldShowHealthConnect('web', true)).toBe(false);
  });

  it('hides on Android when the flag is off', () => {
    expect(shouldShowHealthConnect('android', false)).toBe(false);
  });
});

describe('resolveHealthConnectPhase (SDK status → card phase)', () => {
  const SUPPORTED_API = HEALTH_CONNECT_MIN_UNSUPPORTED_API - 1; // e.g. Android 15
  const UNSUPPORTED_API = HEALTH_CONNECT_MIN_UNSUPPORTED_API; // Android 16+

  it('the version gate wins over EVERY SDK status (Android 16+)', () => {
    const statuses: HealthConnectStatus[] = [
      'available',
      'provider_required',
      'unavailable',
      'unsupported_platform',
    ];
    for (const status of statuses) {
      expect(resolveHealthConnectPhase(UNSUPPORTED_API, status)).toBe(
        'unsupported_version'
      );
    }
  });

  it('maps each SDK status on a supported version', () => {
    expect(resolveHealthConnectPhase(SUPPORTED_API, 'available')).toBe('available');
    expect(resolveHealthConnectPhase(SUPPORTED_API, 'provider_required')).toBe(
      'provider_required'
    );
    expect(resolveHealthConnectPhase(SUPPORTED_API, 'unavailable')).toBe(
      'unavailable'
    );
  });

  it('folds the impossible-on-Android unsupported_platform into unavailable', () => {
    expect(resolveHealthConnectPhase(SUPPORTED_API, 'unsupported_platform')).toBe(
      'unavailable'
    );
  });

  it('keeps "provider missing/outdated" DISTINCT from "device unsupported" (the bug)', () => {
    // A device with no Health Connect app reports provider_required — it must land
    // on the install-or-update phase, NOT the dead-end "not available" phase, and
    // NOT the same phase as a device that genuinely can't run Health Connect.
    const notInstalled = resolveHealthConnectPhase(SUPPORTED_API, 'provider_required');
    const cannotRun = resolveHealthConnectPhase(SUPPORTED_API, 'unavailable');
    expect(notInstalled).toBe('provider_required');
    expect(cannotRun).toBe('unavailable');
    expect(notInstalled).not.toBe(cannotRun);
  });

  it('treats a non-numeric API version as unsupported', () => {
    expect(resolveHealthConnectPhase(Number.NaN, 'available')).toBe(
      'unsupported_version'
    );
  });
});
