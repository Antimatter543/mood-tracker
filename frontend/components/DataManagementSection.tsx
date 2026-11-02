// DataManagementSection.tsx
import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, ActivityIndicator, Switch } from 'react-native';
import { useThemeColors } from '@/styles/global';
import { useSQLiteContext } from 'expo-sqlite';
import { useDataContext } from '@/context/DataContext';
import Feather from '@expo/vector-icons/Feather';
import { exportDatabaseData, importDatabaseData } from '@/databases/data-export';
import { KdfHeader } from '@/lib/backupCrypto';
import { useBackupEncryption } from '@/hooks/useBackupEncryption';
import { BackupPasswordDialog } from './BackupPasswordDialog';

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
  // Declared before the hook so "Back up now" (after a password change) can call it.
  const exportRef = React.useRef<() => void>(() => {});
  const encryption = useBackupEncryption({ onBackupNow: () => exportRef.current() });
  const encryptionKdf = encryption.kdf;

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

  const handleImport = async () => {
    // Show confirmation dialog first
    Alert.alert(
      'Import Data',
      'This will replace your current data with the imported data. Are you sure you want to continue?',
      [
        {
          text: 'Cancel',
          style: 'cancel'
        },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: async () => {
            try {
              setIsImporting(true);
              const result = await importDatabaseData(db, {
                requestPassword: encryption.requestPassword,
                onPasswordAccepted: encryption.onPasswordAccepted,
              });

              if (result.success) {
                refetchEntries(); // Refresh the app's data
                const keepPassword = await encryption.takeKeepPasswordOffer();
                if (keepPassword !== null) {
                  Alert.alert('Data restored', 'Keep encrypting new backups with this password?', [
                    { text: 'No', style: 'cancel' },
                    { text: 'Yes', onPress: () => encryption.keepPassword(keepPassword) },
                  ]);
                } else {
                  Alert.alert('Success', 'Your data has been imported successfully');
                }
              } else {
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
          }
        }
      ]
    );
  };

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
            disabled={encryption.status === 'loading' || isExporting || isImporting}
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
              disabled={isExporting || isImporting}
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
          // Not awaited: the backup may wait on "Confirm your backup password".
          onPress={() => { void handleExport(); }}
          disabled={isExporting || isImporting}
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
          onPress={handleImport}
          disabled={isExporting || isImporting}
        >
          <Feather name="rotate-ccw" color={colors.text} size={18} />
          {isImporting ? (
            <ActivityIndicator size="small" color={colors.text} />
          ) : (
            <Text style={styles.importButtonText}>Restore</Text>
          )}
        </Pressable>
      </View>

      <BackupPasswordDialog {...encryption.dialogProps} />
    </View>
  );
};