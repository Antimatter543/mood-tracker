/**
 * Render tests for HealthConnectSection — lock the two polish fixes:
 *
 *  BUG 1 (wrong copy): a device with NO Health Connect app reports
 *  SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED → getStatus() 'provider_required'.
 *  That must render the INSTALL action, never the old "needs an update / Update
 *  Health Connect" copy. A device that genuinely can't run Health Connect
 *  ('unavailable') must render a dead-end info state with NO install button.
 *
 *  BUG 2 (stale until restart): the card must RE-CHECK on focus (via
 *  useFocusEffect), so installing/updating Health Connect and returning updates
 *  the card without an app restart.
 *
 * The native shell (lib/healthConnect) + DB + theme + expo-router are mocked so
 * this runs with no device / native module. The phase decision itself is unit-
 * tested purely in healthConnectConfig.test.ts (resolveHealthConnectPhase); this
 * file guards that each phase renders the right user-facing copy/button.
 */
import React from 'react';
import { Platform } from 'react-native';
import { render, waitFor, act } from '@testing-library/react-native';

// Render on Android (the section is gated off elsewhere) at a supported API level
// (below the Android-16 gate) so the SDK status — not the version gate — decides.
// Platform.Version is a getter under jest-expo (plain assignment is a no-op), so
// override it via defineProperty; Platform.OS is writable.
Platform.OS = 'android';
Object.defineProperty(Platform, 'Version', { configurable: true, get: () => 31 });

// ── Health Connect native shell: fully mocked; getStatus is driven per test ────
const mockGetStatus = jest.fn();
jest.mock('@/lib/healthConnect', () => ({
  getStatus: (...args: unknown[]) => mockGetStatus(...args),
  hasReadPermission: jest.fn(async () => false),
  connect: jest.fn(async () => ({ granted: false, grantedPermissions: [] })),
  disconnect: jest.fn(async () => true),
  openHealthConnectSettings: jest.fn(),
}));

jest.mock('@/lib/healthSync', () => ({
  syncHealthMetrics: jest.fn(async () => ({
    success: true,
    syncedAt: '2026-07-08T00:00:00.000Z',
  })),
}));
jest.mock('@/databases/health-metrics', () => ({
  clearAllHealthMetrics: jest.fn(async () => {}),
}));
jest.mock('@/databases/user-settings', () => ({
  getSetting: jest.fn(async () => ''), // never opted in → 'available' shows "Connect"
  updateSetting: jest.fn(async () => {}),
}));
// Stable db handle — a fresh object per render would churn the useCallback deps.
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

// ── expo-router useFocusEffect: faithful stand-in + a manual "refocus" handle ──
// Mirrors the real hook's contract (run the memoized callback on focus, forward a
// returned cleanup on blur) AND stashes the latest callback so a test can invoke
// it to simulate the screen regaining focus.
const mockFocus: { cb: null | (() => void | (() => void)) } = { cb: null };
jest.mock('expo-router', () => {
  const ReactActual = require('react') as typeof React;
  return {
    useFocusEffect: (cb: () => void | (() => void)) => {
      mockFocus.cb = cb;
      ReactActual.useEffect(() => {
        const cleanup = cb();
        return typeof cleanup === 'function' ? cleanup : undefined;
      }, [cb]);
    },
    // useDataRefresh also reads useIsFocused (VECTOR 2). This section drives its
    // refresh via the manual mockFocus.cb handle, not refreshCount, so a constant
    // `true` keeps VECTOR 2 inert here (refreshCount never changes) while letting
    // the hook mount without crashing.
    useIsFocused: () => true,
  };
});

import { HealthConnectSection } from '@/components/HealthConnectSection';

beforeEach(() => {
  mockGetStatus.mockReset();
  mockFocus.cb = null;
  Platform.OS = 'android';
});

describe('HealthConnectSection — Bug 1: not-installed vs unavailable copy', () => {
  it('provider_required (no Health Connect installed) shows INSTALL copy, not an update prompt', async () => {
    mockGetStatus.mockResolvedValue('provider_required');

    const { getByText, queryByText } = await render(<HealthConnectSection />);

    await waitFor(() =>
      expect(getByText('Install Health Connect')).toBeTruthy()
    );
    // The old wrong copy for this state must be gone.
    expect(queryByText('Update Health Connect')).toBeNull();
    expect(queryByText(/needs an update/i)).toBeNull();
  });

  it('unavailable (device cannot run Health Connect) shows an info state with NO install button', async () => {
    mockGetStatus.mockResolvedValue('unavailable');

    const { getByText, queryByText } = await render(<HealthConnectSection />);

    await waitFor(() =>
      expect(getByText(/available on this device/i)).toBeTruthy()
    );
    expect(queryByText('Install Health Connect')).toBeNull();
    expect(queryByText('Update Health Connect')).toBeNull();
  });
});

describe('HealthConnectSection — Bug 2: re-check on focus (no restart needed)', () => {
  it('re-runs getStatus on focus so installing Health Connect updates the card', async () => {
    // Cold launch: no provider yet → Install action.
    mockGetStatus.mockResolvedValue('provider_required');
    const { getByText, queryByText } = await render(<HealthConnectSection />);
    await waitFor(() =>
      expect(getByText('Install Health Connect')).toBeTruthy()
    );
    expect(mockGetStatus).toHaveBeenCalledTimes(1);

    // User installs Health Connect and returns to Settings → the SDK now reports
    // available. Regaining focus must re-resolve and flip to the connect flow.
    mockGetStatus.mockResolvedValue('available');
    await act(async () => {
      mockFocus.cb?.();
    });

    await waitFor(() =>
      expect(getByText('Connect Health Connect')).toBeTruthy()
    );
    expect(mockGetStatus).toHaveBeenCalledTimes(2);
    expect(queryByText('Install Health Connect')).toBeNull();
  });
});
