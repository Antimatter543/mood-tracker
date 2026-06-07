import React, { useMemo } from 'react';
import { Text, StyleSheet } from 'react-native';
import { useThemeColors } from '@/styles/global';

type SectionHeaderProps = {
  /** e.g. "OVERVIEW", "PATTERNS", "ACTIVITIES". Rendered uppercase. */
  label: string;
};

/**
 * A small, uppercase, letter-spaced section divider for the stats screen.
 * Matches the `cardTitle` style from useGlobalStyles (textSecondary colour)
 * so groups of cards read as a single section.
 */
const SectionHeader: React.FC<SectionHeaderProps> = ({ label }) => {
  const colors = useThemeColors();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        label: {
          fontSize: 13,
          fontWeight: '700',
          color: colors.textSecondary,
          textTransform: 'uppercase',
          letterSpacing: 1.4,
          marginTop: 8,
          marginBottom: 4,
          marginLeft: 4,
        },
      }),
    [colors]
  );

  return <Text style={styles.label}>{label.toUpperCase()}</Text>;
};

export default SectionHeader;
