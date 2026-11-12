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
 *  - "Technical details" switches the strength mode (Compatibility,
 *    Security, Manual); the key is derived again after the current password.
 *    Manual shows "Run benchmark" until a benchmark of exactly those params
 *    succeeded, then "Save" (confirmed when slower than 500 ms). A password
 *    change keeps the mode.
 *  - Restoring a backup made with stronger settings than Compatibility
 *    warns first (it may freeze or crash a weaker phone).
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
const mockCalibrate = jest.fn(async (..._args: unknown[]) => ({
  params: { name: 'argon2id', memoryKiB: 48 * 1024, iterations: 2, parallelism: 4 },
}));
jest.mock('@/lib/backupKdfCalibration', () => ({
  ...jest.requireActual('@/lib/backupKdfCalibration'),
  calibrateKdfParams: (...args: unknown[]) => mockCalibrate(...args),
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
      // Every header createBackupKey stores here is >= 1 MiB (calibrated or
      // Manual params); files from "another phone" use real 64 KiB params.
      const key = await actual.deriveBackupKey(password, kdf.memoryKiB >= 1024 ? cheap(kdf) : kdf);
      return { kdf: { ...kdf }, key: key.key };
    },
  };
});
// A 12 GB phone: "Security" may use up to the 1 GiB file limit.
jest.mock('expo-device', () => ({ totalMemory: 12 * 1024 ** 3 }));
// The Manual benchmark: a real derivation with the typed params would take
// seconds in jest, so its result is set per test.
const mockBenchmark = jest.fn();
jest.mock('@/lib/backupKdfProfiles', () => ({
  ...jest.requireActual('@/lib/backupKdfProfiles'),
  benchmarkKdf: (params: unknown) => mockBenchmark(params),
}));
const mockCanDerive = jest.fn(() => true);
jest.mock('@/lib/argon2', () => ({
  ...jest.requireActual('@/lib/argon2'),
  canDeriveBackupKeys: () => mockCanDerive(),
}));

import { DataManagementSection, describeKdf } from '@/components/DataManagementSection';
import * as dataExport from '@/databases/data-export';
import { createBackupKey, encryptBackup, type KdfParams } from '@/lib/backupCrypto';
import { getBackupKey, getPasswordConfirmedAt, markPasswordConfirmed } from '@/lib/backupKeyStore';
import { freezeNow } from '@/testing/clock';

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
    expect(screen.getByText(/Compatibility, Argon2id, 48 MiB × 2 passes, 4 lanes/)).toBeTruthy();
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
    const now = freezeNow();
    await renderWithEncryption();
    await markPasswordConfirmed(now.getTime() - 15 * DAY);
    return now;
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
    const now = await dueForConfirmation();
    const exportSpy = mockExport();
    alertSpy();

    await startBackup();
    await waitFor(() => screen.getByText('Confirm your backup password'));
    expect(exportSpy).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByLabelText('Backup password'), 'not it');
    await fireEvent.press(screen.getByLabelText('Confirm'));
    await waitFor(() => screen.getByText("That's not your backup password."));
    expect(exportSpy).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByLabelText('Backup password'), 'first passphrase');
    await fireEvent.press(screen.getByLabelText('Confirm'));
    await waitFor(() => expect(exportSpy).toHaveBeenCalledTimes(1));
    expect(await getPasswordConfirmedAt()).toBe(now.getTime());
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
  const OTHER_KDF = { name: 'argon2id', memoryKiB: 64, iterations: 1, parallelism: 1 } as const;

  async function restoreFromOtherPhone(alerts: Record<string, string>, kdf: KdfParams = OTHER_KDF) {
    const key = await createBackupKey('other phone pass', kdf);
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

  it("on a phone without encryption, offers the backup's password and protection with its unlock time (Yes)", async () => {
    const STANDARD = { name: 'argon2id', memoryKiB: 32 * 1024, iterations: 2, parallelism: 4 } as const;
    const alerts = await restoreFromOtherPhone({ 'Data restored': 'Yes' }, STANDARD);
    await fireEvent.changeText(screen.getByLabelText('Backup password'), 'other phone pass');
    await fireEvent.press(screen.getByLabelText('Unlock and restore'));

    await waitFor(() =>
      expect(alerts).toHaveBeenCalledWith(
        'Data restored',
        expect.stringMatching(
          /standard protection: unlocking it took \d+ ms on this phone\.\n\nKeep this password and protection for new backups\?$/
        ),
        expect.any(Array)
      )
    );
    await waitFor(() => expect(encryptionSwitch().props.value).toBe(true));
    const stored = (await getBackupKey())!;
    // The backup's params, under a fresh salt.
    expect(stored.kdf).toMatchObject(STANDARD);
    expect(JSON.parse(SecureStoreMock.__dump().backup_encryption_key_v1).profile).toBe('compatibility');
  });

  it('never takes over params weaker than this app writes: calibrates on this phone instead', async () => {
    // 64 KiB x 1 pass: a file may say this, the app never writes it.
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
    expect((await getBackupKey())!.kdf.memoryKiB).toBe(48 * 1024);
    expect(JSON.parse(SecureStoreMock.__dump().backup_encryption_key_v1).profile).toBe('compatibility');
  });

  it('takes over strong protection as Manual, and calls it strong', async () => {
    const strong = { name: 'argon2id', memoryKiB: 256 * 1024, iterations: 2, parallelism: 4 } as const;
    const alerts = await restoreFromOtherPhone({ 'Data restored': 'Yes', 'Strong encryption settings': 'Open' }, strong);
    await fireEvent.changeText(screen.getByLabelText('Backup password'), 'other phone pass');
    await fireEvent.press(screen.getByLabelText('Unlock and restore'));

    await waitFor(() =>
      expect(alerts).toHaveBeenCalledWith('Data restored', expect.stringMatching(/strong protection/), expect.any(Array))
    );
    await waitFor(() => expect(encryptionSwitch().props.value).toBe(true));
    expect((await getBackupKey())!.kdf).toMatchObject(strong);
    expect(JSON.parse(SecureStoreMock.__dump().backup_encryption_key_v1).profile).toBe('manual');
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

describe('strength modes (Technical details)', () => {
  const MiB = 1024;
  const readMode = () => JSON.parse(SecureStoreMock.__dump().backup_encryption_key_v1).profile;

  async function openDetails() {
    await fireEvent.press(screen.getByLabelText('Backup encryption technical details'));
  }

  async function applyWith(password: string) {
    await waitFor(() => screen.getByLabelText('Apply'));
    await fireEvent.changeText(screen.getByLabelText('Backup password'), password);
    await fireEvent.press(screen.getByLabelText('Apply'));
  }

  async function chooseManual(memoryMiB: string, passes: string, lanes: string) {
    await fireEvent.press(screen.getByLabelText('Manual'));
    await fireEvent.changeText(screen.getByLabelText('Memory (MiB)'), memoryMiB);
    await fireEvent.changeText(screen.getByLabelText('Passes'), passes);
    await fireEvent.changeText(screen.getByLabelText('Lanes'), lanes);
  }

  const saveButton = () => screen.getByLabelText('Save encryption settings');

  beforeEach(() => {
    mockBenchmark.mockReset();
  });

  it('shows the current mode with the three choices; nothing to save until the mode changes', async () => {
    await renderWithEncryption();
    await openDetails();

    expect(screen.getByText(/Compatibility, Argon2id, 48 MiB × 2 passes, 4 lanes/)).toBeTruthy();
    expect(screen.getByLabelText('Compatibility (default)').props.accessibilityState.selected).toBe(true);
    expect(screen.getByLabelText('Security')).toBeTruthy();
    expect(screen.getByLabelText('Manual')).toBeTruthy();
    expect(saveButton().props.accessibilityState.disabled).toBe(true);
  });

  it('Security: asks for the password, then calibrates without the caps and stores a new key', async () => {
    await renderWithEncryption();
    const before = (await getBackupKey())!.kdf.salt;
    mockCalibrate.mockClear();
    const alerts = alertSpy();

    await openDetails();
    await fireEvent.press(screen.getByLabelText('Security'));
    await fireEvent.press(saveButton());
    await applyWith('first passphrase');

    await waitFor(() => expect(alerts).toHaveBeenCalledWith('Encryption settings saved', expect.any(String), expect.any(Array)));
    // The benchmark ran with the Security ceilings: the 1 GiB / 20-pass file limits on a 12 GB phone.
    expect(mockCalibrate).toHaveBeenCalledWith(500, undefined, { memoryKiB: 1024 * MiB, iterations: 20 });
    expect(readMode()).toBe('security');
    expect((await getBackupKey())!.kdf.salt).not.toBe(before);
  });

  it('a wrong password keeps the old mode and key', async () => {
    await renderWithEncryption();
    const before = (await getBackupKey())!.kdf.salt;

    await openDetails();
    await fireEvent.press(screen.getByLabelText('Security'));
    await fireEvent.press(saveButton());
    await applyWith('not my password');

    await waitFor(() => screen.getByText("That's not your backup password."));
    expect(readMode()).toBe('compatibility');
    expect((await getBackupKey())!.kdf.salt).toBe(before);
  });

  it('Manual: one button, "Run benchmark" until a benchmark of exactly the typed params succeeded, then "Save"', async () => {
    await renderWithEncryption();
    mockBenchmark.mockImplementation(async (params: any) => ({ ok: true, params, ms: 320 }));

    await openDetails();
    await chooseManual('64', '3', '4');
    expect(screen.getByLabelText('Run benchmark')).toBeTruthy();
    expect(screen.queryByLabelText('Save encryption settings')).toBeNull();

    await fireEvent.press(screen.getByLabelText('Run benchmark'));
    await waitFor(() => screen.getByText('Took 320 ms on this phone.'));
    expect(mockBenchmark).toHaveBeenCalledWith({ name: 'argon2id', memoryKiB: 64 * MiB, iterations: 3, parallelism: 4 });
    expect(saveButton().props.accessibilityState.disabled).toBe(false);
    expect(screen.queryByLabelText('Run benchmark')).toBeNull();

    // Editing a value turns it back into "Run benchmark".
    await fireEvent.changeText(screen.getByLabelText('Passes'), '4');
    expect(screen.queryByLabelText('Save encryption settings')).toBeNull();
    expect(screen.getByLabelText('Run benchmark')).toBeTruthy();
    expect(screen.queryByText(/Took/)).toBeNull();
  });

  it('Manual: saves the typed params after the password, without calibrating', async () => {
    await renderWithEncryption();
    mockBenchmark.mockImplementation(async (params: any) => ({ ok: true, params, ms: 320 }));
    mockCalibrate.mockClear();
    const alerts = alertSpy();

    await openDetails();
    await chooseManual('64', '3', '2');
    await fireEvent.press(screen.getByLabelText('Run benchmark'));
    await waitFor(() => screen.getByText('Took 320 ms on this phone.'));
    await fireEvent.press(saveButton());
    await applyWith('first passphrase');

    await waitFor(() => expect(alerts).toHaveBeenCalledWith('Encryption settings saved', expect.any(String), expect.any(Array)));
    expect(readMode()).toBe('manual');
    expect((await getBackupKey())!.kdf).toMatchObject({ memoryKiB: 64 * MiB, iterations: 3, parallelism: 2 });
    expect(mockCalibrate).not.toHaveBeenCalled();
  });

  it('Manual: slower than 500 ms needs a confirmation; Cancel saves nothing', async () => {
    await renderWithEncryption();
    mockBenchmark.mockImplementation(async (params: any) => ({ ok: true, params, ms: 1800 }));
    const alerts = alertSpy({ 'Slow settings': 'Cancel' });

    await openDetails();
    await chooseManual('512', '4', '4');
    await fireEvent.press(screen.getByLabelText('Run benchmark'));
    await waitFor(() => screen.getByText('Took 1.8 s on this phone.'));
    await fireEvent.press(saveButton());

    expect(alerts).toHaveBeenCalledWith('Slow settings', expect.stringMatching(/took 1\.8 s/), expect.any(Array));
    expect(screen.queryByLabelText('Apply')).toBeNull();
    expect(readMode()).toBe('compatibility');
  });

  it('Manual: "Use anyway" on a slow benchmark goes on to the password', async () => {
    await renderWithEncryption();
    mockBenchmark.mockImplementation(async (params: any) => ({ ok: true, params, ms: 1800 }));
    alertSpy({ 'Slow settings': 'Use anyway' });

    await openDetails();
    await chooseManual('512', '4', '4');
    await fireEvent.press(screen.getByLabelText('Run benchmark'));
    await waitFor(() => screen.getByText(/Took 1\.8 s/));
    await fireEvent.press(saveButton());
    await applyWith('first passphrase');

    await waitFor(() => expect(readMode()).toBe('manual'));
    expect((await getBackupKey())!.kdf).toMatchObject({ memoryKiB: 512 * MiB, iterations: 4 });
  });

  it('Manual: a failed benchmark says so and keeps "Run benchmark" instead of "Save"', async () => {
    await renderWithEncryption();
    mockBenchmark.mockImplementation(async (params: any) => ({ ok: false, params, error: 'Out of memory' }));

    await openDetails();
    await chooseManual('1024', '2', '4');
    await fireEvent.press(screen.getByLabelText('Run benchmark'));

    await waitFor(() => screen.getByText('Benchmark failed: Out of memory'));
    expect(screen.queryByLabelText('Save encryption settings')).toBeNull();
    expect(screen.getByLabelText('Run benchmark')).toBeTruthy(); // to retry
  });

  it('Manual: params below the recommended minimum cannot be benchmarked', async () => {
    await renderWithEncryption();

    await openDetails();
    await chooseManual('19', '1', '4');

    expect(screen.getByText(/Below the recommended minimum/)).toBeTruthy();
    expect(screen.getByLabelText('Run benchmark').props.accessibilityState.disabled).toBe(true);
  });

  it('a password change keeps the mode: Security calibrates with its ceilings again', async () => {
    await renderWithEncryption();
    alertSpy();
    await openDetails();
    await fireEvent.press(screen.getByLabelText('Security'));
    await fireEvent.press(saveButton());
    await applyWith('first passphrase');
    await waitFor(() => expect(readMode()).toBe('security'));
    mockCalibrate.mockClear();

    await openChange();
    expect(mockCalibrate).toHaveBeenCalledWith(500, undefined, { memoryKiB: 1024 * MiB, iterations: 20 });
    await fillChange('first passphrase', 'second passphrase');
    await waitFor(() => expect(screen.queryByLabelText('Change password')).toBeNull());
    expect(readMode()).toBe('security');
  });

  it('a password change keeps Manual params', async () => {
    await renderWithEncryption();
    mockBenchmark.mockImplementation(async (params: any) => ({ ok: true, params, ms: 300 }));
    alertSpy();
    await openDetails();
    await chooseManual('96', '3', '2');
    await fireEvent.press(screen.getByLabelText('Run benchmark'));
    await waitFor(() => screen.getByText('Took 300 ms on this phone.'));
    await fireEvent.press(saveButton());
    await applyWith('first passphrase');
    await waitFor(() => expect(readMode()).toBe('manual'));
    const salt = (await getBackupKey())!.kdf.salt;
    mockCalibrate.mockClear();

    await openChange();
    await fillChange('first passphrase', 'second passphrase');

    await waitFor(async () => expect((await getBackupKey())!.kdf.salt).not.toBe(salt));
    expect(mockCalibrate).not.toHaveBeenCalled();
    expect(readMode()).toBe('manual');
    expect((await getBackupKey())!.kdf).toMatchObject({ memoryKiB: 96 * MiB, iterations: 3, parallelism: 2 });
  });
});

describe('restoring a backup made with stronger settings', () => {
  const MiB = 1024;
  const WARNING = 'Strong encryption settings';

  async function pickBackup(params: { memoryKiB: number; iterations: number }, alerts: Record<string, string>) {
    const key = await createBackupKey('other phone pass', { name: 'argon2id', parallelism: 4, ...params });
    const file = await encryptBackup(
      JSON.stringify({ version: 3, data: { activityGroups: [], activities: [], entries: [], settings: [] } }),
      key
    );
    (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///x.json' }] });
    (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValue(file);
    const spy = alertSpy({ 'Import Data': 'Continue', ...alerts });
    await renderSection();
    await fireEvent.press(screen.getByText('Restore'));
    return spy;
  }

  it('warns that it may freeze or crash the app, then asks for the password on "Open"', async () => {
    const alerts = await pickBackup({ memoryKiB: 512 * MiB, iterations: 2 }, { [WARNING]: 'Open' });

    await waitFor(() => screen.getByLabelText('Backup password'));
    expect(alerts).toHaveBeenCalledWith(
      WARNING,
      expect.stringMatching(/may freeze or crash.*Only open backups you made yourself/s),
      expect.any(Array),
      expect.any(Object)
    );
  });

  it('more passes than Compatibility warns too', async () => {
    const alerts = await pickBackup({ memoryKiB: 64 * MiB, iterations: 8 }, { [WARNING]: 'Open' });
    await waitFor(() => screen.getByLabelText('Backup password'));
    expect(alerts.mock.calls.map(c => c[0])).toContain(WARNING);
  });

  it('"Cancel" stops before any password is asked', async () => {
    const alerts = await pickBackup({ memoryKiB: 512 * MiB, iterations: 2 }, { [WARNING]: 'Cancel' });

    await waitFor(() => expect(alerts.mock.calls.map(c => c[0])).toContain(WARNING));
    expect(screen.queryByLabelText('Backup password')).toBeNull();
    expect(alerts.mock.calls.map(c => c[0])).not.toContain('Import Failed');
  });

  it('Compatibility-strength backups open without the warning', async () => {
    const alerts = await pickBackup({ memoryKiB: 128 * MiB, iterations: 6 }, {});
    await waitFor(() => screen.getByLabelText('Backup password'));
    expect(alerts.mock.calls.map(c => c[0])).not.toContain(WARNING);
  });
});
