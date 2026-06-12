import React, { useCallback, useState, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Svg, Rect } from 'react-native-svg';
import { useSQLiteContext } from 'expo-sqlite';
import { useDataRefresh } from '@/hooks/useDataRefresh';
import { useThemeColors } from '@/styles/global';
import { Card } from '@/components/Card';
import InfoBubble from '../InfoBubble';
import { useTimeframe } from '@/context/TimeframeContext';
import { ACTIVITY_CORRELATION } from './queries';
import { computeWindow, type Timeframe } from './transforms/windowHelpers';
import {
  computeActivityCorrelation,
  type ActivityCorrelationRow,
  type ActivityCorrelationResult,
} from './transforms/activityCorrelation';

const BAR_HEIGHT = 12;
const MAX_MOOD = 10;
const MIN_MEANINGFUL_ITEMS = 2;

const ActivityCorrelationChart = () => {
  const colors = useThemeColors();
  const db = useSQLiteContext();
  const { timeframe } = useTimeframe();
  const [meaningful, setMeaningful] = useState<ActivityCorrelationResult[]>([]);
  const [barWidth, setBarWidth] = useState(0);

  const styles = useMemo(() => StyleSheet.create({
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
    row: {
      marginBottom: 18,
    },
    rowHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      marginBottom: 6,
    },
    activityName: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '600',
    },
    delta: {
      fontSize: 14,
      fontWeight: '700',
    },
    barBlock: {
      width: '100%',
    },
    barRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 4,
    },
    barLabel: {
      width: 56,
      fontSize: 11,
      color: colors.textSecondary,
    },
    barValue: {
      width: 30,
      fontSize: 11,
      color: colors.text,
      textAlign: 'right',
    },
    sample: {
      fontSize: 11,
      color: colors.textSecondary,
      marginTop: 2,
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
  }), [colors]);

  const fetchData = useCallback(async () => {
      try {
        // Parameterised local-time window (?start, ?end) — NOT the UTC-anchored
        // timeframeCondition string the old delta-from-mean chart used.
        const { start, end } = computeWindow(timeframe as Timeframe);
        const rows = await db.getAllAsync<ActivityCorrelationRow>(
          ACTIVITY_CORRELATION,
          [start, end],
        );
        const { meaningful: m } = computeActivityCorrelation(rows);
        setMeaningful(m);
      } catch (error) {
        console.error('Error fetching activity correlation:', error);
        setMeaningful([]);
      }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- query reads db + timeframe; setState identities are stable
    }, [db, timeframe]);
  // Focus-aware refetch (replaces useEffect([db, refreshCount, timeframe])).
  useDataRefresh(fetchData, [db, timeframe]);

  if (meaningful.length < MIN_MEANINGFUL_ITEMS) {
    return (
      <Card>
        <Text style={styles.title}>Activity Correlation</Text>
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>
            Not enough data yet. Log activities across more days (at least 5 with
            and 5 without each activity) or try a longer timeframe.
          </Text>
        </View>
      </Card>
    );
  }

  const svgW = barWidth > 0 ? barWidth : 1;
  const positiveColor = colors.accent;
  const negativeColor = colors.isDark ? '#FF8A80' : '#E57373';

  return (
    <Card>
      <InfoBubble
        text="Compares your average mood on days you logged an activity ('with') against days you didn't ('without'). A positive delta means the activity lines up with better days — and we only show activities with enough days on each side to be meaningful."
        position="top-right"
      />
      <Text style={styles.title}>Activity Correlation</Text>
      <Text style={styles.subtitle}>Average mood with vs. without each activity</Text>

      {meaningful.map((item) => {
        const withW = (item.avg_with / MAX_MOOD) * svgW;
        const withoutW = (item.avg_without / MAX_MOOD) * svgW;
        const deltaPositive = item.delta >= 0;
        return (
          <View key={item.activity_name} style={styles.row}>
            <View style={styles.rowHeader}>
              <Text style={styles.activityName}>{item.activity_name}</Text>
              <Text
                style={[
                  styles.delta,
                  { color: deltaPositive ? positiveColor : negativeColor },
                ]}
              >
                {deltaPositive ? '+' : ''}
                {item.delta.toFixed(1)}
              </Text>
            </View>

            <View
              style={styles.barBlock}
              onLayout={(e) => {
                const w = e.nativeEvent.layout.width;
                if (w > 0 && Math.abs(w - barWidth) > 1) setBarWidth(w);
              }}
            >
              <View style={styles.barRow}>
                <Text style={styles.barLabel}>With</Text>
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
                    width={Math.max(0, withW)}
                    height={BAR_HEIGHT}
                    rx={BAR_HEIGHT / 2}
                    fill={positiveColor}
                  />
                </Svg>
                <Text style={styles.barValue}>{item.avg_with.toFixed(1)}</Text>
              </View>

              <View style={styles.barRow}>
                <Text style={styles.barLabel}>Without</Text>
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
                    width={Math.max(0, withoutW)}
                    height={BAR_HEIGHT}
                    rx={BAR_HEIGHT / 2}
                    fill={colors.textSecondary}
                  />
                </Svg>
                <Text style={styles.barValue}>{item.avg_without.toFixed(1)}</Text>
              </View>
            </View>

            <Text style={styles.sample}>
              n = {item.count_with} with / {item.count_without} without
            </Text>
          </View>
        );
      })}
    </Card>
  );
};

export default ActivityCorrelationChart;
