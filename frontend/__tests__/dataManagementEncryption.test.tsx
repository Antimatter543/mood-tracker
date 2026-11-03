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
 *  - Changing or turning off the password needs the current one, with an
 *    "I forgot it" path; after a change it offers a fresh backup.
 *  - Every 14 days a backup first asks to confirm the password (skippable).
 *  - An unreadable stored key never produces a plain backup.
 *  - A build without native Argon2 refuses to turn encryption on.
 *  - Restoring an encrypted backup from elsewhere opens the unlock dialog,
 *    re-asks with an error (the field keeping focus) after a wrong
 *    password, closes on success, and offers to keep the password.
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
// The calibrated params above are what the UI must describe; deriving with
// them for real would cost seconds per test, so key derivation runs with cheap
// params while the stored header keeps the calibrated values. createBackupKey
// and deriveBackupKey are mapped the SAME way, so checking the current
// password (which derives under the stored header) still works.
jest.mock('@/lib/backupCrypto', () => {
  const actual = jest.requireActual('@/lib/backupCrypto');
  const cheap = (kdf: any) => ({ ...kdf, memoryKiB: 64, iterations: 1, parallelism: 1 });
  return {
    ...actual,
    createBackupKey: async (password: string, params: any) => {
      const key = await actual.createBackupKey(password, cheap(params));
      return { kdf: { ...params, salt: key.kdf.salt }, key: key.key };
    },
    deriveBackupKey: async (password: string, kdf: any) => {
      const key = await actual.deriveBackupKey(password, kdf.memoryKiB === 48 * 1024 ? cheap(kdf) : kdf);
      return { kdf: { ...kdf }, key: key.key };
    },
  };
});
const mockCanDerive = jest.fn(() => true);
jest.mock('@/lib/argon2', () => ({
  ...jest.requireActual('@/lib/argon2'),
  canDeriveBackupKeys: () => mockCanDerive(),
}));

import { DataManagementSection, describeKdf } from '@/components/DataManagementSection';
import * as dataExport from '@/databases/data-export';
import { createBackupKey, encryptBackup } from '@/lib/backupCrypto';
import { getBackupKey, getPasswordConfirmedAt, markPasswordConfirmed } from '@/lib/backupKeyStore';

const SecureStoreMock = SecureStore as unknown as { __reset: () => void; __dump: () => Record<string, string> };
const DAY = 24 * 60 * 60 * 1000;

/**
 * Alert.alert spy. `press` maps an alert title to the button to press in it
 * (alerts with no entry are left unanswered, like a user ignoring them).
 */
const alertSpy = (press: Record<string, string> = {}) =>
  jest.spyOn(Alert, 'alert').mockImplementation((title, _msg, buttons) => {
    const label = press[title];
    buttons?.find(b => b.text === label)?.onPress?.();
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

/** Render with encryption already on (password 'first passphrase'). */
async function renderWithEncryption() {
  const alerts = alertSpy();
  await renderSection();
  await turnOn('first passphrase');
  await waitFor(() => expect(encryptionSwitch().props.value).toBe(true));
  alerts.mockRestore();
}

async function openChange() {
  await fireEvent.press(screen.getByLabelText('Change backup password'));
}

async function fillChange(current: string, next: string) {
  await fireEvent.changeText(screen.getByLabelText('Current password'), current);
  await fireEvent.changeText(screen.getByLabelText('New password'), next);
  await fireEvent.changeText(screen.getByLabelText('Repeat password'), next);
  await fireEvent.press(screen.getByLabelText('Change password'));
}

const mockExport = () =>
  jest.spyOn(dataExport, 'exportDatabaseData').mockResolvedValue({ success: true, message: 'ok' });

beforeEach(() => {
  jest.restoreAllMocks();
  SecureStoreMock.__reset();
  mockCanDerive.mockReturnValue(true);
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
    expect(screen.queryByLabelText('Current password')).toBeNull();
    expect(screen.queryByLabelText('I forgot my backup password')).toBeNull();
    expect(encryptionSwitch().props.value).toBe(false); // not on until saved
  });

  it('a build without native Argon2 refuses to turn it on, with a clear message', async () => {
    mockCanDerive.mockReturnValue(false);
    const alerts = alertSpy();
    await renderSection();
    await fireEvent(encryptionSwitch(), 'valueChange', true);
    expect(alerts).toHaveBeenCalledWith("Can't turn on encryption", expect.stringMatching(/can't encrypt backups/));
    expect(screen.queryByLabelText('New password')).toBeNull();
    expect(encryptionSwitch().props.value).toBe(false);
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
});

describe('changing the password', () => {
  it('needs the current password, replaces the key, then offers a fresh backup', async () => {
    await renderWithEncryption();
    const before = (await getBackupKey())!.kdf.salt;
    const exportSpy = mockExport();
    const alerts = alertSpy({ 'Password changed': 'Back up now' });

    await openChange();
    await fillChange('first passphrase', 'second passphrase');

    await waitFor(async () => expect((await getBackupKey())!.kdf.salt).not.toBe(before));
    expect(alerts).toHaveBeenCalledWith('Password changed', expect.stringMatching(/Make a new backup now/), expect.any(Array));
    await waitFor(() => expect(exportSpy).toHaveBeenCalledTimes(1));
  });

  it('a wrong current password says so and changes nothing', async () => {
    await renderWithEncryption();
    const before = (await getBackupKey())!.kdf.salt;

    await openChange();
    await fillChange('not my password', 'second passphrase');

    await waitFor(() => screen.getByText("That's not your backup password."));
    expect((await getBackupKey())!.kdf.salt).toBe(before);
    expect(screen.getByLabelText('Current password')).toBeTruthy(); // still open
  });

  it('"I forgot it" warns, then sets a new password without the old one', async () => {
    await renderWithEncryption();
    const before = (await getBackupKey())!.kdf.salt;
    const alerts = alertSpy({ 'Forgot your backup password?': 'Set new password' });

    await openChange();
    await fireEvent.press(screen.getByLabelText('I forgot my backup password'));
    expect(alerts).toHaveBeenCalledWith(
      'Forgot your backup password?',
      expect.stringMatching(/can't be opened without it/),
      expect.any(Array)
    );
    // The reset dialog: no current-password field.
    await waitFor(() => screen.getByLabelText('Save password'));
    expect(screen.queryByLabelText('Current password')).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('New password'), 'brand new passphrase');
    await fireEvent.changeText(screen.getByLabelText('Repeat password'), 'brand new passphrase');
    await fireEvent.press(screen.getByLabelText('Save password'));

    await waitFor(async () => expect((await getBackupKey())!.kdf.salt).not.toBe(before));
    expect(alerts).toHaveBeenCalledWith('Password saved', expect.stringMatching(/Make a new backup now/), expect.any(Array));
  });
});

describe('turning it off', () => {
  it('needs the current password, then removes the key', async () => {
    await renderWithEncryption();
    await fireEvent(encryptionSwitch(), 'valueChange', false);

    await fireEvent.changeText(screen.getByLabelText('Current password'), 'wrong one');
    await fireEvent.press(screen.getByLabelText('Turn off'));
    await waitFor(() => screen.getByText("That's not your backup password."));
    expect(encryptionSwitch().props.value).toBe(true);

    await fireEvent.changeText(screen.getByLabelText('Current password'), 'first passphrase');
    await fireEvent.press(screen.getByLabelText('Turn off'));
    await waitFor(() => expect(encryptionSwitch().props.value).toBe(false));
    expect(SecureStoreMock.__dump()).toEqual({});
  });

  it('"I forgot it" warns, then turns it off', async () => {
    await renderWithEncryption();
    const alerts = alertSpy({ 'Forgot your backup password?': 'Turn off' });
    await fireEvent(encryptionSwitch(), 'valueChange', false);
    await fireEvent.press(screen.getByLabelText('I forgot my backup password'));

    expect(alerts).toHaveBeenCalledWith('Forgot your backup password?', expect.stringMatching(/turned off/), expect.any(Array));
    await waitFor(() => expect(encryptionSwitch().props.value).toBe(false));
    expect(SecureStoreMock.__dump()).toEqual({});
  });
});

describe('periodic "Confirm your backup password" on backup', () => {
  // The button does not hand its promise to the press (RNTL's fireEvent
  // would otherwise wait for a backup that waits on this dialog).
  const startBackup = () => fireEvent.press(screen.getByText('Back up'));

  async function dueForConfirmation() {
    await renderWithEncryption();
    await markPasswordConfirmed(Date.now() - 15 * DAY);
  }

  it('is not shown when the password was confirmed recently', async () => {
    await renderWithEncryption();
    const exportSpy = mockExport();
    alertSpy();
    await fireEvent.press(screen.getByText('Back up'));
    await waitFor(() => expect(exportSpy).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Confirm your backup password')).toBeNull();
  });

  it('after 14 days: a wrong entry says so, a correct one resets the timer and backs up', async () => {
    await dueForConfirmation();
    const exportSpy = mockExport();
    alertSpy();

    await startBackup();
    await waitFor(() => screen.getByText('Confirm your backup password'));
    expect(exportSpy).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByLabelText('Backup password'), 'not it');
    await fireEvent.press(screen.getByLabelText('Confirm'));
    await waitFor(() => screen.getByText("That's not your backup password."));
    expect(exportSpy).not.toHaveBeenCalled();

    const before = Date.now();
    await fireEvent.changeText(screen.getByLabelText('Backup password'), 'first passphrase');
    await fireEvent.press(screen.getByLabelText('Confirm'));
    await waitFor(() => expect(exportSpy).toHaveBeenCalledTimes(1));
    expect(await getPasswordConfirmedAt()).toBeGreaterThanOrEqual(before);
    expect(screen.queryByText('Confirm your backup password')).toBeNull();
  });

  it('Skip backs up without resetting the timer', async () => {
    await dueForConfirmation();
    const confirmedAt = await getPasswordConfirmedAt();
    const exportSpy = mockExport();
    alertSpy();

    await startBackup();
    await waitFor(() => screen.getByLabelText('Skip'));
    await fireEvent.press(screen.getByLabelText('Skip'));

    await waitFor(() => expect(exportSpy).toHaveBeenCalledTimes(1));
    expect(await getPasswordConfirmedAt()).toBe(confirmedAt);
  });

  it('closing it cancels the backup', async () => {
    await dueForConfirmation();
    const exportSpy = mockExport();
    alertSpy();

    await startBackup();
    await waitFor(() => screen.getByLabelText('Close backup password'));
    await fireEvent.press(screen.getByLabelText('Close backup password'));

    await waitFor(() => expect(screen.queryByText('Confirm your backup password')).toBeNull());
    expect(exportSpy).not.toHaveBeenCalled();
  });
});

describe('stored key unreadable', () => {
  async function renderUnreadable() {
    await SecureStore.setItemAsync('backup_encryption_key_v1', 'not json{');
    await renderSection();
    await waitFor(() => expect(encryptionSwitch().props.value).toBe(true));
  }

  it('shows encryption as on, says the password could not be read, and offers to enter it', async () => {
    await renderUnreadable();
    expect(screen.getByText(/couldn't be read/)).toBeTruthy();
    expect(screen.getByLabelText('Enter backup password')).toBeTruthy();
  });

  it('a backup stops (never written plain) and asks for the password again', async () => {
    await renderUnreadable();
    const exportSpy = mockExport();
    const alerts = alertSpy({ "Can't read backup password": 'Enter password' });

    await fireEvent.press(screen.getByText('Back up'));

    await waitFor(() =>
      expect(alerts).toHaveBeenCalledWith("Can't read backup password", expect.stringMatching(/Enter your backup password again/), expect.any(Array))
    );
    expect(exportSpy).not.toHaveBeenCalled();
    await waitFor(() => screen.getByLabelText('Save password'));
    await fireEvent.changeText(screen.getByLabelText('New password'), 'my passphrase again');
    await fireEvent.changeText(screen.getByLabelText('Repeat password'), 'my passphrase again');
    await fireEvent.press(screen.getByLabelText('Save password'));
    await waitFor(async () => expect(await getBackupKey()).not.toBeNull());
    expect(screen.queryByText(/couldn't be read/)).toBeNull();
  });
});

describe('restoring an encrypted backup from elsewhere', () => {
  async function restoreFromOtherPhone(alerts: Record<string, string>) {
    const key = await createBackupKey('other phone pass', { name: 'argon2id', memoryKiB: 64, iterations: 1, parallelism: 1 });
    const file = await encryptBackup(
      JSON.stringify({ version: 3, data: { activityGroups: [], activities: [], entries: [], settings: [] } }),
      key
    );
    (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///x.json' }] });
    (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValue(file);
    const spy = alertSpy({ 'Import Data': 'Continue', ...alerts });

    await renderSection();
    await fireEvent.press(screen.getByText('Restore'));
    await waitFor(() => screen.getByLabelText('Backup password'));
    return spy;
  }

  it('asks for the password, re-asks after a wrong one, and closes on success', async () => {
    const alerts = await restoreFromOtherPhone({});
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

    await waitFor(() => expect(alerts).toHaveBeenCalledWith('Data restored', expect.any(String), expect.any(Array)));
    expect(screen.queryByLabelText('Backup password')).toBeNull();
    expect(mockRefetchEntries).toHaveBeenCalled();
  });

  it('on a phone without encryption, offers to keep encrypting with that password (Yes)', async () => {
    const alerts = await restoreFromOtherPhone({ 'Data restored': 'Yes' });
    await fireEvent.changeText(screen.getByLabelText('Backup password'), 'other phone pass');
    await fireEvent.press(screen.getByLabelText('Unlock and restore'));

    await waitFor(() =>
      expect(alerts).toHaveBeenCalledWith(
        'Data restored',
        expect.stringMatching(/Keep encrypting new backups with this password\?$/),
        expect.any(Array)
      )
    );
    await waitFor(() => expect(encryptionSwitch().props.value).toBe(true));
    // A fresh salt on THIS phone, not the other phone's.
    expect((await getBackupKey())!.kdf.memoryKiB).toBe(48 * 1024);
  });

  it('No leaves encryption off', async () => {
    const alerts = await restoreFromOtherPhone({ 'Data restored': 'No' });
    await fireEvent.changeText(screen.getByLabelText('Backup password'), 'other phone pass');
    await fireEvent.press(screen.getByLabelText('Unlock and restore'));

    await waitFor(() => expect(alerts).toHaveBeenCalledWith('Data restored', expect.any(String), expect.any(Array)));
    expect(await getBackupKey()).toBeNull();
    expect(encryptionSwitch().props.value).toBe(false);
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
