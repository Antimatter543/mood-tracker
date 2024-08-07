import { ThemeColors, useThemeColors } from '@/styles/global';
import React, { useMemo } from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';

type CardProps = {
  children: React.ReactNode;
  style?: ViewStyle;
};

const useThemedStyles = (colors: ThemeColors) => {
  return useMemo(() => StyleSheet.create({
    container: {
      backgroundColor: colors.cardBackground,
      borderRadius: 20,
      padding: 16,
      marginBottom: 16,
      borderWidth: 1,
      borderColor: colors.border,
    },
  }), [colors]);
};

export const Card = ({ children, style }: CardProps) => {
    const colors = useThemeColors();
    const styles = useThemedStyles(colors);

    return (
      <View style={[styles.container, style]}>
        <View>{children}</View>
      </View>
    );
};