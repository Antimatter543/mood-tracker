// EmptyState.tsx
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { ThemeColors, useThemeColors } from '@/styles/global';

type FeatherIconName = React.ComponentProps<typeof Feather>['name'];

type EmptyStateProps = {
  /** Feather icon name; defaults to `'clipboard'` to preserve legacy behavior. */
  icon?: FeatherIconName;
  title?: string;
  subtitle?: string;
  /** Optional CTA — when provided, renders an accent-tinted pill button. */
  action?: {
    label: string;
    onPress: () => void;
  };
};

/**
 * EmptyState — visually inviting "no data" panel.
 *
 * Defaults preserve the previous look (clipboard + "No Entries Yet") so
 * existing call sites don't need to be touched. New call sites can pass
 * `icon`, `title`, `subtitle`, and `action` to customize for their context.
 */
export const EmptyState = ({
  icon = 'clipboard',
  title = 'No Entries Yet',
  subtitle = 'Start tracking your moods by clicking the + button.',
  action,
}: EmptyStateProps = {}) => {
  const colors = useThemeColors();
  const styles = useThemedStyles(colors);

  return (
    <View style={styles.container} accessibilityRole="summary">
      <View style={styles.iconHalo}>
        <Feather name={icon} size={40} color={colors.textSecondary} />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
      {action ? (
        <Pressable
          style={({ pressed }) => [styles.actionButton, pressed && styles.actionButtonPressed]}
          onPress={action.onPress}
          accessibilityRole="button"
          accessibilityLabel={action.label}
        >
          <Text style={styles.actionLabel}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
};

const useThemedStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 32,
      gap: 8,
    },
    // Soft "halo" behind the icon — uses the theme's tag overlay so it adapts
    // to every theme automatically.
    iconHalo: {
      width: 96,
      height: 96,
      borderRadius: 48,
      backgroundColor: colors.accentLight,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 8,
    },
    title: {
      fontSize: 20,
      fontWeight: '600',
      color: colors.text,
      marginTop: 8,
      textAlign: 'center',
    },
    subtitle: {
      fontSize: 15,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 22,
      maxWidth: 280,
    },
    actionButton: {
      marginTop: 16,
      paddingHorizontal: 20,
      paddingVertical: 12,
      borderRadius: 24,
      backgroundColor: colors.accent,
      minHeight: 44, // a11y touch target
      minWidth: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    actionButtonPressed: {
      backgroundColor: colors.accentDark,
      transform: [{ scale: 0.97 }],
    },
    actionLabel: {
      color: '#FFFFFF',
      fontSize: 15,
      fontWeight: '600',
    },
  });
