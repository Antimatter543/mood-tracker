/**
 * Render/interaction tests for the "Encrypt backups" controls in
 * DataManagementSection and its BackupPasswordDialog.
 *
 * What this locks:
 *  - Off by default; turning it on starts the Argon2id benchmark right away
 *    and goes through the password dialog (which
 *    renders through the REAL in-tree OverlayProvider) and only flips once a
 *    valid, confirmed password is saved.
 *  - Validation errors (too short, mismatch) keep it off and store nothing.
 *  - Once on: "Change password" and "Technical details" appear (the
 *    calibrated strength lives only behind the latter, not in the hint), and
 *    the stored key is replaced (new salt) on change.
 *  - Turning it off asks first and then removes the key.
 *  - Restoring an encrypted backup from elsewhere opens the unlock dialog,
 *    re-asks with an error (the field keeping focus) after a wrong
 *    password, and closes on success.
 *
 * The secure store is the in-memory hand mock and the crypto is real; only
 * the calibration is replaced with cheap fixed params so the suite stays fast.
 * Every render()/fireEvent() is awaited (RNTL v14 is async-by-default, see
 * the note at the top of remindersSection.test.tsx).
 */
import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor, screen } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import * as FileSystem from 'expo-file-system/legacy';
import * as DocumentPicker from 'expo-document-picker';

import { OverlayProvider } from '@/context/OverlayHost';
import type { Settings } from '@/databases/settings';

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
jest.mock('@/databases/writeTransaction', () => ({
  withWriteTransaction: async (fn: (txn: unknown) => Promise<void>) =>
    fn({ getAllAsync: async () => [], getFirstAsync: async () => ({ maxOrder: 0 }), runAsync: async () => ({ lastInsertRowId: 1 }) }),
}));
jest.mock('expo-document-picker');
jest.mock('expo-file-system/legacy', () => require('../__mocks__/expo-file-system'));
const mockCalibrate = jest.fn(async () => ({
  params: { name: 'argon2id', memoryKiB: 48 * 1024, iterations: 2, parallelism: 4 },
}));
jest.mock('@/lib/backupKdfCalibration', () => ({
  calibrateKdfParams: () => mockCalibrate(),
}));
// The calibrated params above are what the UI must describe; derive with them
// for real would cost seconds per test, so key creation uses cheap params while
// still storing the calibrated header.
jest.mock('@/lib/backupCrypto', () => {
  const actual = jest.requireActual('@/lib/backupCrypto');
  return {
    ...actual,
    createBackupKey: async (password: string, params: any) => {
      const cheap = await actual.createBackupKey(password, { ...params, memoryKiB: 64, iterations: 1, parallelism: 1 });
      return { kdf: { ...params, salt: cheap.kdf.salt }, key: cheap.key };
    },
  };
});

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

import { DataManagementSection, describeKdf } from '@/components/DataManagementSection';
import { createBackupKey, encryptBackup } from '@/lib/backupCrypto';
import { getBackupKey } from '@/lib/backupKeyStore';

const SecureStoreMock = SecureStore as unknown as { __reset: () => void; __dump: () => Record<string, string> };

/** Alert.alert spy that presses the button with `pressLabel`, if given. */
const alertSpy = (pressLabel?: string) =>
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
    const button = buttons?.find(b => b.text === pressLabel);
    button?.onPress?.();
  });

const renderSection = () =>
  render(
    <OverlayProvider>
      <DataManagementSection />
    </OverlayProvider>
  );

const encryptionSwitch = () => screen.getByLabelText('Encrypt backups');

async function turnOn(password = 'a long passphrase', confirmation = password) {
  await fireEvent(encryptionSwitch(), 'valueChange', true);
  await fireEvent.changeText(screen.getByLabelText('New password'), password);
  await fireEvent.changeText(screen.getByLabelText('Repeat password'), confirmation);
  await fireEvent.press(screen.getByLabelText('Turn on encryption'));
}

beforeEach(() => {
  jest.restoreAllMocks();
  SecureStoreMock.__reset();
});

describe('Encrypt backups switch', () => {
  it('is off by default', async () => {
    await renderSection();
    await waitFor(() => expect(encryptionSwitch().props.value).toBe(false));
    expect(screen.queryByLabelText('Change backup password')).toBeNull();
  });

  it('turning it on opens the password dialog with focus on the first field', async () => {
    await renderSection();
    mockCalibrate.mockClear();
    await fireEvent(encryptionSwitch(), 'valueChange', true);
    // The on-device benchmark starts with the dialog, before anything is
    // typed, so it never adds to the wait after "Turn on encryption".
    expect(mockCalibrate).toHaveBeenCalledTimes(1);
    const field = screen.getByLabelText('New password');
    expect(field.props.autoFocus).toBe(true);
    expect(field.props.secureTextEntry).toBe(true);
    expect(encryptionSwitch().props.value).toBe(false); // not on until saved
  });

  it.each([
    ['too short', 'short', 'short', /at least 8/],
    ['mismatched', 'a long passphrase', 'a long passphrasE', /do not match/],
  ])('rejects a %s password and stores nothing', async (_name, pw, confirm, message) => {
    await renderSection();
    await turnOn(pw, confirm);
    expect(screen.getByText(message)).toBeTruthy();
    expect(SecureStoreMock.__dump()).toEqual({});
    expect(encryptionSwitch().props.value).toBe(false);
  });

  it('a valid password turns it on, offers a change, and shows the strength only under technical details', async () => {
    const alerts = alertSpy();
    await renderSection();
    await turnOn();

    await waitFor(() => expect(encryptionSwitch().props.value).toBe(true));
    expect(screen.queryByLabelText('New password')).toBeNull(); // dialog closed
    expect(screen.getByLabelText('Change backup password')).toBeTruthy();
    // The parameters are behind "Technical details", not in the hint.
    expect(screen.queryByText(/Argon2id/)).toBeNull();
    await fireEvent.press(screen.getByLabelText('Backup encryption technical details'));
    expect(alerts).toHaveBeenLastCalledWith(
      'Technical details',
      expect.stringContaining('Argon2id, 48 MiB × 2 passes, 4 lanes')
    );
    expect(alerts).toHaveBeenCalledWith('Backups are encrypted', expect.stringMatching(/cannot be shown again/));
    expect(JSON.stringify(SecureStoreMock.__dump())).not.toContain('a long passphrase');
  });

  it('changing the password replaces the stored key', async () => {
    alertSpy();
    await renderSection();
    await turnOn('first passphrase');
    await waitFor(() => expect(encryptionSwitch().props.value).toBe(true));
    const before = (await getBackupKey())!.kdf.salt;

    await fireEvent.press(screen.getByLabelText('Change backup password'));
    await fireEvent.changeText(screen.getByLabelText('New password'), 'second passphrase');
    await fireEvent.changeText(screen.getByLabelText('Repeat password'), 'second passphrase');
    await fireEvent.press(screen.getByLabelText('Change password'));

    await waitFor(async () => expect((await getBackupKey())!.kdf.salt).not.toBe(before));
  });

  it('turning it off asks first, then removes the key', async () => {
    alertSpy();
    await renderSection();
    await turnOn();
    await waitFor(() => expect(encryptionSwitch().props.value).toBe(true));

    jest.restoreAllMocks();
    const alerts = alertSpy('Turn off');
    await fireEvent(encryptionSwitch(), 'valueChange', false);

    expect(alerts).toHaveBeenCalledWith('Stop encrypting backups?', expect.any(String), expect.any(Array));
    await waitFor(() => expect(encryptionSwitch().props.value).toBe(false));
    expect(SecureStoreMock.__dump()).toEqual({});
  });
});

describe('restoring an encrypted backup from elsewhere', () => {
  it('asks for the password, re-asks after a wrong one, and closes on success', async () => {
    const key = await createBackupKey('other phone pass', { name: 'argon2id', memoryKiB: 64, iterations: 1, parallelism: 1 });
    const file = await encryptBackup(
      JSON.stringify({ version: 3, data: { activityGroups: [], activities: [], entries: [], settings: [] } }),
      key
    );
    (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///x.json' }] });
    (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValue(file);
    const alerts = alertSpy('Continue');

    await renderSection();
    await fireEvent.press(screen.getByText('Restore'));

    await waitFor(() => screen.getByLabelText('Backup password'));
    expect(screen.queryByLabelText('Repeat password')).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('Backup password'), 'wrong guess');
    await fireEvent.press(screen.getByLabelText('Unlock and restore'));
    await waitFor(() => screen.getByText(/Wrong password/));
    // The field is never made non-editable (busy or not): on Android that
    // drops its focus and the keyboard, so after a wrong password the user had
    // to tap it again (device QA). Input during an attempt is ignored instead.
    expect(screen.getByLabelText('Backup password').props.editable).not.toBe(false);

    await fireEvent.changeText(screen.getByLabelText('Backup password'), 'other phone pass');
    await fireEvent.press(screen.getByLabelText('Unlock and restore'));

    await waitFor(() => expect(alerts).toHaveBeenCalledWith('Success', expect.any(String)));
    expect(screen.queryByLabelText('Backup password')).toBeNull();
    expect(mockRefetchEntries).toHaveBeenCalled();
  });
});

describe('describeKdf', () => {
  it('reads as memory x passes', () => {
    expect(describeKdf({ name: 'argon2id', memoryKiB: 19 * 1024, iterations: 2, parallelism: 4, salt: '' })).toBe(
      'Argon2id, 19 MiB × 2 passes, 4 lanes'
    );
    expect(describeKdf({ name: 'argon2id', memoryKiB: 256 * 1024, iterations: 1, parallelism: 1, salt: '' })).toBe(
      'Argon2id, 256 MiB × 1 pass, 1 lane'
    );
  });
});
