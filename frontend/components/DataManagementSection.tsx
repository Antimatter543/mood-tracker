// DataManagementSection.tsx
import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, ActivityIndicator, Platform } from 'react-native';
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

  const handleExport = async (method: 'share' | 'save') => {
    try {
      setIsExporting(true);
      const result = await exportDatabaseData(db, method);
      
      if (result.success) {
        if (method === 'save') {
          Alert.alert('Success', `Your data has been exported successfully. ${result.message}`);
        } else {
          Alert.alert('Success', 'Your data has been exported successfully');
        }
      } else {
        Alert.alert('Export Failed', result.message);
      }
    } catch (error) {
      console.error('Error during export:', error);
      Alert.alert('Export Error', 'An unexpected error occurred during export');
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
    button: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accent,
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: 8,
      gap: 8,
      flex: 1,
      minWidth: 140,
    },
    importButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.overlays.tag,
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: 8,
      marginTop: 12,
      gap: 8,
      borderWidth: 1,
      borderColor: colors.overlays.tagBorder,
    },
    buttonContainer: {
      flexDirection: 'column',
      gap: 12,
    },
    exportOptions: {
      marginBottom: 8,
    },
    optionsLabel: {
      color: colors.textSecondary,
      fontSize: 14,
      marginBottom: 8,
    },
    exportButtonRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 12,
      flexWrap: 'wrap',
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
        Export your mood tracking data as a JSON file to keep a backup or analyze it in other applications. You can also import previously exported data.
      </Text>

      <View style={styles.buttonContainer}>
        {/* Export options */}
        <View style={styles.exportOptions}>
          <Text style={styles.optionsLabel}>Export Options:</Text>
          <View style={styles.exportButtonRow}>
            <Pressable
              style={({ pressed }) => [
                styles.button,
                pressed && styles.buttonPressed
              ]}
              onPress={() => handleExport('share')}
              disabled={isExporting || isImporting}
            >
              <Feather name="share" color="#fff" size={18} />
              {isExporting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Share File</Text>
              )}
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.button,
                {backgroundColor: colors.accentDark},
                pressed && styles.buttonPressed
              ]}
              onPress={() => handleExport('save')}
              disabled={isExporting || isImporting}
            >
              <Feather name="download" color="#fff" size={18} />
              {isExporting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.buttonText}>
                  {Platform.OS === 'ios' ? 'Save to Files' : 'Download'}
                </Text>
              )}
            </Pressable>
          </View>
        </View>

        {/* Import button */}
        <Pressable
          style={({ pressed }) => [
            styles.importButton,
            pressed && styles.buttonPressed
          ]}
          onPress={handleImport}
          disabled={isExporting || isImporting}
        >
          <Feather name="upload" color={colors.text} size={18} />
          {isImporting ? (
            <ActivityIndicator size="small" color={colors.text} />
          ) : (
            <Text style={styles.importButtonText}>Import Data</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
};