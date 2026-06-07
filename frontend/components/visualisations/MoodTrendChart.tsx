import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { Text, StyleSheet, View } from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import { useThemeColors } from '@/styles/global';
import { useSQLiteContext } from 'expo-sqlite';
import { CHART_PADDING, SCREEN_WIDTH, useChartConfig, parseHexColor } from './chartUtils';
import { useDataContext } from '@/context/DataContext';
import InfoBubble from '../InfoBubble';
import { Card } from '../Card';
import { useTimeframe } from '@/context/TimeframeContext';
import { WEEKLY_MOOD_AVERAGES } from './queries';
import { computeWindow, type Timeframe } from './transforms/windowHelpers';
import {
  buildWeeklyMoodChartData,
  formatLabel,
  type MoodAvgRow,
} from './transforms/weeklyMood';
import { computeMovingAverage, type DayAvg } from './transforms/movingAverage';

/**
 * MoodTrendChart — the raw daily-average line PLUS a centred moving-average
 * overlay. The MA turns noisy day-to-day variance into a readable trend.
 *
 * The MA window adapts to the timeframe:
 *  - week:      none (a 7-day MA over 7 points is just the data, pointless)
 *  - month:     7-day MA
 *  - 3months+:  14-day MA
 *
 * Rendering is done entirely with react-native-chart-kit's native multi-dataset
 * support (two datasets, per-dataset colors) rather than an absolutely-
 * positioned SVG overlay. This avoids depending on chart-kit's private pixel
 * layout (the brittle xOffset magic numbers flagged as a risk in the brief) —
 * chart-kit positions both lines itself, so they always stay aligned.
 */

/** Maximum rendered points; beyond this we down-sample to keep the line legible. */
const MAX_POINTS = 90;

/** MA window (days) per timeframe. 0 = no overlay. */
const maWindowFor = (tf: Timeframe): number => {
  switch (tf) {
    case 'week':
      return 0;
    case 'month':
      return 7;
    case '3months':
    case 'year':
    case 'alltime':
      return 14;
    default:
      return 0;
  }
};

/**
 * Down-sample a dense daily-average series to at most `maxPoints` by taking
 * every N-th row (keeping the last). Render-specific, not a domain transform.
 */
export const sampleDailyAvgs = (rows: DayAvg[], maxPoints: number): DayAvg[] => {
  if (rows.length <= maxPoints || maxPoints <= 0) return rows;
  const step = Math.ceil(rows.length / maxPoints);
  const out: DayAvg[] = [];
  for (let i = 0; i < rows.length; i += step) out.push(rows[i]);
  // Always include the final point so the trend's end isn't clipped.
  if (out[out.length - 1] !== rows[rows.length - 1]) {
    out.push(rows[rows.length - 1]);
  }
  return out;
};

const titleFor = (tf: Timeframe): string => {
  switch (tf) {
    case 'week':
      return 'Weekly Mood Trend';
    case 'month':
      return 'Monthly Mood Trend';
    case '3months':
      return 'Quarterly Mood Trend';
    case 'year':
      return 'Yearly Mood Trend';
    case 'alltime':
      return 'All-Time Mood Trend';
    default:
      return 'Mood Trend';
  }
};

const MoodTrendChart = () => {
  const colors = useThemeColors();
  const chartConfig = useChartConfig();
  const chartWidth = SCREEN_WIDTH - (CHART_PADDING + 32);
  const db = useSQLiteContext();
  const { refreshCount } = useDataContext();
  const { timeframe } = useTimeframe();

  const [series, setSeries] = useState<{
    labels: string[];
    raw: number[];
    ma: number[] | null;
    nullIndices: number[];
  } | null>(null);
  const [loading, setLoading] = useState(true);

  const tf = timeframe as Timeframe;

  const maColor = useMemo(() => {
    const rgb = parseHexColor(colors.accentDark) ??
      parseHexColor(colors.accent) ?? { r: 61, g: 139, b: 64 };
    return (opacity = 1) => `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity * 0.85})`;
  }, [colors]);

  const formatDateLabel = useCallback(
    (dateStr: string, index: number, total: number) =>
      formatLabel(dateStr, index, total, tf),
    [tf],
  );

  const styles = useMemo(() => StyleSheet.create({
    title: {
      fontSize: 18,
      fontWeight: '600',
      marginBottom: 16,
      color: colors.text,
    },
    chart: {
      marginVertical: 8,
      borderRadius: 16,
    },
    loadingText: {
      color: colors.textSecondary,
      textAlign: 'center',
      padding: 20,
    },
    noDataText: {
      color: colors.textSecondary,
      textAlign: 'center',
      padding: 20,
    },
    legend: {
      flexDirection: 'row',
      gap: 16,
      marginTop: 4,
    },
    legendItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    legendDot: {
      width: 10,
      height: 3,
      borderRadius: 2,
    },
    legendText: {
      color: colors.textSecondary,
      fontSize: 12,
    },
  }), [colors]);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const { start, end } = computeWindow(tf);
        const rows = await db.getAllAsync<MoodAvgRow>(WEEKLY_MOOD_AVERAGES, [start, end]);

        const built = buildWeeklyMoodChartData(rows, tf);
        if (built.isEmpty) {
          setSeries(null);
          setLoading(false);
          return;
        }

        // Dense (gap-filled, interpolated) daily series for the MA window.
        const dense: DayAvg[] = rows.map((r, i) => ({
          date: r.date,
          avgMood: built.data[i],
        }));

        // Down-sample to a legible point count (alltime can be hundreds of days).
        const sampled = sampleDailyAvgs(dense, MAX_POINTS);
        const rawData = sampled.map((d) => d.avgMood);
        const labels = sampled.map((d, i) =>
          formatDateLabel(d.date, i, sampled.length),
        );

        // null-index set, remapped onto the sampled series so missing dots
        // still render distinctly.
        const sampledNullSet = new Set<number>();
        sampled.forEach((d, sampledIdx) => {
          const origIdx = dense.findIndex((o) => o.date === d.date);
          if (origIdx >= 0 && built.nullIndices.includes(origIdx)) {
            sampledNullSet.add(sampledIdx);
          }
        });

        const w = maWindowFor(tf);
        const ma =
          w > 0
            ? computeMovingAverage(sampled, w).map((p) => p.value)
            : null;

        setSeries({
          labels,
          raw: rawData,
          ma,
          nullIndices: Array.from(sampledNullSet),
        });
      } catch (error) {
        console.error('Error fetching mood trend data:', error);
        setSeries(null);
      }
      setLoading(false);
    };

    fetchData();
  }, [db, refreshCount, tf, formatDateLabel]);

  if (loading) {
    return (
      <Card>
        <Text style={styles.title}>{titleFor(tf)}</Text>
        <Text style={styles.loadingText}>Loading data...</Text>
      </Card>
    );
  }

  if (!series) {
    return (
      <Card>
        <Text style={styles.title}>{titleFor(tf)}</Text>
        <Text style={styles.noDataText}>No data available for this time period.</Text>
      </Card>
    );
  }

  // The raw line is the brand accent; the MA (when present) overlays in the
  // darker accent so the smoothed trend reads as the primary signal.
  const datasets: {
    data: number[];
    color?: (opacity?: number) => string;
    strokeWidth?: number;
    withDots?: boolean;
  }[] = [
    {
      data: series.raw,
      color: (o = 1) => `rgba(${parseHexColor(colors.accent)?.r ?? 76}, ${
        parseHexColor(colors.accent)?.g ?? 175
      }, ${parseHexColor(colors.accent)?.b ?? 80}, ${o * (series.ma ? 0.35 : 1)})`,
      strokeWidth: 2,
      withDots: !series.ma,
    },
  ];
  if (series.ma) {
    datasets.push({
      data: series.ma,
      color: maColor,
      strokeWidth: 3,
      withDots: false,
    });
  }
  // Invisible anchor datasets pin the y-axis to 0..10.
  datasets.push({ data: [10], color: () => 'transparent', withDots: false });
  datasets.push({ data: [0], color: () => 'transparent', withDots: false });

  return (
    <Card>
      <InfoBubble
        text="Your daily average mood over the selected timeframe. When the window is long enough, a moving-average line smooths out the day-to-day noise so you can see the underlying trend."
        position="top-right"
      />
      <Text style={styles.title}>{titleFor(tf)}</Text>
      <LineChart
        data={{ labels: series.labels, datasets }}
        width={chartWidth}
        height={220}
        yAxisLabel=""
        yAxisSuffix=""
        yAxisInterval={2}
        segments={5}
        withVerticalLines={false}
        withDots={!series.ma}
        getDotColor={(_p, index) =>
          series.nullIndices.includes(index) ? '#e74c3c' : colors.accent
        }
        chartConfig={{ ...chartConfig, strokeWidth: 2 }}
        bezier
        fromZero
        style={styles.chart}
      />
      {series.ma && (
        <View style={styles.legend}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: colors.accent, opacity: 0.45 }]} />
            <Text style={styles.legendText}>Daily average</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: colors.accentDark }]} />
            <Text style={styles.legendText}>
              {maWindowFor(tf)}-day trend
            </Text>
          </View>
        </View>
      )}
    </Card>
  );
};

export default MoodTrendChart;
