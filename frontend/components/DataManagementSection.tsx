// DataManagementSection.tsx
import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, ActivityIndicator, Switch } from 'react-native';
import { useThemeColors } from '@/styles/global';
import { useSQLiteContext } from 'expo-sqlite';
import { useDataContext } from '@/context/DataContext';
import Feather from '@expo/vector-icons/Feather';
import {
  exportDatabaseData,
  importDatabaseData,
  SUPPORTED_RESTORE_SOURCES,
} from '@/databases/data-export';
import { describeDaylioImport } from '@/databases/daylio-import';
import { useBackupEncryption } from '@/hooks/useBackupEncryption';
import { BackupPasswordDialog } from './BackupPasswordDialog';
import { BackupStrengthDialog } from './BackupStrengthDialog';

export { describeKdf } from './BackupStrengthDialog';

const ENCRYPTION_HINT = {
  on: 'Backups are locked with your password. It cannot be shown or recovered, only changed.',
  off: 'Lock backups with a password so nobody else can open them.',
  unreadable: "Your backup password couldn't be read. Enter it again to keep encrypting backups.",
} as const;

export const DataManagementSection = () => {
  const colors = useThemeColors();
  const db = useSQLiteContext();
  const { refetchEntries } = useDataContext();
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const busy = isExporting || isImporting;
  // Declared before the hook so "Back up now" (after a password change) can call it.
  const exportRef = React.useRef<() => void>(() => {});
  const encryption = useBackupEncryption({ onBackupNow: () => exportRef.current() });
  const encryptionKdf = encryption.kdf;
  // "Technical details": the strength and its mode, kept out of the hint on
  // purpose (most users only need to know their backups are locked).
  const [detailsOpen, setDetailsOpen] = useState(false);

  const handleExport = async () => {
    try {
      setIsExporting(true);
      // Unreadable key or a pending "Confirm your backup password": the hook
      // shows what is needed and says whether to go ahead.
      if (!(await encryption.beforeExport())) return;
      const result = await exportDatabaseData(db);

      if (result.success) {
        Alert.alert('Backup ready', 'Choose where to save it — Google Drive, your device, or send it anywhere.');
      } else if (!encryption.handleExportFailure(result)) {
        Alert.alert('Backup Failed', result.message);
      }
    } catch (error) {
      console.error('Error during export:', error);
      Alert.alert('Backup Error', 'An unexpected error occurred while creating your backup');
    } finally {
      setIsExporting(false);
    }
  };
  exportRef.current = handleExport;

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
        requestPassword: encryption.requestPassword,
        onPasswordAccepted: encryption.onPasswordAccepted,
        confirmRestore: () =>
          confirmAlert(
            'Import Data',
            'This will replace your current data with the imported data. Are you sure you want to continue?',
            'Continue',
            true
          ),
        confirmDaylio: summary => confirmAlert('Import from Daylio', describeDaylioImport(summary), 'Import'),
        confirmStrongKdf: () =>
          confirmAlert(
            'Strong encryption settings',
            "This backup was made with stronger encryption settings than usual. If they are too much for this phone, the app may freeze or crash while opening it. Only open backups you made yourself.",
            'Open'
          ),
      });

      if (result.success) {
        refetchEntries(); // Refresh the app's data
        // Restored with a typed password on a phone without encryption:
        // offer to keep encrypting new backups with it.
        const keepPassword = await encryption.takeKeepPasswordOffer();
        if (keepPassword !== null) {
          Alert.alert('Data restored', `${result.message}\n\nKeep encrypting new backups with this password?`, [
            { text: 'No', style: 'cancel' },
            { text: 'Yes', onPress: () => encryption.keepPassword(keepPassword) },
          ]);
        } else {
          Alert.alert('Success', result.message);
        }
      } else if (result.message !== 'Import cancelled') {
        Alert.alert('Import Failed', result.message);
      }
    } catch (error) {
      console.error('Error during import:', error);
      Alert.alert('Import Error', 'An unexpected error occurred during import');
    } finally {
      setIsImporting(false);
      encryption.discardAcceptedPassword();
      // The unlock dialog (if one was needed) stays up while the
      // backup decrypts and imports; close it once that is over.
      encryption.finishImport();
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
              {ENCRYPTION_HINT[encryption.status === 'loading' ? 'off' : encryption.status]}
            </Text>
          </View>
          <Switch
            value={encryption.status === 'on' || encryption.status === 'unreadable'}
            onValueChange={encryption.handleToggle}
            disabled={encryption.status === 'loading' || busy}
            trackColor={{ false: '#767577', true: colors.accent }}
            thumbColor="#f4f3f4"
            accessibilityLabel="Encrypt backups"
          />
        </View>
        {encryption.status === 'unreadable' ? (
          <View style={styles.encryptionLinks}>
            <Pressable
              style={styles.linkButton}
              onPress={encryption.openReenter}
              disabled={isExporting || isImporting}
              accessibilityRole="button"
              accessibilityLabel="Enter backup password"
            >
              <Feather name="key" color={colors.accent} size={14} />
              <Text style={styles.linkText}>Enter password</Text>
            </Pressable>
          </View>
        ) : null}
        {encryptionKdf ? (
          <View style={styles.encryptionLinks}>
            <Pressable
              style={styles.linkButton}
              onPress={encryption.openChange}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Change backup password"
            >
              <Feather name="key" color={colors.accent} size={14} />
              <Text style={styles.linkText}>Change password</Text>
            </Pressable>
            <Pressable
              style={styles.linkButton}
              onPress={() => setDetailsOpen(true)}
              disabled={busy}
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
          // Not awaited: the backup may wait on "Confirm your backup password".
          onPress={() => { void handleExport(); }}
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

      {encryptionKdf ? (
        <BackupStrengthDialog
          visible={detailsOpen}
          kdf={encryptionKdf}
          profile={encryption.profile}
          onClose={() => setDetailsOpen(false)}
          onSave={(profile, params) => {
            setDetailsOpen(false);
            encryption.openStrengthChange(profile, params);
          }}
        />
      ) : null}
      <BackupPasswordDialog {...encryption.dialogProps} />
    </View>
  );
};