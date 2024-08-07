import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useThemeColors } from '@/styles/global';

export type Timeframe = 'week' | 'month' | '3months' | 'year' | 'alltime';

interface TimeframeSelectorProps {
  selectedTimeframe: Timeframe;
  onTimeframeChange: (timeframe: Timeframe) => void;
}

const TimeframeSelector: React.FC<TimeframeSelectorProps> = ({
  selectedTimeframe,
  onTimeframeChange
}) => {
  const colors = useThemeColors();
  
  const styles = StyleSheet.create({
    container: {
      flexDirection: 'row',
      backgroundColor: colors.overlays.tag,
      borderRadius: 20,
      padding: 4,
      marginBottom: 16,
      alignSelf: 'center',
    },
    option: {
      paddingVertical: 6,
      paddingHorizontal: 12,
      borderRadius: 16,
    },
    selectedOption: {
      backgroundColor: colors.accent,
    },
    optionText: {
      color: colors.textSecondary,
      fontSize: 14,
    },
    selectedOptionText: {
      color: '#fff',
      fontWeight: '600',
    },
  });

  const options: { value: Timeframe; label: string }[] = [
    { value: 'week', label: 'Week' },
    { value: 'month', label: 'Month' },
    { value: '3months', label: '3 Months' },
    { value: 'year', label: 'Year' },
    { value: 'alltime', label: 'All Time' },
  ];

  return (
    <View style={styles.container}>
      {options.map((option) => (
        <Pressable
          key={option.value}
          style={[
            styles.option,
            selectedTimeframe === option.value && styles.selectedOption,
          ]}
          onPress={() => onTimeframeChange(option.value)}
        >
          <Text
            style={[
              styles.optionText,
              selectedTimeframe === option.value && styles.selectedOptionText,
            ]}
          >
            {option.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
};

export default TimeframeSelector;