/**
 * Restore in DataManagementSection for backups from other apps (Daylio), and
 * the "Supported apps" note below it.
 *
 * What this locks: there is ONE Restore button (no separate Daylio import);
 * what happens after picking depends on the file. A Daylio backup shows its
 * preview (describeDaylioImport) and is added on "Import"; a SoulSync backup
 * gets the "replace your data" confirmation; "Cancel" is quiet; failures are
 * reported. The note under Restore names every supported app via
 * SUPPORTED_RESTORE_SOURCES. importDatabaseData is mocked here (its routing is
 * covered in daylioImportFlow.test.ts); the dialog texts are the real ones.
 * Every render()/fireEvent() is awaited (RNTL v14 is async-by-default).
 */
import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { OverlayProvider } from '@/context/OverlayHost';
import type { Settings } from '@/databases/settings';
import type { DaylioImportSummary } from '@/lib/daylioImport';

jest.mock('@/context/SettingsContext', () => ({
  useSettings: () => ({
    settings: {
      fab_position: 'right',
      theme_mode: 'dark',
      theme: 'dark',
      mood_precision: 'low',
      show_mood_benchmarks: true,
      activity_carryover: false,
      date_format: 'system',
      reminders: '[]',
    } as Settings,
    updateSetting: jest.fn(),
  }),
}));
const mockRefetchEntries = jest.fn();
jest.mock('@/context/DataContext', () => ({
  useDataContext: () => ({ refetchEntries: mockRefetchEntries }),
}));
jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => ({}) }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/hooks/useKeyboardHeight', () => ({ useKeyboardHeight: () => 0 }));
jest.mock('react-native-reanimated', () => {
  const ReactLocal = require('react');
  const { View } = require('react-native');
  const entering = { duration: () => entering };
  return {
    __esModule: true,
    default: { View: (props: Record<string, unknown>) => ReactLocal.createElement(View, props) },
    FadeIn: entering,
  };
});

const SUMMARY: DaylioImportSummary = {
  entries: 3,
  activities: 2,
  groups: 1,
  photos: 0,
  firstDate: '2024-01-01T10:00:00.000Z',
  lastDate: '2024-02-01T10:00:00.000Z',
  skipped: { audioNotes: 0, missingPhotos: 0, unreadableEntries: 0 },
};
const mockImport = jest.fn();
jest.mock('@/databases/data-export', () => ({
  ...jest.requireActual('@/databases/data-export'),
  importDatabaseData: (_db: unknown, options: any) => mockImport(options),
}));

import { DataManagementSection } from '@/components/DataManagementSection';
import { describeDaylioImport } from '@/databases/daylio-import';

/** Restore picked a Daylio file: preview, then the outcome if confirmed. */
function pickedDaylio(outcome = { success: true, message: 'Imported 3 entries from Daylio.' }) {
  mockImport.mockImplementation(async ({ confirmDaylio }) =>
    (await confirmDaylio(SUMMARY)) ? outcome : { success: false, message: 'Import cancelled' }
  );
}

/** Alert spy that presses `press` in any dialog offering it. */
function alertPressing(press?: string) {
  return jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
    buttons?.find(b => b.text === press)?.onPress?.();
  });
}

const renderSection = () =>
  render(
    <OverlayProvider>
      <DataManagementSection />
    </OverlayProvider>
  );

beforeEach(() => {
  jest.restoreAllMocks();
  mockImport.mockReset();
  mockRefetchEntries.mockReset();
});

it('has one Restore button and no separate Daylio import', async () => {
  await renderSection();
  expect(screen.getByText('Restore')).toBeTruthy();
  expect(screen.queryByText(/Import from Daylio/)).toBeNull();
});

it('Restore with a Daylio backup previews it, then adds it on "Import"', async () => {
  pickedDaylio();
  const alerts = alertPressing('Import');
  await renderSection();

  await fireEvent.press(screen.getByText('Restore'));

  await waitFor(() => expect(alerts).toHaveBeenCalledWith('Success', 'Imported 3 entries from Daylio.'));
  expect(alerts).toHaveBeenCalledWith('Import from Daylio', describeDaylioImport(SUMMARY), expect.any(Array), expect.any(Object));
  expect(alerts.mock.calls.map(c => c[0])).not.toContain('Import Data');
  expect(mockRefetchEntries).toHaveBeenCalled();
});

it('"Cancel" on the Daylio preview is quiet', async () => {
  pickedDaylio();
  const alerts = alertPressing('Cancel');
  await renderSection();

  await fireEvent.press(screen.getByText('Restore'));

  await waitFor(() => expect(mockImport).toHaveBeenCalled());
  await waitFor(() => expect(alerts.mock.calls.map(c => c[0])).toEqual(['Import from Daylio']));
  expect(mockRefetchEntries).not.toHaveBeenCalled();
});

it('Restore with a SoulSync backup asks the "replace your data" question', async () => {
  mockImport.mockImplementation(async ({ confirmRestore }) =>
    (await confirmRestore()) ? { success: true, message: 'Data imported successfully.' } : { success: false, message: 'Import cancelled' }
  );
  const alerts = alertPressing('Continue');
  await renderSection();

  await fireEvent.press(screen.getByText('Restore'));

  await waitFor(() => expect(alerts).toHaveBeenCalledWith('Success', 'Data imported successfully.'));
  expect(alerts).toHaveBeenCalledWith('Import Data', expect.stringMatching(/replace your current data/), expect.any(Array), expect.any(Object));
});

it('reports a file it cannot restore', async () => {
  const message = "SoulSync can't open this file. Pick a backup made with SoulSync or Daylio.";
  mockImport.mockResolvedValue({ success: false, message });
  const alerts = alertPressing();
  await renderSection();

  await fireEvent.press(screen.getByText('Restore'));

  await waitFor(() => expect(alerts).toHaveBeenCalledWith('Import Failed', message));
});

it('says below Restore that other apps are supported, and lists them on tap', async () => {
  const alerts = alertPressing();
  await renderSection();

  expect(screen.getByText(/Restore also accepts backups from other mood apps/)).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Supported apps'));

  const [title, body] = alerts.mock.calls[0];
  expect(title).toBe('Supported apps');
  expect(body).toMatch(/^SoulSync: /);
  expect(body).toMatch(/Daylio: .*\.daylio/);
});
