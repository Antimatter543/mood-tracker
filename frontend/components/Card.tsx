import { ThemeColors, useThemeColors } from '@/styles/global';
import React, { useMemo } from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';

type CardProps = {
  children: React.ReactNode;
  style?: ViewStyle;
  /**
   * Visually flat vs. elevated. Defaults to `'elevated'`. Pass `'flat'` for
   * cards inside scrollable lists where stacked shadows look noisy.
   */
  variant?: 'elevated' | 'flat';
};

const useThemedStyles = (colors: ThemeColors) => {
  return useMemo(
    () =>
      StyleSheet.create({
        container: {
          backgroundColor: colors.cardBackground,
          borderRadius: 20,
          padding: 16,
          marginBottom: 16,
          borderWidth: 1,
          borderColor: colors.border,
        },
        elevated: {
          // Theme-aware drop shadow: lighter on light themes, deeper on dark.
          shadowColor: colors.elevation.shadowColor,
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: colors.elevation.shadowOpacity,
          shadowRadius: colors.elevation.shadowRadius,
          elevation: colors.elevation.elevation,
        },
      }),
    [colors]
  );
};

export const Card = ({ children, style, variant = 'elevated' }: CardProps) => {
  const colors = useThemeColors();
  const styles = useThemedStyles(colors);

  return (
    <View
      style={[styles.container, variant === 'elevated' && styles.elevated, style]}
    >
      <View>{children}</View>
    </View>
  );
};
