import { useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';

import type { BackupPasswordDialogMode, BackupPasswordInput } from '@/components/BackupPasswordDialog';
import type { DatabaseResult } from '@/components/types';
import { AcceptedBackupPassword, BACKUP_KEY_UNREADABLE, RequestBackupPassword } from '@/databases/data-export';
import { Argon2UnavailableError, canDeriveBackupKeys } from '@/lib/argon2';
import { KdfHeader, KdfParams, validateNewBackupPassword } from '@/lib/backupCrypto';
import { KDF_TARGET_MS, calibrateKdfParams } from '@/lib/backupKdfCalibration';
import {
  DEFAULT_KDF_PROFILE,
  KdfProfile,
  ceilingsForProfile,
  deviceTotalMemory,
  profileForAdoptedParams,
} from '@/lib/backupKdfProfiles';
import {
  clearBackupPassword,
  getPasswordConfirmedAt,
  isPasswordConfirmationDue,
  markPasswordConfirmed,
  readBackupKeyState,
  setBackupPassword,
  verifyBackupPassword,
} from '@/lib/backupKeyStore';
import { now } from '@/lib/clock';

/**
 * Everything behind Settings > Data Management > "Encrypt backups": the key
 * state, the password dialog and the flows that use it.
 *
 *  - Turn on: new password + repeat.
 *  - Change / turn off: need the current password. Both have "I forgot it",
 *    which warns that backups made with the old password can't be opened,
 *    then sets a new password (change) or turns encryption off (off).
 *  - Before a backup, every PASSWORD_CONFIRM_INTERVAL_MS: "Confirm your
 *    backup password" (skippable), so a forgotten password is found while
 *    there is still a phone that can make new backups, not on restore day.
 *  - After a password change: offer to make a fresh backup right away.
 *  - Stored key unreadable: backups stop (never written plain) and the user
 *    is asked to enter the password again.
 *  - After restoring with a typed password on a phone without encryption:
 *    offer to keep encrypting new backups with that password.
 *  - Strength mode ("Technical details", lib/backupKdfProfiles.ts): needs the
 *    current password, because the key is derived again with the new params
 *    (and a fresh salt). A password change keeps the mode.
 */

export type BackupKeyStatus = 'loading' | 'off' | 'on' | 'unreadable';

type DialogState = { mode: BackupPasswordDialogMode; error: string } | null;

const WRONG_PASSWORD = "That's not your backup password.";
const CHECK_FAILED = 'Could not check the password. Please try again.';

export function useBackupEncryption({ onBackupNow }: { onBackupNow: () => void }) {
  const [status, setStatus] = useState<BackupKeyStatus>('loading');
  // The stored key's header (its calibrated strength, for "Technical details").
  const [kdf, setKdf] = useState<KdfHeader | null>(null);
  // The strength mode the stored key was made in.
  const [profile, setProfile] = useState<KdfProfile>(DEFAULT_KDF_PROFILE);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [busy, setBusy] = useState(false);
  // While a restore waits for a password, the pending answer for importDatabaseData.
  const unlockResolver = useRef<((password: string | null) => void) | null>(null);
  // While a backup waits on "Confirm your backup password": true = go ahead.
  const confirmResolver = useRef<((proceed: boolean) => void) | null>(null);
  // The on-device Argon2id benchmark, started the moment a new-password dialog
  // opens so it has finished (native: tens of ms) before the password is typed.
  // `null` result = it failed; setBackupPassword then calibrates itself.
  const calibration = useRef<Promise<KdfParams | null> | null>(null);
  // The mode the key being saved is made in (and, for a mode change, its params).
  const targetProfile = useRef<KdfProfile>(DEFAULT_KDF_PROFILE);
  // The password that opened the backup being restored, if one was typed.
  const acceptedPassword = useRef<AcceptedBackupPassword | null>(null);

  const applyState = (state: Awaited<ReturnType<typeof readBackupKeyState>>) => {
    setStatus(state.status);
    setKdf(state.status === 'on' ? state.key.kdf : null);
    setProfile(state.status === 'on' ? state.profile : DEFAULT_KDF_PROFILE);
  };

  const refresh = async () => {
    const state = await readBackupKeyState();
    applyState(state);
    return state;
  };

  useEffect(() => {
    let cancelled = false;
    readBackupKeyState().then(state => {
      if (!cancelled) applyState(state);
    });
    return () => { cancelled = true; };
  }, []);

  /**
   * Start working out the params for a new key in `next` mode: the on-device
   * benchmark within the mode's ceilings, or the given manual params.
   */
  const prepareKey = (next: KdfProfile, manual: KdfParams | null) => {
    if (next === 'manual' && !manual) next = DEFAULT_KDF_PROFILE;
    targetProfile.current = next;
    if (next === 'manual') {
      calibration.current = Promise.resolve(manual);
      return;
    }
    const ceilings = ceilingsForProfile(next, deviceTotalMemory());
    calibration.current = calibrateKdfParams(KDF_TARGET_MS, undefined, ceilings)
      .then(c => c.params)
      .catch(error => {
        console.warn('Backup KDF calibration failed, retrying on submit:', error);
        return null;
      });
  };

  /** The stored key's params without its salt (to keep "Manual" params on a password change). */
  const storedParams = (): KdfParams | null =>
    kdf
      ? { name: kdf.name, memoryKiB: kdf.memoryKiB, iterations: kdf.iterations, parallelism: kdf.parallelism }
      : null;

  const openDialog = (mode: BackupPasswordDialogMode) => {
    if (mode === 'set') prepareKey(DEFAULT_KDF_PROFILE, null);
    // A new password keeps the mode (and Manual params) of the key it replaces.
    if (mode === 'change' || mode === 'reset') prepareKey(profile, storedParams());
    setBusy(false);
    setDialog({ mode, error: '' });
  };

  /**
   * "Technical details" > Save: switch the strength mode. The key must be
   * derived again with the new params, which needs the password.
   */
  const openStrengthChange = (next: KdfProfile, manual: KdfParams | null) => {
    if (!ensureCanDerive()) return;
    prepareKey(next, manual);
    setBusy(false);
    setDialog({ mode: 'strength', error: '' });
  };

  const showError = (error: string) => setDialog(current => (current ? { ...current, error } : current));

  const settleUnlock = (password: string | null) => {
    const resolve = unlockResolver.current;
    unlockResolver.current = null;
    resolve?.(password);
  };

  const settleConfirm = (proceed: boolean) => {
    const resolve = confirmResolver.current;
    confirmResolver.current = null;
    resolve?.(proceed);
  };

  /** A real build without native Argon2 refuses up front, with a clear message. */
  const ensureCanDerive = (): boolean => {
    if (canDeriveBackupKeys()) return true;
    Alert.alert("Can't turn on encryption", new Argon2UnavailableError().message);
    return false;
  };

  const showUnreadable = (message: string) => {
    Alert.alert("Can't read backup password", message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Enter password', onPress: () => { if (ensureCanDerive()) openDialog('reset'); } },
    ]);
  };

  const turnOff = async () => {
    try {
      await clearBackupPassword();
      await refresh();
      setDialog(null);
    } catch (error) {
      console.error('Error turning off backup encryption:', error);
      Alert.alert('Error', 'Could not turn off backup encryption.');
    }
  };

  const confirmForgotOff = () => {
    Alert.alert(
      'Forgot your backup password?',
      "Backups made with it can't be opened without it. Encryption will be turned off.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Turn off', style: 'destructive', onPress: turnOff },
      ]
    );
  };

  const handleForgot = () => {
    if (dialog?.mode === 'off') {
      confirmForgotOff();
      return;
    }
    const fromConfirm = dialog?.mode === 'confirm';
    Alert.alert(
      'Forgot your backup password?',
      "Backups made with your current password can't be opened without it. You can set a new password for new backups.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Set new password',
          onPress: () => {
            // The backup that asked for the confirmation does not go ahead
            // with the old password; the new password offers one at the end.
            if (fromConfirm) settleConfirm(false);
            openDialog('reset');
          },
        },
      ]
    );
  };

  const handleToggle = (next: boolean) => {
    if (next) {
      if (ensureCanDerive()) openDialog('set');
    } else if (status === 'unreadable') {
      // Nothing to check the password against: same as "I forgot it".
      confirmForgotOff();
    } else {
      openDialog('off');
    }
  };

  /** Run a check that derives a key (slow): busy while it runs. */
  const checkCurrent = async (password: string): Promise<boolean | null> => {
    try {
      return await verifyBackupPassword(password);
    } catch (error) {
      console.error('Error checking backup password:', error);
      showError(CHECK_FAILED);
      return null;
    }
  };

  const saveNewPassword = async (mode: 'set' | 'change' | 'reset' | 'strength', password: string) => {
    // Derives the key with the params the background benchmark picked
    // (~0.5 s on this phone by construction), or the Manual params.
    const params = (await calibration.current) ?? undefined;
    await setBackupPassword(password, params, targetProfile.current);
    await refresh();
    setDialog(null);
    if (mode === 'strength') {
      Alert.alert(
        'Encryption settings saved',
        'New backups use the new settings. Backups you already made keep theirs and still open with your password.',
        [
          { text: 'Later', style: 'cancel' },
          { text: 'Back up now', onPress: onBackupNow },
        ]
      );
      return;
    }
    if (mode === 'set') {
      Alert.alert(
        'Backups are encrypted',
        'New backups are locked with your password. Keep it somewhere safe: it cannot be shown again or recovered.'
      );
      return;
    }
    Alert.alert(
      mode === 'change' ? 'Password changed' : 'Password saved',
      'Make a new backup now? Backups made before still need the old password.',
      [
        { text: 'Later', style: 'cancel' },
        { text: 'Back up now', onPress: onBackupNow },
      ]
    );
  };

  const handleSubmit = async ({ current, password, confirmation }: BackupPasswordInput) => {
    if (!dialog) return;
    const { mode } = dialog;

    if (mode === 'unlock') {
      // Key derivation + decryption run inside importDatabaseData; the dialog
      // stays up (busy) until it either asks again or the import finishes.
      setBusy(true);
      settleUnlock(current);
      return;
    }

    if (mode === 'set' || mode === 'change' || mode === 'reset') {
      const problem = validateNewBackupPassword(password, confirmation);
      if (problem) {
        showError(problem);
        return;
      }
    }

    setBusy(true);
    try {
      if (mode === 'confirm' || mode === 'off' || mode === 'change' || mode === 'strength') {
        const ok = await checkCurrent(current);
        if (ok === null) return;
        if (!ok) {
          showError(WRONG_PASSWORD);
          return;
        }
      }
      if (mode === 'confirm') {
        await markPasswordConfirmed();
        setDialog(null);
        settleConfirm(true);
      } else if (mode === 'off') {
        await turnOff();
      } else if (mode === 'strength') {
        // Same password, new params: the current one is what gets re-derived.
        await saveNewPassword(mode, current);
      } else {
        await saveNewPassword(mode, password);
      }
    } catch (error) {
      console.error('Error saving backup password:', error);
      showError('Could not save the password. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleClose = () => {
    if (dialog?.mode === 'unlock') settleUnlock(null);
    if (dialog?.mode === 'confirm') settleConfirm(false);
    setDialog(null);
  };

  const handleSkip = () => {
    setDialog(null);
    settleConfirm(true);
  };

  /**
   * Call before making a backup. Resolves false when the backup must not go
   * ahead: the stored key is unreadable, or the confirm prompt was closed.
   */
  const beforeExport = async (): Promise<boolean> => {
    const state = await refresh();
    if (state.status === 'unreadable') {
      showUnreadable(state.message);
      return false;
    }
    if (state.status !== 'on') return true;
    if (!isPasswordConfirmationDue(await getPasswordConfirmedAt(), now().getTime())) return true;
    return new Promise(resolve => {
      confirmResolver.current = resolve;
      openDialog('confirm');
    });
  };

  /** Export failed because the key became unreadable mid-way: handle it here. */
  const handleExportFailure = (result: DatabaseResult): boolean => {
    if (result.code !== BACKUP_KEY_UNREADABLE) return false;
    refresh();
    showUnreadable(result.message);
    return true;
  };

  /** importDatabaseData's prompt: open the unlock dialog and wait for the answer. */
  const requestPassword: RequestBackupPassword = ({ wrongPassword }) =>
    new Promise(resolve => {
      unlockResolver.current = resolve;
      setBusy(false);
      setDialog({
        mode: 'unlock',
        error: wrongPassword ? 'Wrong password, or the backup file is damaged.' : '',
      });
    });

  const onPasswordAccepted = (accepted: AcceptedBackupPassword) => {
    acceptedPassword.current = accepted;
  };

  /** Close the unlock dialog once a restore is over (it stays up while importing). */
  const finishImport = () => {
    unlockResolver.current = null;
    setBusy(false);
    setDialog(current => (current?.mode === 'unlock' ? null : current));
  };

  /**
   * After a successful restore: the typed password to offer for new backups,
   * or null when there is nothing to offer (opened with this phone's key, or
   * encryption is already on).
   */
  const takeKeepPasswordOffer = async (): Promise<AcceptedBackupPassword | null> => {
    const accepted = acceptedPassword.current;
    acceptedPassword.current = null;
    if (accepted === null || !canDeriveBackupKeys()) return null;
    const state = await readBackupKeyState();
    return state.status === 'on' ? null : accepted;
  };

  const keepPassword = async ({ password, kdf }: AcceptedBackupPassword) => {
    try {
      // The backup's params under a fresh salt.
      await setBackupPassword(password, kdf, profileForAdoptedParams(kdf));
      await refresh();
    } catch (error) {
      console.error('Error keeping backup password:', error);
      Alert.alert('Error', 'Could not turn on backup encryption. You can turn it on in Data Management.');
    }
  };

  /** Clear the per-restore password if a restore ended without success. */
  const discardAcceptedPassword = () => {
    acceptedPassword.current = null;
  };

  const forgotAvailable = dialog?.mode === 'change' || dialog?.mode === 'off' || dialog?.mode === 'confirm';

  return {
    status,
    kdf,
    profile,
    openStrengthChange,
    handleToggle,
    openChange: () => openDialog('change'),
    openReenter: () => { if (ensureCanDerive()) openDialog('reset'); },
    beforeExport,
    handleExportFailure,
    requestPassword,
    onPasswordAccepted,
    finishImport,
    takeKeepPasswordOffer,
    keepPassword,
    discardAcceptedPassword,
    dialogProps: {
      visible: dialog !== null,
      mode: dialog?.mode ?? ('set' as BackupPasswordDialogMode),
      busy,
      error: dialog?.error ?? '',
      onSubmit: handleSubmit,
      onClose: handleClose,
      onForgot: forgotAvailable ? handleForgot : undefined,
      onSkip: dialog?.mode === 'confirm' ? handleSkip : undefined,
    },
  };
}
