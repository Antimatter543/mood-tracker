import React, { createContext, useContext, useState, useEffect } from 'react';
import { SQLiteDatabase, useSQLiteContext } from 'expo-sqlite';
import { updateSetting as updateDbSetting, getSetting } from '@/databases/database';
import { SETTINGS_REGISTRY, SettingsContextType, Settings, SettingKey } from '@/databases/settings'; // Import Settings from your file
import { ActivityIndicator, View } from 'react-native';


const defaultSettings: Settings = Object.fromEntries(
  Object.entries(SETTINGS_REGISTRY).map(([key, config]) => [
    key,
    config.default
  ])
) as Settings;

const SettingsContext = createContext<SettingsContextType>({
  settings: defaultSettings,
  updateSetting: async () => {},
});
export function SettingsProvider({ children }: { children: React.ReactNode }) {
    const db = useSQLiteContext();
    const [settings, setSettings] = useState<Settings>(defaultSettings);
    const [isLoading, setIsLoading] = useState(true); // Add loading state
  
    useEffect(() => {
      loadSettings(db).then(loadedSettings => {
        setSettings(loadedSettings);
        setIsLoading(false); // Mark loading as complete
      });
    }, [db]);
  
    const updateSetting = async (key: keyof Settings, value: any) => {
      await updateDbSetting(db, key, value.toString());
      setSettings(prev => ({ ...prev, [key]: value }));
    };
  
    // Show loading screen while settings are being loaded
    if (isLoading) {
      return (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#121212' }}>
          <ActivityIndicator size="large" color="#4CAF50" />
        </View>
      );
    }
  
    return (
      <SettingsContext.Provider value={{ settings, updateSetting }}>
        {children}
      </SettingsContext.Provider>
    );
  }

async function loadSettings(db: SQLiteDatabase): Promise<Settings> {
  const loadedSettings = { ...defaultSettings } as Record<SettingKey, unknown>;

  for (const [key, config] of Object.entries(SETTINGS_REGISTRY)) {
    const value = await getSetting(db, key);
    const settingKey = key as SettingKey;

    // Convert string value to appropriate type
    switch (typeof config.default) {
      case 'boolean':
        loadedSettings[settingKey] = value === 'true';
        break;
      case 'number':
        loadedSettings[settingKey] = parseFloat(value);
        break;
      default:
        loadedSettings[settingKey] = value;
    }
  }

  return loadedSettings as unknown as Settings;
}

export const useSettings = () => useContext(SettingsContext);