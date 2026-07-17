/**
 * __tests__/healthConnectConfig.test.ts
 *
 * Pure gating helpers for the Health Connect feature — no native module, no DB.
 *
 * 2026-07-13: the Android-version gate was REMOVED. An earlier build hard-blocked
 * Android 16 / API 36 ("not supported on your Android version"); that was
 * over-broad (Health Connect works on Android 14/15/16 real devices — the
 * "silent fail" only reproduced on an emulator). `resolveHealthConnectPhase` is
 * now a pure function of the SDK status, with no version input. These tests lock
 * that in — including that NO device version can force an "unsupported" phase.
 */
import {
  resolveHealthConnectPhase,
  shouldShowHealthConnect,
} from '../lib/healthConnectConfig';
import type { HealthConnectStatus } from '../lib/healthConnect';

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

/**
 * The build knob: `EXPO_PUBLIC_HEALTH_CONNECT` drives `HEALTH_CONNECT_ENABLED`
 * (and therefore the default `enabled` arg every UI gate uses). Because the flag
 * is a module-level const read at load time, each case sets the env, resets the
 * module registry, and re-requires the module fresh. Under jest, babel-preset-expo
 * rewrites `process.env.EXPO_PUBLIC_*` to a live read of the virtual env module
 * (which IS `process.env`), so a runtime env change + resetModules re-derives it —
 * the same mechanism Metro uses to inline the value into the shipped bundle.
 */
describe('HEALTH_CONNECT_ENABLED (EXPO_PUBLIC_HEALTH_CONNECT build knob)', () => {
  const ORIG = process.env.EXPO_PUBLIC_HEALTH_CONNECT;
  afterEach(() => {
    if (ORIG === undefined) delete process.env.EXPO_PUBLIC_HEALTH_CONNECT;
    else process.env.EXPO_PUBLIC_HEALTH_CONNECT = ORIG;
    jest.resetModules();
  });

  const loadEnabled = (): boolean => {
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- fresh module load per env value
    return require('../lib/healthConnectConfig').HEALTH_CONNECT_ENABLED;
  };
  const loadGate = () => {
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- fresh module load per env value
    return require('../lib/healthConnectConfig').shouldShowHealthConnect as (
      os: string
    ) => boolean;
  };

  it("'0' DISABLES the feature (Play no-HC variant)", () => {
    process.env.EXPO_PUBLIC_HEALTH_CONNECT = '0';
    expect(loadEnabled()).toBe(false);
    // The Android gate (used by Settings + Insights via the default arg) is off.
    expect(loadGate()('android')).toBe(false);
  });

  it('unset ENABLES the feature (default — normal GitHub build)', () => {
    delete process.env.EXPO_PUBLIC_HEALTH_CONNECT;
    expect(loadEnabled()).toBe(true);
    expect(loadGate()('android')).toBe(true);
  });

  it("any non-'0' value ENABLES the feature (only the exact '0' disables — fail-safe)", () => {
    for (const v of ['1', 'true', 'enabled', '']) {
      process.env.EXPO_PUBLIC_HEALTH_CONNECT = v;
      expect(loadEnabled()).toBe(true);
    }
  });
});

describe('resolveHealthConnectPhase (SDK status → card phase)', () => {
  it('maps each SDK status to its phase', () => {
    expect(resolveHealthConnectPhase('available')).toBe('available');
    expect(resolveHealthConnectPhase('provider_required')).toBe('provider_required');
    expect(resolveHealthConnectPhase('unavailable')).toBe('unavailable');
  });

  it('folds the impossible-on-Android unsupported_platform into unavailable', () => {
    expect(resolveHealthConnectPhase('unsupported_platform')).toBe('unavailable');
  });

  it('keeps "provider missing/outdated" DISTINCT from "device unsupported" (the bug)', () => {
    // A device with no Health Connect app reports provider_required — it must land
    // on the install-or-update phase, NOT the dead-end "not available" phase.
    const notInstalled = resolveHealthConnectPhase('provider_required');
    const cannotRun = resolveHealthConnectPhase('unavailable');
    expect(notInstalled).toBe('provider_required');
    expect(cannotRun).toBe('unavailable');
    expect(notInstalled).not.toBe(cannotRun);
  });

  it('has NO Android-version gate — the phase depends ONLY on SDK status', () => {
    // Regression guard for the Android-16 block: the resolver takes a single
    // argument (the status) and never emits an "unsupported_version" phase. Every
    // status maps to a status-driven phase, never a version-driven one.
    const statuses: HealthConnectStatus[] = [
      'available',
      'provider_required',
      'unavailable',
      'unsupported_platform',
    ];
    for (const status of statuses) {
      const phase = resolveHealthConnectPhase(status);
      expect(phase).not.toBe('unsupported_version');
      expect(['available', 'provider_required', 'unavailable']).toContain(phase);
    }
    // The function is unary — a stray second (version) arg would be a type error.
    expect(resolveHealthConnectPhase.length).toBe(1);
  });
});
