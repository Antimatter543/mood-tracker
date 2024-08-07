// EmptyState.tsx
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { useThemeColors } from '@/styles/global';

export const EmptyState = () => {
  const colors = useThemeColors();
  const styles = useThemedStyles(colors);

  return (
    <View style={styles.container}>
        <Feather name="clipboard" size={48} color={colors.textSecondary} strokeWidth={1.5} />
      <Text style={styles.title}>No Entries Yet</Text>
      <Text style={styles.subtitle}>
        Start tracking your moods by clicking the + button.
      </Text>
    </View>
  );
};

const useThemedStyles = (colors: any) => StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    gap: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.text,
    marginTop: 16,
  },
  subtitle: {
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
  },
});