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
  /** When true, renders a 3px accent-colored bar at the top of the card. */
  accentTop?: boolean;
};

const useThemedStyles = (colors: ThemeColors) => {
  return useMemo(
    () =>
      StyleSheet.create({
        container: {
          backgroundColor: colors.cardBackground,
          borderRadius: 24,
          padding: 16,
          marginBottom: 16,
          overflow: 'hidden',
        },
        elevated: {
          // Theme-aware drop shadow: lighter on light themes, deeper on dark.
          shadowColor: colors.elevation.shadowColor,
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: colors.elevation.shadowOpacity,
          shadowRadius: 12,
          elevation: colors.elevation.elevation,
        },
        accentBar: {
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 3,
          backgroundColor: colors.accent,
        },
      }),
    [colors]
  );
};

export const Card = ({ children, style, variant = 'elevated', accentTop = false }: CardProps) => {
  const colors = useThemeColors();
  const styles = useThemedStyles(colors);

  return (
    <View
      style={[styles.container, variant === 'elevated' && styles.elevated, style]}
    >
      {accentTop && <View style={styles.accentBar} />}
      <View>{children}</View>
    </View>
  );
};
