import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { Card } from '../Card';
import InfoBubble from '../InfoBubble';
import { useThemeColors } from '@/styles/global';
import { useTimeframe } from '@/context/TimeframeContext';
import MoodLineChart from './MoodLineChart';
import MoodTrendExpanded from './MoodTrendExpanded';
import MoodTrendReadout from './MoodTrendReadout';
import { TrendLegend } from './MoodTrendLegend';
import { useMoodTrendData } from './useMoodTrendData';
import { type Timeframe } from './transforms/windowHelpers';

/**
 * MoodTrendChart — the Statistics screen's headline chart: the raw daily-average
 * line plus a centred moving-average overlay, drawn by our OWN SVG primitive
 * (MoodLineChart). It replaced react-native-chart-kit, whose flat single-colour
 * bezier was the "not bright enough / I can't see the differences" complaint.
 *
 * Interaction:
 *  - press and HOLD to scrub: the cursor snaps to real days and the bubble shows
 *    that day's average plus its most recent entry.
 *  - TAP (or the expand button) to open the full-screen version.
 *
 * The card always uses the fixed 0–10 scale so one period's card is comparable
 * with another's at a glance; the "Fit" zoom lives ONLY in the expanded view,
 * where the user has explicitly asked for a closer look.
 */

/** Card plot height. Taller than the old 220 — the axis labels need the room. */
const CARD_CHART_HEIGHT = 240;
/**
 * Keeps the expand button clear of InfoBubble, which is absolutely positioned
 * at the card's top-right (32px button at inset 4 — see components/InfoBubble).
 */
const INFO_BUBBLE_RESERVE = 40;

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
  const { timeframe, periodLabel } = useTimeframe();
  const tf = timeframe as Timeframe;
  const data = useMoodTrendData();
  const [expanded, setExpanded] = useState(false);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        titleRow: {
          flexDirection: 'row',
          alignItems: 'center',
          marginBottom: 12,
          // Room for the InfoBubble that floats over the card's top-right.
          paddingRight: INFO_BUBBLE_RESERVE,
        },
        title: {
          fontSize: 18,
          fontWeight: '600',
          color: colors.text,
          flex: 1,
        },
        expandButton: {
          width: 36,
          height: 36,
          borderRadius: 18,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.overlays.tag,
        },
        hint: {
          color: colors.textSecondary,
          fontSize: 12,
          textAlign: 'center',
          marginTop: 6,
        },
        message: {
          color: colors.textSecondary,
          textAlign: 'center',
          padding: 20,
        },
      }),
    [colors],
  );

  const openExpanded = useCallback(() => setExpanded(true), []);
  const closeExpanded = useCallback(() => setExpanded(false), []);

  const xLabelFor = useCallback(
    (index: number) => data.labels[index] ?? '',
    [data.labels],
  );

  const tooltip = useCallback(
    (index: number) => {
      const point = data.series[index];
      if (!point) return null;
      return (
        <MoodTrendReadout
          day={point.date}
          average={point.value}
          entry={data.latestEntries.get(point.date) ?? null}
        />
      );
    },
    [data.series, data.latestEntries],
  );

  const title = titleFor(tf);

  const header = (
    <View style={styles.titleRow}>
      <Text style={styles.title}>{title}</Text>
      {!data.loading && !data.isEmpty && (
        <Pressable
          onPress={openExpanded}
          style={styles.expandButton}
          testID="mood-trend-expand"
          accessibilityRole="button"
          accessibilityLabel="Expand mood trend chart"
        >
          <Ionicons name="expand-outline" size={18} color={colors.text} />
        </Pressable>
      )}
    </View>
  );

  if (data.loading) {
    return (
      <Card>
        {header}
        <Text style={styles.message}>Loading data...</Text>
      </Card>
    );
  }

  if (data.isEmpty) {
    return (
      <Card>
        {header}
        <Text style={styles.message}>No data available for this time period.</Text>
      </Card>
    );
  }

  return (
    <Card>
      <InfoBubble
        text="Your daily average mood over the selected timeframe, on the full 0–10 scale. Press and hold the chart to see any day's mood and the entry behind it; tap it for a bigger version with a zoomed scale. When the window is long enough, a dashed moving-average line smooths out the day-to-day noise so you can see the underlying trend."
        position="top-right"
      />
      {header}
      <MoodLineChart
        testID="mood-trend-chart"
        series={data.series}
        overlay={data.overlay}
        height={CARD_CHART_HEIGHT}
        domain="fixed"
        xLabelFor={xLabelFor}
        onPress={openExpanded}
        tooltip={tooltip}
      />
      <TrendLegend maWindow={data.maWindow} />
      <Text style={styles.hint}>Hold to inspect a day · tap to expand</Text>

      <MoodTrendExpanded
        visible={expanded}
        onClose={closeExpanded}
        title={title}
        periodLabel={periodLabel}
        data={data}
      />
    </Card>
  );
};

export default MoodTrendChart;
