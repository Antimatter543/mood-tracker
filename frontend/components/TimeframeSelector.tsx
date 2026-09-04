import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import SegmentedControl, { type SegmentedOption } from '@/components/SegmentedControl';

export type Timeframe = 'week' | 'month' | '3months' | 'year' | 'alltime';

interface TimeframeSelectorProps {
  selectedTimeframe: Timeframe;
  onTimeframeChange: (timeframe: Timeframe) => void;
}

const OPTIONS: readonly SegmentedOption<Timeframe>[] = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: '3months', label: '3 Months' },
  { value: 'year', label: 'Year' },
  { value: 'alltime', label: 'All Time' },
];

/**
 * The Statistics period-length pills. A thin wrapper over the shared
 * SegmentedControl — the pill styling lives there so this row and the chart's
 * scale toggle stay visually identical.
 */
const TimeframeSelector: React.FC<TimeframeSelectorProps> = ({
  selectedTimeframe,
  onTimeframeChange,
}) => {
  // The gap under the row is this screen's spacing, not the control's, so it
  // stays here rather than inside the shared component.
  const styles = useMemo(
    () => StyleSheet.create({ wrap: { marginBottom: 16 } }),
    [],
  );

  return (
    <View style={styles.wrap}>
      <SegmentedControl
        options={OPTIONS}
        value={selectedTimeframe}
        onChange={onTimeframeChange}
        testID="timeframe-selector"
      />
    </View>
  );
};

export default TimeframeSelector;
