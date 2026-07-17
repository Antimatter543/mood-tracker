/**
 * __tests__/healthConnectSectionDisabled.test.tsx
 *
 * Defense-in-depth for the EXPO_PUBLIC_HEALTH_CONNECT=0 (Play no-HC) build: even
 * mounted directly on Android, the Settings Health Connect card must render
 * NOTHING and make ZERO native Health Connect calls when the feature flag is off.
 *
 * The flag drive-from-env is proven in healthConnectConfig.test.ts (the knob
 * tests). Here we mock the config module to the DISABLED shape at file scope
 * (HEALTH_CONNECT_ENABLED=false, real shouldShowHealthConnect) — a whole separate
 * file rather than a per-test override, because HEALTH_CONNECT_ENABLED is a
 * captured import binding and jest.isolateModules would re-require React and
 * split the renderer's dispatcher. The section reads `HEALTH_CONNECT_ENABLED`
 * both at its render gate AND (via the resolveState guard) before it probes the
 * native module, so a false flag must short-circuit BOTH.
 */
import React from 'react';
import { Platform } from 'react-native';
import { render } from '@testing-library/react-native';

Platform.OS = 'android';
Object.defineProperty(Platform, 'Version', { configurable: true, get: () => 31 });

// The build knob resolved to OFF for this file (Play no-HC variant). Keep the
// real gating logic; only force the flag false.
jest.mock('@/lib/healthConnectConfig', () => {
  const actual = jest.requireActual('@/lib/healthConnectConfig');
  return { ...actual, HEALTH_CONNECT_ENABLED: false };
});

// getStatus must NEVER be called when the feature is off — assert on this spy.
// Untyped (like the sibling section test) so it accepts the forwarded args.
const mockGetStatus = jest.fn();
jest.mock('@/lib/healthConnect', () => ({
  getStatus: (...args: unknown[]) => mockGetStatus(...args),
  hasReadPermission: jest.fn(async () => false),
  connect: jest.fn(async () => ({ granted: false, grantedPermissions: [] })),
  disconnect: jest.fn(async () => true),
  openHealthConnectSettings: jest.fn(),
}));
jest.mock('@/lib/healthSync', () => ({
  syncHealthMetrics: jest.fn(async () => ({ success: true, syncedAt: '' })),
}));
jest.mock('@/databases/health-metrics', () => ({
  clearAllHealthMetrics: jest.fn(async () => {}),
}));
jest.mock('@/databases/user-settings', () => ({
  getSetting: jest.fn(async () => ''),
  updateSetting: jest.fn(async () => {}),
}));
jest.mock('expo-sqlite', () => {
  const db = {};
  return { useSQLiteContext: () => db };
});
jest.mock('@expo/vector-icons/Feather', () => 'Feather');
jest.mock('@/styles/global', () => ({
  useThemeColors: () => ({
    text: '#fff',
    textSecondary: '#aaa',
    accent: '#66aaaa',
    accentLight: '#112233',
    cardBackground: '#111',
    border: '#333',
    overlays: { tag: '#222', tagBorder: '#444' },
  }),
}));
// Faithful useFocusEffect stand-in: runs the memoized callback on mount so the
// resolveState guard actually executes (and we can prove it never calls getStatus).
jest.mock('expo-router', () => {
  const ReactActual = require('react') as typeof React;
  return {
    useFocusEffect: (cb: () => void | (() => void)) => {
      ReactActual.useEffect(() => {
        const cleanup = cb();
        return typeof cleanup === 'function' ? cleanup : undefined;
      }, [cb]);
    },
    useIsFocused: () => true,
  };
});

import { HealthConnectSection } from '@/components/HealthConnectSection';

describe('HealthConnectSection — EXPO_PUBLIC_HEALTH_CONNECT=0 (Play no-HC build)', () => {
  it('renders NOTHING and makes ZERO native Health Connect calls when the flag is off', async () => {
    const { toJSON } = await render(<HealthConnectSection />);

    expect(toJSON()).toBeNull(); // no user-visible Health Connect surface
    expect(mockGetStatus).not.toHaveBeenCalled(); // resolveState skipped the native probe
  });
});
