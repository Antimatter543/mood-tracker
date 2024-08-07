import React, { useState } from 'react';
import { View, Text, Switch, StyleSheet, TouchableOpacity, Modal, FlatList } from 'react-native';
import { useThemeColors } from '@/styles/global';
import { SettingConfig, SETTINGS_REGISTRY } from '@/databases/settings';
import { useSettings } from '@/context/SettingsContext';
import { Ionicons } from '@expo/vector-icons';

type SettingRowProps = {
  config: SettingConfig;
  value: any;
  onValueChange: (value: any) => void;
};

function SettingRow({ config, value, onValueChange }: SettingRowProps) {
  const colors = useThemeColors();
  const [modalVisible, setModalVisible] = useState(false);
  
  const styles = StyleSheet.create({
    row: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 12,
      paddingHorizontal: 16,
      backgroundColor: colors.overlays.tag,
      borderRadius: 8,
      marginBottom: 8,
    },
    textContainer: {
      flex: 1,
      marginRight: 12,
    },
    label: {
      color: colors.text,
      fontSize: 16,
    },
    description: {
      color: colors.textSecondary,
      fontSize: 12,
      marginTop: 2,
    },
    selectButton: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.secondaryBackground,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: colors.border,
    },
    selectText: {
      color: colors.text,
      fontSize: 14,
      marginRight: 6,
    },
    modalContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
    },
    modalContent: {
      width: '80%',
      backgroundColor: colors.cardBackground,
      borderRadius: 12,
      padding: 16,
      maxHeight: '70%',
    },
    modalTitle: {
      fontSize: 18,
      fontWeight: 'bold',
      color: colors.text,
      marginBottom: 16,
      textAlign: 'center',
    },
    optionItem: {
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    optionText: {
      fontSize: 16,
      color: colors.text,
    },
    selectedOption: {
      backgroundColor: colors.overlays.tag,
    },
    closeButton: {
      marginTop: 16,
      alignItems: 'center',
      paddingVertical: 10,
      backgroundColor: colors.accent,
      borderRadius: 8,
    },
    closeButtonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '600',
    },
  });

  const handleChange = (newValue: any) => {
    if (config.valueLabels) {
      onValueChange(config.valueLabels[String(newValue)]);
    } else {
      onValueChange(newValue);
    }
  };

  // Convert value to boolean for switch if using valueLabels
  const switchValue = config.valueLabels 
    ? Object.entries(config.valueLabels).find(([_, v]) => v === value)?.[0] === 'true'
    : value;

  // Get the selected option label for select type
  const getSelectedOptionLabel = () => {
    if (config.options) {
      const selectedOption = config.options.find(option => option.value === value);
      return selectedOption ? selectedOption.label : 'Select an option';
    }
    return 'Select an option';
  };

  return (
    <View style={styles.row}>
      <View style={styles.textContainer}>
        <Text style={styles.label}>{config.label}</Text>
        {config.description && (
          <Text style={styles.description}>{config.description}</Text>
        )}
      </View>
      
      {config.type === 'switch' && (
        <Switch
          value={switchValue}
          onValueChange={handleChange}
          trackColor={{ false: '#767577', true: colors.accent }}
          thumbColor="#f4f3f4"
        />
      )}
      
      {config.type === 'select' && (
        <>
          <TouchableOpacity 
            style={styles.selectButton}
            onPress={() => setModalVisible(true)}
          >
            <Text style={styles.selectText}>{getSelectedOptionLabel()}</Text>
            <Ionicons name="chevron-down" size={16} color={colors.text} />
          </TouchableOpacity>
          
          <Modal
            animationType="fade"
            transparent={true}
            visible={modalVisible}
            onRequestClose={() => setModalVisible(false)}
          >
            <View style={styles.modalContainer}>
              <View style={styles.modalContent}>
                <Text style={styles.modalTitle}>{config.label}</Text>
                
                <FlatList
                  data={config.options || []}
                  keyExtractor={(item) => item.value}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={[
                        styles.optionItem,
                        item.value === value && styles.selectedOption
                      ]}
                      onPress={() => {
                        onValueChange(item.value);
                        setModalVisible(false);
                      }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        {config.key === 'theme' && (
                          <ThemeColorPreview themeName={item.value} />
                        )}
                        <Text style={styles.optionText}>{item.label}</Text>
                      </View>
                    </TouchableOpacity>
                  )}
                />
                
                <TouchableOpacity
                  style={styles.closeButton}
                  onPress={() => setModalVisible(false)}
                >
                  <Text style={styles.closeButtonText}>Close</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>
        </>
      )}
    </View>
  );
}

function ThemeColorPreview({ themeName }: { themeName: string }) {
  const colors = useThemeColors();
  
  // Define theme preview colors
  const getPreviewColors = () => {
    if (themeName === 'cherry') {
      return {
        bg: '#FFF0F5',
        accent: '#DB7093',
        text: '#4A2932'
      };
    } else if (themeName === 'dark') {
      return {
        bg: '#121212',
        accent: '#4CAF50',
        text: '#FFFFFF'
      };
    } else if (themeName === 'light') {
      return {
        bg: '#F5F5F5',
        accent: '#4CAF50',
        text: '#000000'
      };
    } else if (themeName === 'midnight') {
      return {
        bg: '#0F1C2E',
        accent: '#6495ED',
        text: '#E0E7FF'
      };
    } else if (themeName === 'forest') {
      return {
        bg: '#E8F5E9',
        accent: '#43A047',
        text: '#1B5E20'
      };
    }
    
    // Default/system theme - show current theme colors
    return {
      bg: colors.background,
      accent: colors.accent,
      text: colors.text
    };
  };
  
  const previewColors = getPreviewColors();
  
  const styles = StyleSheet.create({
    container: {
      flexDirection: 'row',
      marginRight: 8,
    },
    colorDot: {
      width: 12,
      height: 12,
      borderRadius: 6,
      marginRight: 4,
    },
    bgDot: {
      backgroundColor: previewColors.bg,
      borderWidth: 1,
      borderColor: 'rgba(0,0,0,0.1)',
    },
    accentDot: {
      backgroundColor: previewColors.accent,
    },
    textDot: {
      backgroundColor: previewColors.text,
    },
  });
  
  return (
    <View style={styles.container}>
      <View style={[styles.colorDot, styles.bgDot]} />
      <View style={[styles.colorDot, styles.accentDot]} />
      <View style={[styles.colorDot, styles.textDot]} />
    </View>
  );
}

export function SettingsSection() {
    const colors = useThemeColors();
    const { settings, updateSetting } = useSettings();
    
    const styles = StyleSheet.create({
      section: {
        backgroundColor: colors.cardBackground,
        borderRadius: 16,
        padding: 16,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: colors.border,
      },
      header: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 16,
      },
      title: {
        fontSize: 18,
        fontWeight: '600',
        color: colors.text,
        marginLeft: 8,
      },
      note: {
        fontSize: 12,
        color: colors.textSecondary,
        fontStyle: 'italic',
        marginTop: 8,
        marginBottom: 8,
        paddingHorizontal: 8,
      },
    });
    
    // Hide theme_mode toggle if a specific theme is selected
    const shouldShowThemeMode = !settings.theme;
  
    return (
      <View style={styles.section}>
        <View style={styles.header}>
          <Ionicons name="color-palette-outline" size={20} color={colors.text} />
          <Text style={styles.title}>Appearance & Behavior</Text>
        </View>
        
        {Object.entries(SETTINGS_REGISTRY).map(([key, config]) => {
          // Skip theme_mode if a theme is selected
          if (key === 'theme_mode' && !shouldShowThemeMode) {
            return null;
          }
          
          // Type assertion to fix TypeScript errors
          const typedKey = key as keyof typeof SETTINGS_REGISTRY;
          const typedConfig = config as SettingConfig;
          
          return (
            <SettingRow
              key={typedKey}
              config={typedConfig}
              value={settings[typedKey]}
              onValueChange={(value) => {
                // If changing theme, reset theme_mode to avoid confusion
                if (typedKey === 'theme' && value) {
                  updateSetting('theme_mode', value === 'dark' ? 'dark' : 'light');
                }
                
                updateSetting(typedKey, value);
              }}
            />
          );
        })}
        
        {!shouldShowThemeMode && (
          <Text style={styles.note}>
            Note: The Dark Theme toggle is hidden because you've selected a specific theme.
          </Text>
        )}
      </View>
    );
  }