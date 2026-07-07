// DataManagementSection.tsx
import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, ActivityIndicator } from 'react-native';
import { useThemeColors } from '@/styles/global';
import { useSQLiteContext } from 'expo-sqlite';
import { useDataContext } from '@/context/DataContext';
import Feather from '@expo/vector-icons/Feather';
import { exportDatabaseData, importDatabaseData } from '@/databases/data-export';

export const DataManagementSection = () => {
  const colors = useThemeColors();
  const db = useSQLiteContext();
  const { refetchEntries } = useDataContext();
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

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
              const result = await importDatabaseData(db);
              
              if (result.success) {
                Alert.alert('Success', 'Your data has been imported successfully');
                refetchEntries(); // Refresh the app's data
              } else {
                Alert.alert('Import Failed', result.message);
              }
            } catch (error) {
              console.error('Error during import:', error);
              Alert.alert('Import Error', 'An unexpected error occurred during import');
            } finally {
              setIsImporting(false);
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

      <View style={styles.buttonContainer}>
        {/* Back up — hands the file to the OS share sheet (Drive / Files / send) */}
        <Pressable
          style={({ pressed }) => [
            styles.button,
            pressed && styles.buttonPressed
          ]}
          onPress={handleExport}
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
    </View>
  );
};