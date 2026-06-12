import React, { useMemo, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { Layout } from '@/components/PageContainer';
import { EmptyState } from '@/components/EmptyState';
import { useDataRefresh } from '@/hooks/useDataRefresh';
import { TOTAL_ENTRIES } from '@/components/visualisations/queries';
import SectionHeader from '@/components/SectionHeader';
import StatSummaryCard from '@/components/visualisations/StatSummaryCard';
import MoodTrendChart from '@/components/visualisations/MoodTrendChart';
import DailyMoodChart from '@/components/visualisations/DailyMoodBar';
import MoodHistogram from '@/components/visualisations/Scatterplot';
import CustomHeatmap from '@/components/visualisations/CustomHeatMap';
import ActivityCorrelationChart from '@/components/visualisations/ActivityCorrelationChart';
import MonthOverMonthCard from '@/components/visualisations/MonthOverMonthCard';
import TimeframeSelector from '@/components/TimeframeSelector';
import { TimeframeProvider, useTimeframe } from '@/context/TimeframeContext';
import { useThemeColors } from '@/styles/global';

/** Fallback used until the sticky header reports its real height via onLayout. */
const DEFAULT_HEADER_HEIGHT = 96;

const StatisticsContent = () => {
  const { timeframe, setTimeframe, timeframeDescription } = useTimeframe();
  const colors = useThemeColors();
  const db = useSQLiteContext();
  // Whole-DB empty check. `null` = still loading (render nothing to avoid a
  // flash of empty charts before the count returns).
  const [hasEntries, setHasEntries] = useState<boolean | null>(null);

  // Focus-aware refetch: runs on every focus gain (so returning to this tab
  // always reflects entries added on other tabs — no app reopen) AND re-runs
  // while focused when refreshCount changes. The cleanup flips `active=false`
  // on blur/unmount so a late query never sets state on a backgrounded screen.
  const loadHasEntries = useCallback(() => {
    let active = true;
    db.getFirstAsync<{ count: number }>(TOTAL_ENTRIES)
      .then((row) => {
        if (active) setHasEntries((row?.count ?? 0) > 0);
      })
      .catch(() => {
        // On a query error, fall back to showing the charts (they degrade
        // gracefully) rather than hiding everything.
        if (active) setHasEntries(true);
      });
    return () => {
      active = false;
    };
  }, [db]);
  useDataRefresh(loadHasEntries, [db]);
  // Measure the sticky header instead of hardcoding paddingTop: 120 — the
  // header height varies with font scaling / description length.
  const [headerHeight, setHeaderHeight] = useState(DEFAULT_HEADER_HEIGHT);

  const onHeaderLayout = useCallback(
    (e: { nativeEvent: { layout: { height: number } } }) => {
      const h = e.nativeEvent.layout.height;
      if (h > 0 && Math.abs(h - headerHeight) > 1) setHeaderHeight(h);
    },
    [headerHeight],
  );

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          flex: 1,
        },
        scrollView: {
          flex: 1,
        },
        stickyHeader: {
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          backgroundColor: colors.background,
          paddingTop: 12,
          paddingBottom: 12,
          zIndex: 1000,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.15,
          shadowRadius: 4,
          elevation: 6,
          alignItems: 'center',
        },
        description: {
          color: colors.textSecondary,
          fontSize: 14,
          marginTop: 4,
        },
        content: {
          paddingHorizontal: 16,
          // Measured header height + a small gap, instead of a magic 120.
          paddingTop: headerHeight + 12,
          paddingBottom: 32,
        },
        chartsContainer: {
          gap: 4,
        },
      }),
    [colors, headerHeight],
  );

  // Still counting — render nothing briefly to avoid flashing empty charts.
  if (hasEntries === null) {
    return <View style={styles.container} />;
  }

  // Brand-new user: one calm empty state instead of a wall of empty charts.
  if (!hasEntries) {
    return (
      <EmptyState
        icon="bar-chart-2"
        title="No data yet"
        subtitle="Log your mood to see your statistics. Your charts and patterns will appear here."
      />
    );
  }

  return (
    <View style={styles.container}>
      {/* Sticky header positioned above the ScrollView */}
      <View style={styles.stickyHeader} onLayout={onHeaderLayout}>
        <TimeframeSelector
          selectedTimeframe={timeframe}
          onTimeframeChange={setTimeframe}
        />
        <Text style={styles.description}>{timeframeDescription}</Text>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={true}
      >
        <View style={styles.chartsContainer}>
          {/* SECTION 1 — OVERVIEW */}
          <SectionHeader label="Overview" />
          <StatSummaryCard />
          <MoodTrendChart />

          {/* SECTION 2 — PATTERNS */}
          <SectionHeader label="Patterns" />
          <DailyMoodChart />
          <MoodHistogram />
          <CustomHeatmap />

          {/* SECTION 3 — ACTIVITIES */}
          <SectionHeader label="Activities" />
          <ActivityCorrelationChart />
          <MonthOverMonthCard />
        </View>
      </ScrollView>
    </View>
  );
};

export default function Stats() {
  return (
    <TimeframeProvider>
      <Layout useScrollView={false}>
        <StatisticsContent />
      </Layout>
    </TimeframeProvider>
  );
}
