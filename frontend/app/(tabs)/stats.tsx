import React, { useMemo, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { Layout } from '@/components/PageContainer';
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
