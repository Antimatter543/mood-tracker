import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { BarChart } from 'react-native-chart-kit';
import { useSQLiteContext } from 'expo-sqlite';
import { useThemeColors } from '@/styles/global';
import { useDataContext } from '@/context/DataContext';
import { Card } from '@/components/Card';
import { CHART_PADDING, SCREEN_WIDTH, useChartConfig } from './chartUtils';
import InfoBubble from '../InfoBubble';
import { useTimeframe } from '@/context/TimeframeContext';
import { DOW_MOOD_PATTERN } from './queries';
import { computeWindow, type Timeframe } from './transforms/windowHelpers';
import {
  buildDowPatternData,
  type DowRow,
  type DowPatternData,
} from './transforms/dayOfWeekPattern';

const chartWidth = SCREEN_WIDTH - CHART_PADDING;

const DailyMoodChart = () => {
  const colors = useThemeColors();
  const chartConfig = useChartConfig();
  const db = useSQLiteContext();
  const { refreshCount } = useDataContext();
  const { timeframe } = useTimeframe();
  const [pattern, setPattern] = useState<DowPatternData | null>(null);

  const styles = useMemo(() => StyleSheet.create({
    loadingText: {
      color: colors.text,
      textAlign: 'center',
      padding: 20,
    },
    title: {
      fontSize: 18,
      fontWeight: '600',
      color: colors.text,
      marginBottom: 16,
    },
    chartContainer: {
      alignItems: 'center',
    },
    chart: {
      borderRadius: 16,
      paddingRight: 0,
    },
    legendContainer: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      marginTop: 16,
      flexWrap: 'wrap',
      gap: 8,
    },
    legendItem: {
      alignItems: 'center',
    },
    legendDay: {
      color: colors.text,
      fontSize: 12,
    },
    legendCount: {
      color: colors.textSecondary,
      fontSize: 10,
    },
    callout: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      marginTop: 16,
      paddingTop: 16,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    calloutItem: {
      alignItems: 'center',
    },
    calloutLabel: {
      color: colors.textSecondary,
      fontSize: 12,
      marginBottom: 4,
    },
    calloutValue: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '600',
    },
    emptyText: {
      color: colors.textSecondary,
      fontSize: 14,
      textAlign: 'center',
      padding: 20,
    },
  }), [colors]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Timeframe-scoped, parameterised local-time window (?start, ?end) —
        // replaces the previous all-time GROUP BY strftime query, which was the
        // only chart on the screen that ignored the TimeframeSelector.
        const { start, end } = computeWindow(timeframe as Timeframe);
        const rows = await db.getAllAsync<DowRow>(DOW_MOOD_PATTERN, [start, end]);
        // Monday-first to match the heatmap convention used on this screen.
        setPattern(buildDowPatternData(rows, 1));
      } catch (error) {
        console.error('Error fetching daily mood data:', error);
        setPattern(null);
      }
    };

    fetchData();
  }, [db, refreshCount, timeframe]);

  if (!pattern) {
    return (
      <Card>
        <Text style={styles.title}>Average Mood by Day</Text>
        <Text style={styles.loadingText}>Loading...</Text>
      </Card>
    );
  }

  if (pattern.totalEntries === 0) {
    return (
      <Card>
        <Text style={styles.title}>Average Mood by Day</Text>
        <Text style={styles.emptyText}>
          No entries in this timeframe yet. Try a longer timeframe or add more
          entries.
        </Text>
      </Card>
    );
  }

  const chartData = {
    labels: pattern.labels,
    datasets: [{ data: pattern.avgMood, withDots: true }],
  };

  return (
    <Card>
      <InfoBubble
          text="Your average mood aggregated over each day of the week for the selected timeframe — handy for spotting patterns like a recurring midweek dip or a Saturday lift."
          position="top-right"
      />
      <Text style={styles.title}>Average Mood by Day</Text>
      <View style={styles.chartContainer}>
        <BarChart
          style={styles.chart}
          data={chartData}
          width={chartWidth}
          height={220}
          yAxisLabel=""
          yAxisSuffix=""
          chartConfig={{
            ...chartConfig,
            barPercentage: 0.7,
          }}
          showValuesOnTopOfBars={true}
          fromZero={true}
          withInnerLines={false}
          withHorizontalLabels={false}
        />
      </View>
      <View style={styles.legendContainer}>
        {pattern.labels.map((day, index) => (
          <View key={day} style={styles.legendItem}>
            <Text style={styles.legendCount}>{pattern.entryCount[index]} entries</Text>
            <Text style={styles.legendDay}>{day}</Text>
          </View>
        ))}
      </View>
      {pattern.hasEnoughData && pattern.bestDay !== '' && (
        <View style={styles.callout}>
          <View style={styles.calloutItem}>
            <Text style={styles.calloutLabel}>Best day</Text>
            <Text style={styles.calloutValue}>{pattern.bestDay}</Text>
          </View>
          <View style={styles.calloutItem}>
            <Text style={styles.calloutLabel}>Toughest day</Text>
            <Text style={styles.calloutValue}>{pattern.worstDay}</Text>
          </View>
        </View>
      )}
    </Card>
  );
};

export default DailyMoodChart;
