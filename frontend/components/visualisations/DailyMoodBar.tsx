import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { BarChart } from 'react-native-chart-kit';
import { useSQLiteContext } from 'expo-sqlite';
import { useThemeColors } from '@/styles/global';
import { useDataContext } from '@/context/DataContext';
import { Card } from '@/components/Card';
import { CHART_PADDING, SCREEN_WIDTH, useChartConfig } from './chartUtils';
import InfoBubble from '../InfoBubble';
import { buildDailyBarData, type DailyMoodRow } from './transforms/dailyBar';

// const screenWidth = Dimensions.get('window').width;
// const chartWidth = screenWidth - 48; // Adjust for padding

const chartWidth = SCREEN_WIDTH - CHART_PADDING; 

const DailyMoodChart = () => {
  const colors = useThemeColors();
  const chartConfig = useChartConfig();
  const db = useSQLiteContext();
  const { refreshCount } = useDataContext();
  const [chartData, setChartData] = useState<{
      labels: string[];
      datasets: { data: number[]; withDots: boolean; }[];
      counts: number[];
  } | null>(null);

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
  }), [colors]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // SQLite's strftime('%w') returns 0=Sun..6=Sat.
        // Note: strftime treats the stored datetime as UTC. For per-day-of-week
        // aggregates this is a small leak (an entry made at 11pm Sun local can
        // count as Mon under UTC) — fix lives with the entries-table layer,
        // not here. Flagged in the brief; tracked separately.
        const rows = await db.getAllAsync<DailyMoodRow>(`
          SELECT
            CAST(strftime('%w', date) AS INTEGER) as day_of_week,
            ROUND(AVG(mood), 1) as avg_mood,
            COUNT(*) as entry_count
          FROM entries
          GROUP BY day_of_week
          ORDER BY day_of_week
        `);

        const built = buildDailyBarData(rows);
        setChartData({
          labels: built.labels,
          datasets: [{ data: built.data, withDots: true }],
          counts: built.counts,
        });
      } catch (error) {
        console.error('Error fetching daily mood data:', error);
      }
    };

    fetchData();
  }, [db, refreshCount]);

  if (!chartData) {
    return <Text style={styles.loadingText}>Loading...</Text>;
  }

  return (
    <Card>
      <InfoBubble 
          text="Your daily mood entries aggregated over the seven days of the week, giving you a detailed view of mood fluctuations throughout it and potentially finding hidden patterns - maybe you're a Monday enjoyer?"
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
        {chartData.labels.map((day, index) => (
          <View key={day} style={styles.legendItem}>
            <Text style={styles.legendCount}>{chartData.counts[index]} entries</Text>
            <Text style={styles.legendDay}>{day}</Text>
          </View>
        ))}
      </View>
    </Card>
  );
};

export default DailyMoodChart;