import React, { useCallback, useState, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { useSQLiteContext } from 'expo-sqlite';
import { useDataRefresh } from '@/hooks/useDataRefresh';
import { useThemeColors } from '@/styles/global';
import { Card } from '@/components/Card';
import { WINDOW_SUMMARY } from './queries';
import { startOfLocalDay, endOfLocalDay, localDateString } from './transforms/dateHelpers';
import {
  computeMonthOverMonth,
  type MonthMoodRow,
  type MonthOverMonthData,
} from './transforms/monthOverMonth';

/** Material red 300 — semantic "down" signal, not a brand color. */
const FALLING_COLOR = '#e57373';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * MonthOverMonthCard compares the current CALENDAR month against the previous
 * one. This is deliberately NOT driven by the TimeframeSelector (which shows
 * rolling windows) — calendar months are a different concept, so the card is
 * labelled with the actual month names to avoid confusion.
 */
const MonthOverMonthCard = () => {
  const colors = useThemeColors();
  const db = useSQLiteContext();
  const [data, setData] = useState<MonthOverMonthData | null>(null);
  const [labels, setLabels] = useState<{ current: string; previous: string }>({
    current: '',
    previous: '',
  });

  const styles = useMemo(() => StyleSheet.create({
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 4,
    },
    title: {
      fontSize: 18,
      fontWeight: '600',
      color: colors.text,
    },
    subtitle: {
      fontSize: 13,
      color: colors.textSecondary,
      marginBottom: 16,
    },
    columns: {
      flexDirection: 'row',
    },
    column: {
      flex: 1,
    },
    columnDivider: {
      width: 1,
      backgroundColor: colors.border,
      marginHorizontal: 12,
    },
    monthLabel: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.text,
      marginBottom: 12,
    },
    metric: {
      marginBottom: 10,
    },
    metricLabel: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    metricValueRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    metricValue: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.text,
    },
    deltaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    deltaText: {
      fontSize: 13,
      fontWeight: '600',
    },
    emptyText: {
      color: colors.textSecondary,
      fontSize: 14,
      textAlign: 'center',
      padding: 20,
    },
  }), [colors]);

  const fetchData = useCallback(async () => {
      try {
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth(); // 0-11

        // Current calendar month boundaries (local).
        const curFirst = new Date(year, month, 1);
        const curLast = new Date(year, month + 1, 0); // day 0 of next month = last day
        // Previous calendar month boundaries (month -1 wraps to Dec/prev year).
        const prevFirst = new Date(year, month - 1, 1);
        const prevLast = new Date(year, month, 0);

        const daysInCurrent = curLast.getDate();
        const daysInPrevious = prevLast.getDate();

        const curStart = startOfLocalDay(localDateString(curFirst));
        const curEnd = endOfLocalDay(localDateString(curLast));
        const prevStart = startOfLocalDay(localDateString(prevFirst));
        const prevEnd = endOfLocalDay(localDateString(prevLast));

        const [currentRow, previousRow] = await Promise.all([
          db.getFirstAsync<MonthMoodRow>(WINDOW_SUMMARY, [curStart, curEnd]),
          db.getFirstAsync<MonthMoodRow>(WINDOW_SUMMARY, [prevStart, prevEnd]),
        ]);

        setData(
          computeMonthOverMonth(
            currentRow ?? { avg_mood: null, entry_count: 0 },
            previousRow ?? { avg_mood: null, entry_count: 0 },
            daysInCurrent,
            daysInPrevious,
          ),
        );
        setLabels({
          current: MONTH_NAMES[month],
          previous: MONTH_NAMES[(month + 11) % 12],
        });
      } catch (error) {
        console.error('Error fetching month-over-month data:', error);
        setData(null);
      }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- query reads only db; setState identities are stable
    }, [db]);
  // Focus-aware refetch (replaces useEffect([db, refreshCount])).
  useDataRefresh(fetchData, [db]);

  if (!data) {
    return (
      <Card>
        <View style={styles.header}>
          <Feather name="calendar" size={18} color={colors.accent} />
          <Text style={styles.title}>Month over Month</Text>
        </View>
        <Text style={styles.emptyText}>Loading...</Text>
      </Card>
    );
  }

  const trendUp = data.trend === 'up';
  const trendFlat = data.trend === 'flat';
  const deltaColor = trendFlat
    ? colors.textSecondary
    : trendUp
      ? colors.accent
      : FALLING_COLOR;
  const deltaIcon = trendFlat ? 'minus' : trendUp ? 'arrow-up-right' : 'arrow-down-right';

  return (
    <Card>
      <View style={styles.header}>
        <Feather name="calendar" size={18} color={colors.accent} />
        <Text style={styles.title}>Month over Month</Text>
      </View>
      <Text style={styles.subtitle}>Calendar months — not the timeframe above</Text>

      <View style={styles.columns}>
        <View style={styles.column}>
          <Text style={styles.monthLabel}>{labels.current} (this month)</Text>

          <View style={styles.metric}>
            <Text style={styles.metricLabel}>Avg mood</Text>
            <View style={styles.metricValueRow}>
              <Text style={styles.metricValue}>{data.currentAvg.toFixed(1)}</Text>
              <View style={styles.deltaRow}>
                <Feather name={deltaIcon as any} size={13} color={deltaColor} />
                <Text style={[styles.deltaText, { color: deltaColor }]}>
                  {data.delta >= 0 ? '+' : ''}
                  {data.delta.toFixed(1)}
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.metric}>
            <Text style={styles.metricLabel}>Entries</Text>
            <Text style={styles.metricValue}>{data.currentEntryCount}</Text>
          </View>

          <View style={styles.metric}>
            <Text style={styles.metricLabel}>Consistency</Text>
            <Text style={styles.metricValue}>
              {Math.round(data.currentConsistencyPct)}%
            </Text>
          </View>
        </View>

        <View style={styles.columnDivider} />

        <View style={styles.column}>
          <Text style={styles.monthLabel}>{labels.previous} (last month)</Text>

          <View style={styles.metric}>
            <Text style={styles.metricLabel}>Avg mood</Text>
            <Text style={styles.metricValue}>{data.previousAvg.toFixed(1)}</Text>
          </View>

          <View style={styles.metric}>
            <Text style={styles.metricLabel}>Entries</Text>
            <Text style={styles.metricValue}>{data.previousEntryCount}</Text>
          </View>

          <View style={styles.metric}>
            <Text style={styles.metricLabel}>Consistency</Text>
            <Text style={styles.metricValue}>
              {Math.round(data.previousConsistencyPct)}%
            </Text>
          </View>
        </View>
      </View>
    </Card>
  );
};

export default MonthOverMonthCard;
