import { Fragment, useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, LayoutChangeEvent } from 'react-native';
import Svg, { Path, Line, Text as SvgText } from 'react-native-svg';
import { useSQLiteContext } from 'expo-sqlite';
import { useThemeColors } from '@/styles/global';
import { useDataRefresh } from '@/hooks/useDataRefresh';
import { Card } from '@/components/Card';
import InfoBubble from '../InfoBubble';
import { useTimeframe } from '@/context/TimeframeContext';
import { moodColor } from '@/components/timeline/moodColor';
import { DOW_MOOD_PATTERN } from './queries';
import {
  buildDowPatternData,
  aggregateDowRows,
  type DowInstantRow,
  type DowPatternData,
} from './transforms/dayOfWeekPattern';
import { buildBarGeometry } from './transforms/barGeometry';
import { buildGridLines } from './transforms/lineChartGeometry';
import { MOOD_DOMAIN, type ChartDims } from './transforms/chartGeometry';

// Own SVG bar renderer — replaces react-native-chart-kit's BarChart (cramped
// axis, no way to distinguish "no entries" from "mood 0", no theming beyond
// its own config object). All bar/gridline math lives in the pure, tested
// transforms (`barGeometry.ts` / `lineChartGeometry.ts`); this component is a
// thin renderer, matching the pattern MoodWeekChart established.

const CHART_HEIGHT = 220;
// Wider LEFT gutter than right — the y-axis value labels live there.
const PAD_LEFT = 26;
const PAD_RIGHT = 10;
const PAD_TOP = 22; // room for the value label above the tallest bar
const PAD_BOTTOM = 8;
const BAR_RADIUS = 4; // rounded TOP corners only — see topRoundedRectPath
const GRIDLINE_OPACITY = 0.4;
const VALUE_LABEL_FONT_SIZE = 11;
const AXIS_LABEL_FONT_SIZE = 10;
const AXIS_LABEL_GUTTER = 6; // gap between the axis label and the plot's left edge

/**
 * SVG path `d` for a rectangle with rounded TOP corners and a square bottom
 * edge. `react-native-svg`'s `<Rect rx/ry>` rounds all four corners, which
 * reads wrong here: bars sit flush on the baseline, so a rounded bottom would
 * show a visible gap under the bar at the axis. Pure string math (no SVG
 * imports), same family as `chartGeometry.ts`'s `polyline` helper.
 *
 * The radius is clamped to half the bar's smaller dimension so a thin/short
 * bar never produces a self-intersecting or negative-radius path.
 */
const topRoundedRectPath = (x: number, y: number, width: number, height: number, radius: number): string => {
  const r = Math.max(0, Math.min(radius, width / 2, height));
  if (r <= 0) {
    // Degenerate: draw a plain rectangle rather than a malformed rounded path.
    return `M ${x} ${y} H ${x + width} V ${y + height} H ${x} Z`;
  }
  return [
    `M ${x} ${y + r}`,
    `A ${r} ${r} 0 0 1 ${x + r} ${y}`,
    `H ${x + width - r}`,
    `A ${r} ${r} 0 0 1 ${x + width} ${y + r}`,
    `V ${y + height}`,
    `H ${x}`,
    'Z',
  ].join(' ');
};

const DailyMoodChart = () => {
  const colors = useThemeColors();
  const db = useSQLiteContext();
  const { periodWindow } = useTimeframe();
  const [pattern, setPattern] = useState<DowPatternData | null>(null);
  const [width, setWidth] = useState(0);

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
      // Stretch so the measured width is the card's real content width (a
      // styleless wrapper would shrink-wrap — the Yoga law, lessons.md).
      alignSelf: 'stretch',
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

  const fetchData = useCallback(async () => {
      try {
        // Parameterised local-time window (?start, ?end) from the context —
        // it already carries whichever period the header's arrows are on, so
        // this chart follows the user back through history for free.
        const { start, end } = periodWindow;
        // Raw {date: instant, mood} rows -> per-LOCAL-weekday aggregation in JS
        // (the old strftime('%w') extracted the weekday in UTC and drifted).
        const rawRows = await db.getAllAsync<DowInstantRow>(DOW_MOOD_PATTERN, [start, end]);
        // Monday-first to match the heatmap convention used on this screen.
        setPattern(buildDowPatternData(aggregateDowRows(rawRows), 1));
      } catch (error) {
        console.error('Error fetching daily mood data:', error);
        setPattern(null);
      }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- query reads db + periodWindow; setState identities are stable
    }, [db, periodWindow]);
  // Focus-aware refetch (replaces useEffect([db, refreshCount, timeframe])).
  useDataRefresh(fetchData, [db, periodWindow]);

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0 && Math.abs(w - width) > 1) setWidth(w);
  };

  // Memoize dims so downstream geometry doesn't recompute every render (a
  // fresh object literal each render would defeat the useMemo below it).
  const dims: ChartDims = useMemo(
    () => ({
      width: width || 1,
      height: CHART_HEIGHT,
      padX: PAD_LEFT, // fallback for any caller ignoring padLeft/padRight
      padTop: PAD_TOP,
      padBottom: PAD_BOTTOM,
      padLeft: PAD_LEFT,
      padRight: PAD_RIGHT,
    }),
    [width]
  );

  const bars = useMemo(
    () => (pattern ? buildBarGeometry(pattern.avgMood, pattern.entryCount, dims) : []),
    [pattern, dims]
  );
  const gridLines = useMemo(() => buildGridLines(MOOD_DOMAIN, dims), [dims]);

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

  const accent = colors.accent;

  return (
    <Card>
      <InfoBubble
          text="Your average mood aggregated over each day of the week for the selected timeframe — handy for spotting patterns like a recurring midweek dip or a Saturday lift."
          position="top-right"
      />
      <Text style={styles.title}>Average Mood by Day</Text>
      <View style={styles.chartContainer} onLayout={onLayout} testID="daily-mood-bar-chart">
        {width > 0 && (
          <Svg width="100%" height={CHART_HEIGHT}>
            {/* Gridlines across the fixed 0..10 mood domain, with value labels
                in the left gutter reserved by padLeft. */}
            {gridLines.map((line) => (
              <Fragment key={`grid-${line.value}`}>
                <Line
                  x1={PAD_LEFT}
                  x2={width - PAD_RIGHT}
                  y1={line.y}
                  y2={line.y}
                  stroke={colors.border}
                  strokeOpacity={GRIDLINE_OPACITY}
                  strokeWidth={1}
                />
                <SvgText
                  x={PAD_LEFT - AXIS_LABEL_GUTTER}
                  y={line.y}
                  fontSize={AXIS_LABEL_FONT_SIZE}
                  fill={colors.textSecondary}
                  textAnchor="end"
                  alignmentBaseline="middle"
                >
                  {line.label}
                </SvgText>
              </Fragment>
            ))}

            {/* One bar per weekday slot. Empty slots (no entries that day)
                draw NOTHING — a zero-height bar would read as "recorded a
                mood of 0", which is a real, meaningful value on this 0..10
                scale, not the same thing as "no data" (project standing
                rule — see MoodWeekChart's missing-day handling). */}
            {bars.map((bar) =>
              bar.empty ? null : (
                <Fragment key={`bar-${bar.index}`}>
                  <Path
                    d={topRoundedRectPath(bar.x, bar.y, bar.width, bar.height, BAR_RADIUS)}
                    fill={moodColor(bar.value, accent, colors.overlays.tag)}
                  />
                  <SvgText
                    x={bar.x + bar.width / 2}
                    y={bar.y - VALUE_LABEL_FONT_SIZE * 0.4}
                    fontSize={VALUE_LABEL_FONT_SIZE}
                    fill={colors.text}
                    textAnchor="middle"
                  >
                    {bar.value.toFixed(1)}
                  </SvgText>
                </Fragment>
              )
            )}
          </Svg>
        )}
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
