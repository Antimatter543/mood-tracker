// DataManagementSection.tsx
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, ActivityIndicator, Switch } from 'react-native';
import { useThemeColors } from '@/styles/global';
import { useSQLiteContext } from 'expo-sqlite';
import { useDataContext } from '@/context/DataContext';
import Feather from '@expo/vector-icons/Feather';
import {
  exportDatabaseData,
  importDatabaseData,
  RequestBackupPassword,
  SUPPORTED_RESTORE_SOURCES,
} from '@/databases/data-export';
import { describeDaylioImport } from '@/databases/daylio-import';
import { KdfHeader, KdfParams, validateNewBackupPassword } from '@/lib/backupCrypto';
import { calibrateKdfParams } from '@/lib/backupKdfCalibration';
import {
  clearBackupPassword,
  getBackupKey,
  setBackupPassword,
} from '@/lib/backupKeyStore';
import { BackupPasswordDialog, BackupPasswordDialogMode } from './BackupPasswordDialog';

/** "Argon2id, 48 MiB × 2 passes, 4 lanes": the calibrated strength. */
export function describeKdf(kdf: KdfHeader): string {
  const mib = Math.round(kdf.memoryKiB / 1024);
  return `Argon2id, ${mib} MiB × ${kdf.iterations} ${kdf.iterations === 1 ? 'pass' : 'passes'}, ${kdf.parallelism} ${kdf.parallelism === 1 ? 'lane' : 'lanes'}`;
}

/**
 * The "Technical details" text. Kept out of the hint on purpose: most users
 * only need to know their backups are locked; the parameters are for those
 * who want to check them.
 */
export function backupTechnicalDetails(kdf: KdfHeader): string {
  return [
    `Password hashing: ${describeKdf(kdf)}. Tuned to this phone so that unlocking takes about half a second.`,
    'Encryption: AES-256-GCM.',
    'Only a key derived from your password is stored, in this phone\'s secure storage. The password itself is never stored.',
  ].join('\n\n');
}

type PasswordDialogState = { mode: BackupPasswordDialogMode; error: string } | null;

export const DataManagementSection = () => {
  const colors = useThemeColors();
  const db = useSQLiteContext();
  const { refetchEntries } = useDataContext();
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const busy = isExporting || isImporting;
  // Backup encryption is ON exactly when a key is in secure storage. Mirrors
  // that key's KDF header (its calibrated strength, shown in the hint):
  // `undefined` until the store has been read, `null` when encryption is off.
  const [encryptionKdf, setEncryptionKdf] = useState<KdfHeader | null | undefined>(undefined);
  const encryptionEnabled = encryptionKdf === undefined ? null : encryptionKdf !== null;
  const [passwordDialog, setPasswordDialog] = useState<PasswordDialogState>(null);
  const [passwordBusy, setPasswordBusy] = useState(false);
  // While a restore waits for a password, the pending answer for importDatabaseData.
  const unlockResolver = useRef<((password: string | null) => void) | null>(null);
  // The on-device Argon2id benchmark, started the moment the set/change dialog
  // opens so it has finished (native: tens of ms) before the password is typed.
  // `null` result = it failed; setBackupPassword then calibrates itself.
  const calibration = useRef<Promise<KdfParams | null> | null>(null);

  const openNewPasswordDialog = (mode: 'set' | 'change') => {
    calibration.current = calibrateKdfParams()
      .then(c => c.params)
      .catch(error => {
        console.warn('Backup KDF calibration failed, retrying on submit:', error);
        return null;
      });
    setPasswordDialog({ mode, error: '' });
  };

  useEffect(() => {
    let cancelled = false;
    getBackupKey()
      .then(key => { if (!cancelled) setEncryptionKdf(key?.kdf ?? null); })
      .catch(error => {
        console.error('Error reading backup encryption state:', error);
        if (!cancelled) setEncryptionKdf(null);
      });
    return () => { cancelled = true; };
  }, []);

  const handleEncryptionToggle = (next: boolean) => {
    if (next) {
      openNewPasswordDialog('set');
      return;
    }
    Alert.alert(
      'Stop encrypting backups?',
      'New backups will be saved without a password. Backups you already made stay encrypted and still need their password to restore.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Turn off',
          style: 'destructive',
          onPress: async () => {
            try {
              await clearBackupPassword();
              setEncryptionKdf(null);
            } catch (error) {
              console.error('Error turning off backup encryption:', error);
              Alert.alert('Error', 'Could not turn off backup encryption.');
            }
          }
        }
      ]
    );
  };

  /** importDatabaseData's prompt: open the unlock dialog and wait for the answer. */
  const requestPassword: RequestBackupPassword = ({ wrongPassword }) =>
    new Promise(resolve => {
      unlockResolver.current = resolve;
      setPasswordBusy(false);
      setPasswordDialog({
        mode: 'unlock',
        error: wrongPassword ? 'Wrong password, or the backup file is damaged.' : '',
      });
    });

  const settleUnlock = (password: string | null) => {
    const resolve = unlockResolver.current;
    unlockResolver.current = null;
    resolve?.(password);
  };

  const handlePasswordSubmit = async (password: string, confirmation: string) => {
    if (!passwordDialog) return;

    if (passwordDialog.mode === 'unlock') {
      // Key derivation + decryption run inside importDatabaseData; the dialog
      // stays up (busy) until it either asks again or the import finishes.
      setPasswordBusy(true);
      settleUnlock(password);
      return;
    }

    const problem = validateNewBackupPassword(password, confirmation);
    if (problem) {
      setPasswordDialog({ ...passwordDialog, error: problem });
      return;
    }
    const wasChange = passwordDialog.mode === 'change';
    setPasswordBusy(true);
    try {
      // Derives the key with the params the background benchmark picked
      // (~0.5 s on this phone by construction).
      const params = (await calibration.current) ?? undefined;
      await setBackupPassword(password, params);
      setEncryptionKdf((await getBackupKey())?.kdf ?? null);
      setPasswordDialog(null);
      Alert.alert(
        wasChange ? 'Password changed' : 'Backups are encrypted',
        'New backups are locked with your password. Keep it somewhere safe: it cannot be shown again or recovered.'
      );
    } catch (error) {
      console.error('Error setting backup password:', error);
      setPasswordDialog({ ...passwordDialog, error: 'Could not save the password. Please try again.' });
    } finally {
      setPasswordBusy(false);
    }
  };

  const handlePasswordDialogClose = () => {
    if (passwordDialog?.mode === 'unlock') settleUnlock(null);
    setPasswordDialog(null);
  };

  const handleExport = async () => {
    try {
      setIsExporting(true);
      const result = await exportDatabaseData(db);

      if (result.success) {
        Alert.alert('Backup ready', 'Choose where to save it — Google Drive, your device, or send it anywhere.');
      } else {
        Alert.alert('Backup Failed', result.message);
      }
    } catch (error) {
      console.error('Error during export:', error);
      Alert.alert('Backup Error', 'An unexpected error occurred while creating your backup');
    } finally {
      setIsExporting(false);
    }
  };
  
  /** A two-button native confirm as a promise: true = `confirmText` pressed. */
  const confirmAlert = (title: string, message: string, confirmText: string, destructive = false) =>
    new Promise<boolean>(resolve =>
      Alert.alert(
        title,
        message,
        [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
          { text: confirmText, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
        ],
        { cancelable: true, onDismiss: () => resolve(false) }
      )
    );

  // Restore: pick a file first, then confirm what it turned out to be. A
  // SoulSync backup replaces data; another app's backup (Daylio) is ADDED,
  // after a preview of what it contains.
  const handleImport = async () => {
    try {
      setIsImporting(true);
      const result = await importDatabaseData(db, {
        requestPassword,
        confirmRestore: () =>
          confirmAlert(
            'Import Data',
            'This will replace your current data with the imported data. Are you sure you want to continue?',
            'Continue',
            true
          ),
        confirmDaylio: summary => confirmAlert('Import from Daylio', describeDaylioImport(summary), 'Import'),
      });

      if (result.success) {
        Alert.alert('Success', result.message);
        refetchEntries(); // Refresh the app's data
      } else if (result.message !== 'Import cancelled') {
        Alert.alert('Import Failed', result.message);
      }
    } catch (error) {
      console.error('Error during import:', error);
      Alert.alert('Import Error', 'An unexpected error occurred during import');
    } finally {
      setIsImporting(false);
      // The unlock dialog (if one was needed) stays up while the
      // backup decrypts and imports; close it once that is over.
      unlockResolver.current = null;
      setPasswordBusy(false);
      setPasswordDialog(null);
    }
  };

  const showSupportedApps = () =>
    Alert.alert(
      'Supported apps',
      SUPPORTED_RESTORE_SOURCES.map(({ app, detail }) => `${app}: ${detail}.`).join('\n\n')
    );

  const styles = StyleSheet.create({
    section: {
      backgroundColor: colors.cardBackground,
      borderRadius: 16,
      padding: 16,
      marginBottom: 16,
      borderWidth: 1,
      borderColor: colors.border,
    },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 16,
    },
    sectionTitle: {
      fontSize: 18,
      fontWeight: '600',
      color: colors.text,
      marginLeft: 8,
    },
    description: {
      color: colors.textSecondary,
      fontSize: 14,
      marginBottom: 16,
      lineHeight: 20,
    },
    emphasis: {
      color: colors.text,
      fontWeight: '600',
    },
    button: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accent,
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: 8,
      gap: 8,
    },
    importButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.overlays.tag,
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: 8,
      gap: 8,
      borderWidth: 1,
      borderColor: colors.overlays.tagBorder,
    },
    buttonContainer: {
      flexDirection: 'column',
      gap: 12,
    },
    buttonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '500',
    },
    importButtonText: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '500',
    },
    buttonPressed: {
      opacity: 0.8,
    },
    encryptionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    encryptionText: {
      flex: 1,
    },
    encryptionTitle: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '500',
    },
    encryptionHint: {
      color: colors.textSecondary,
      fontSize: 13,
      lineHeight: 18,
      marginTop: 2,
    },
    restoreNote: {
      color: colors.textSecondary,
      fontSize: 13,
      lineHeight: 18,
      marginTop: 10,
    },
    restoreNoteLink: {
      color: colors.accent,
      fontWeight: '500',
    },
    encryptionLinks: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      columnGap: 20,
      marginTop: 4,
    },
    encryptionSection: {
      marginBottom: 16,
    },
    linkButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 4,
    },
    linkText: {
      color: colors.accent,
      fontSize: 14,
      fontWeight: '500',
    },
  });

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Feather name="database" color={colors.text} size={20} />
        <Text style={styles.sectionTitle}>Data Management</Text>
      </View>

      <Text style={styles.description}>
        Back up your entries to a file — save it to{' '}
        <Text style={styles.emphasis}>Google Drive</Text>, your device, or send it
        anywhere. Restore from a backup on this or any device. No account, all local.
      </Text>

      {/* Opt-in backup encryption. Off by default; the switch reflects whether a
          key is in secure storage (lib/backupKeyStore.ts). */}
      <View style={styles.encryptionSection}>
        <View style={styles.encryptionRow}>
          <View style={styles.encryptionText}>
            <Text style={styles.encryptionTitle}>Encrypt backups</Text>
            <Text style={styles.encryptionHint}>
              {encryptionKdf
                ? 'Backups are locked with your password. It cannot be shown or recovered, only changed.'
                : 'Lock backups with a password so nobody else can open them.'}
            </Text>
          </View>
          <Switch
            value={encryptionEnabled === true}
            onValueChange={handleEncryptionToggle}
            disabled={encryptionEnabled === null || busy}
            trackColor={{ false: '#767577', true: colors.accent }}
            thumbColor="#f4f3f4"
            accessibilityLabel="Encrypt backups"
          />
        </View>
        {encryptionKdf ? (
          <View style={styles.encryptionLinks}>
            <Pressable
              style={styles.linkButton}
              onPress={() => openNewPasswordDialog('change')}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Change backup password"
            >
              <Feather name="key" color={colors.accent} size={14} />
              <Text style={styles.linkText}>Change password</Text>
            </Pressable>
            <Pressable
              style={styles.linkButton}
              onPress={() => Alert.alert('Technical details', backupTechnicalDetails(encryptionKdf))}
              accessibilityRole="button"
              accessibilityLabel="Backup encryption technical details"
            >
              <Feather name="info" color={colors.accent} size={14} />
              <Text style={styles.linkText}>Technical details</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      <View style={styles.buttonContainer}>
        {/* Back up — hands the file to the OS share sheet (Drive / Files / send) */}
        <Pressable
          style={({ pressed }) => [
            styles.button,
            pressed && styles.buttonPressed
          ]}
          onPress={handleExport}
          disabled={busy}
        >
          <Feather name="upload-cloud" color="#fff" size={18} />
          {isExporting ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Back up</Text>
          )}
        </Pressable>

        {/* Restore — picks a backup file from Drive / Files / anywhere */}
        <Pressable
          style={({ pressed }) => [
            styles.importButton,
            pressed && styles.buttonPressed
          ]}
          // Fire and forget: the import can wait on dialogs (password,
          // confirmations), so the press must not hold on to its promise.
          onPress={() => { void handleImport(); }}
          disabled={busy}
        >
          <Feather name="rotate-ccw" color={colors.text} size={18} />
          {isImporting ? (
            <ActivityIndicator size="small" color={colors.text} />
          ) : (
            <Text style={styles.importButtonText}>Restore</Text>
          )}
        </Pressable>
      </View>

      {/* Restore also understands other apps' backups (SUPPORTED_RESTORE_SOURCES). */}
      <Text style={styles.restoreNote}>
        Restore also accepts backups from other mood apps.{' '}
        <Text
          style={styles.restoreNoteLink}
          onPress={showSupportedApps}
          accessibilityRole="link"
          accessibilityLabel="Supported apps"
        >
          Supported apps
        </Text>
      </Text>

      <BackupPasswordDialog
        visible={passwordDialog !== null}
        mode={passwordDialog?.mode ?? 'set'}
        busy={passwordBusy}
        error={passwordDialog?.error ?? ''}
        onSubmit={handlePasswordSubmit}
        onClose={handlePasswordDialogClose}
      />
    </View>
  );
};