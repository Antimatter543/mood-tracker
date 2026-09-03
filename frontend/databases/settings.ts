/// ALL SETTINGS HERE SO JUST ADD/CHANGE HERE...
export const SETTINGS_REGISTRY = {
    fab_position: {
        key: 'fab_position',
        default: 'right' as 'left' | 'right',  // Be explicit about possible values
        type: 'switch',
        label: 'Change Button Position',
        description: 'Controls which side the add entry button appears',
        valueLabels: { true: 'left', false: 'right' }
    },
    theme_mode: {
        key: 'theme_mode',
        default: 'dark' as 'light' | 'dark',  // Be explicit about possible values
        type: 'switch',
        label: 'Dark Theme',
        description: 'Toggle between light and dark mode',
        valueLabels: { true: 'dark', false: 'light' }
    },
    theme: {
        key: 'theme',
        default: '' as '',  // Empty string means use theme_mode (for backward compatibility)
        type: 'select',
        label: 'App Theme',
        description: 'Choose a color theme for the app',
        options: [
            { label: 'System Default', value: '' },
            { label: 'Light', value: 'light' },
            { label: 'Dark', value: 'dark' },
            { label: 'Cherry Blossom', value: 'cherry' },
            { label: 'Midnight Blue', value: 'midnight' },
            { label: 'Forest', value: 'forest' }
        ]
    },
    mood_precision: {
        key: 'mood_precision',
        default: 'low' as 'high' | 'low',  // Be explicit about possible values
        type: 'switch',
        label: 'Detailed Mood Scale',
        description: 'Use decimal points in mood ratings',
        valueLabels: { true: 'high', false: 'low' }
    },
    show_mood_benchmarks: {
        key: 'show_mood_benchmarks',
        default: true,
        type: 'switch',
        label: 'Show Mood Benchmarks',
        description: 'Show emoji indicators on the mood scale',
    },
    activity_carryover: {
        key: 'activity_carryover',
        default: false,
        type: 'switch',
        label: 'Activity Carryover',
        description:
            'Count activities toward your mood for the next ~36 hours, with fading weight — not just the day you log them',
    },
    reminders: {
        key: 'reminders',
        // A JSON-encoded Reminder[] (see lib/reminders.ts) — the user's list of
        // named reminders, each with its own time + enabled flag. type:'text'
        // means the generic SettingRow renderer skips it; the whole list is
        // owned by the custom Reminders card (components/RemindersSection.tsx).
        //
        // This REPLACED the single `reminder_enabled` + `reminder_time` pair in
        // v2.10 (migration 14 folds those legacy rows into the list). The legacy
        // rows still exist in user_settings as that migration's source of truth,
        // but nothing reads them any more, so they are no longer registry keys.
        default: '[]',
        type: 'text',
        label: 'Reminders',
        description: 'Times you want to be nudged to log your mood',
    }
} as const;

// Define possible values for each setting
export type SettingValues = {
    fab_position: 'left' | 'right';
    theme_mode: 'light' | 'dark';  // Kept for backward compatibility
    theme: '' | 'light' | 'dark' | 'cherry' | 'midnight' | 'forest';  // Empty string means use theme_mode
    mood_precision: 'high' | 'low';
    show_mood_benchmarks: boolean;
    activity_carryover: boolean;
    reminders: string;  // JSON-encoded Reminder[] — parse with lib/reminders.parseReminders
};

export type SettingKey = keyof typeof SETTINGS_REGISTRY;
export type SettingType = 'switch' | 'select' | 'text';

export type SettingConfig = {
    key: string;
    default: any;
    type: SettingType;
    label: string;
    description?: string;
    valueLabels?: Record<string, string>;
    options?: Array<{ label: string; value: string }>;
};

// Use SettingValues to define the Settings type
export type Settings = SettingValues;

export type SettingsContextType = {
    settings: Settings;
    updateSetting: (key: SettingKey, value: SettingValues[SettingKey]) => Promise<void>;
};