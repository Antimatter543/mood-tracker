import { useCallback, useState, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Svg, Rect } from 'react-native-svg';
import { useSQLiteContext } from 'expo-sqlite';
import { useThemeColors } from '@/styles/global';
import type { ThemeColors } from '@/styles/global';
import { useDataRefresh } from '@/hooks/useDataRefresh';
import { Card } from '@/components/Card';
import InfoBubble from '../InfoBubble';
import { useTimeframe } from '@/context/TimeframeContext';
import { TIME_OF_DAY_PATTERN } from './queries';
import { computeWindow, type Timeframe } from './transforms/windowHelpers';
import {
  aggregateTimeOfDay,
  computeIntradaySwing,
  type TimeOfDayRow,
  type TimeOfDayData,
  type IntradaySwing,
} from './transforms/timeOfDay';

const BAR_HEIGHT = 12;
const MAX_MOOD = 10;

type Styles = ReturnType<typeof makeStyles>;

/** One part-of-day bar: label, mood bar (scale 0–10), value + sample count.
 *  Extracted so all four buckets share one renderer. */
const BucketBar = ({
  label,
  avgMood,
  entryCount,
  colors,
  styles,
  svgW,
  onLayout,
}: {
  label: string;
  avgMood: number;
  entryCount: number;
  colors: ThemeColors;
  styles: Styles;
  svgW: number;
  onLayout: (width: number) => void;
}) => {
  const fillW = (avgMood / MAX_MOOD) * svgW;
  return (
    <View style={styles.row}>
      <View style={styles.rowHeader}>
        <Text style={styles.bucketLabel}>{label}</Text>
        <Text style={styles.sample}>n = {entryCount}</Text>
      </View>
      <View
        style={styles.barRow}
        onLayout={(e) => onLayout(e.nativeEvent.layout.width)}
      >
        <Svg width={svgW} height={BAR_HEIGHT}>
          <Rect
            x={0}
            y={0}
            width={svgW}
            height={BAR_HEIGHT}
            rx={BAR_HEIGHT / 2}
            fill={colors.overlays.tag}
          />
          <Rect
            x={0}
            y={0}
            width={Math.max(0, fillW)}
            height={BAR_HEIGHT}
            rx={BAR_HEIGHT / 2}
            fill={colors.accent}
          />
        </Svg>
        <Text style={styles.barValue}>{avgMood.toFixed(1)}</Text>
      </View>
    </View>
  );
};

/** The "within a day" insight block — only rendered when swing.hasEnough. */
const SwingInsight = ({
  swing,
  styles,
  positiveColor,
  negativeColor,
}: {
  swing: IntradaySwing;
  styles: Styles;
  positiveColor: string;
  negativeColor: string;
}) => {
  const rose = swing.avgDelta >= 0;
  const magnitude = Math.abs(swing.avgDelta).toFixed(1);
  return (
    <View style={styles.swingBlock}>
      <Text style={styles.swingTitle}>Within a day</Text>
      <Text style={styles.swingText}>
        On the {swing.multiLogDayCount} days you logged more than once, your mood{' '}
        <Text style={{ color: rose ? positiveColor : negativeColor }}>
          {rose ? 'rose' : 'dipped'} {magnitude}
        </Text>{' '}
        on average from first to last — typical daily swing {swing.avgRange.toFixed(1)}.
      </Text>
    </View>
  );
};

const TimeOfDayChart = () => {
  const colors = useThemeColors();
  const db = useSQLiteContext();
  const { timeframe } = useTimeframe();
  const [data, setData] = useState<TimeOfDayData | null>(null);
  const [swing, setSwing] = useState<IntradaySwing | null>(null);
  const [barWidth, setBarWidth] = useState(0);

  const styles = useMemo(() => makeStyles(colors), [colors]);

  const fetchData = useCallback(async () => {
      try {
        // Parameterised local-time window (?start, ?end). Raw {date, mood} rows
        // -> JS bucketing by LOCAL hour-of-day + per-LOCAL-day intraday grouping
        // (SQL never extracts the hour/day; that would key it in UTC).
        const { start, end } = computeWindow(timeframe as Timeframe);
        const rawRows = await db.getAllAsync<TimeOfDayRow>(TIME_OF_DAY_PATTERN, [start, end]);
        setData(aggregateTimeOfDay(rawRows));
        setSwing(computeIntradaySwing(rawRows));
      } catch (error) {
        console.error('Error fetching time-of-day data:', error);
        setData(null);
        setSwing(null);
      }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- query reads db + timeframe; setState identities are stable
    }, [db, timeframe]);
  // Focus-aware refetch (matches the other charts on this screen).
  useDataRefresh(fetchData, [db, timeframe]);

  if (!data) {
    return (
      <Card>
        <Text style={styles.title}>Time of Day</Text>
        <Text style={styles.loadingText}>Loading...</Text>
      </Card>
    );
  }

  // Low-data empty state — mirrors the other charts' calm "keep logging" copy.
  if (!data.hasEnoughData) {
    return (
      <Card>
        <Text style={styles.title}>Time of Day</Text>
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>
            Keep logging — your time-of-day pattern needs ~2 weeks of entries to
            be meaningful.
          </Text>
        </View>
      </Card>
    );
  }

  const svgW = barWidth > 0 ? barWidth : 1;
  const positiveColor = colors.accent;
  const negativeColor = colors.isDark ? '#FF8A80' : '#E57373';
  const onBarLayout = (w: number) => {
    if (w > 0 && Math.abs(w - barWidth) > 1) setBarWidth(w);
  };

  return (
    <Card>
      <InfoBubble
        text="Average mood by part of the day, from your entries' timestamps — handy for spotting whether mornings lift you or evenings drag. When you log more than once in a day, the 'Within a day' note shows how your mood typically swings from your first entry to your last."
        position="top-right"
      />
      <Text style={styles.title}>Time of Day</Text>
      <Text style={styles.subtitle}>Average mood by part of the day</Text>

      {data.buckets.map((b) => (
        <BucketBar
          key={b.bucket}
          label={b.label}
          avgMood={b.avg_mood}
          entryCount={b.entry_count}
          colors={colors}
          styles={styles}
          svgW={svgW}
          onLayout={onBarLayout}
        />
      ))}

      {data.bestBucket !== '' && data.worstBucket !== '' && (
        <Text style={styles.callout}>
          You tend to feel best in the{' '}
          <Text style={styles.calloutEmphasis}>{data.bestBucket}</Text> and toughest
          at <Text style={styles.calloutEmphasis}>{data.worstBucket}</Text>.
        </Text>
      )}

      {swing?.hasEnough && (
        <SwingInsight
          swing={swing}
          styles={styles}
          positiveColor={positiveColor}
          negativeColor={negativeColor}
        />
      )}
    </Card>
  );
};

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    title: {
      fontSize: 18,
      fontWeight: '600',
      color: colors.text,
      marginBottom: 4,
    },
    subtitle: {
      fontSize: 13,
      color: colors.textSecondary,
      marginBottom: 16,
    },
    loadingText: {
      color: colors.text,
      textAlign: 'center',
      padding: 20,
    },
    row: {
      marginBottom: 14,
    },
    rowHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 6,
    },
    bucketLabel: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '600',
    },
    sample: {
      fontSize: 11,
      color: colors.textSecondary,
    },
    barRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      width: '100%',
    },
    barValue: {
      width: 30,
      fontSize: 11,
      color: colors.text,
      textAlign: 'right',
    },
    callout: {
      fontSize: 13,
      lineHeight: 20,
      color: colors.textSecondary,
      marginTop: 4,
    },
    calloutEmphasis: {
      color: colors.text,
      fontWeight: '600',
    },
    swingBlock: {
      marginTop: 16,
      paddingTop: 16,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    swingTitle: {
      fontSize: 12,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      color: colors.textSecondary,
      marginBottom: 6,
    },
    swingText: {
      fontSize: 13,
      lineHeight: 20,
      color: colors.textSecondary,
    },
    emptyState: {
      alignItems: 'center',
      padding: 20,
    },
    emptyText: {
      color: colors.textSecondary,
      fontSize: 14,
      textAlign: 'center',
      marginTop: 8,
    },
  });

export default TimeOfDayChart;
