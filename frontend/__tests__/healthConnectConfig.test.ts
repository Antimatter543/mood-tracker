/**
 * __tests__/healthConnectConfig.test.ts
 *
 * Pure gating helpers for the Health Connect feature — no native module, no DB.
 */
import {
  HEALTH_CONNECT_MIN_UNSUPPORTED_API,
  isHealthConnectVersionSupported,
  shouldShowHealthConnect,
} from '../lib/healthConnectConfig';

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
