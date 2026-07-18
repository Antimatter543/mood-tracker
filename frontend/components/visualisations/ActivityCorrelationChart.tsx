import { useCallback, useState, useMemo, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Svg, Rect } from 'react-native-svg';
import { useSQLiteContext } from 'expo-sqlite';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useDataRefresh } from '@/hooks/useDataRefresh';
import { useThemeColors } from '@/styles/global';
import type { ThemeColors } from '@/styles/global';
import { Card } from '@/components/Card';
import InfoBubble from '../InfoBubble';
import { useTimeframe } from '@/context/TimeframeContext';
import { useSettings } from '@/context/SettingsContext';
import { getSetting, updateSetting } from '@/databases/user-settings';
import { ACTIVITY_CORRELATION } from './queries';
import { computeWindow, type Timeframe } from './transforms/windowHelpers';
import {
  computeActivityCorrelation,
  aggregateActivityCorrelation,
  carryoverQueryBounds,
  selectCorrelationView,
  parseExcludedActivities,
  serializeExcludedActivities,
  type ActivityCorrelationRawRow,
  type ActivityCorrelationResult,
} from './transforms/activityCorrelation';

const BAR_HEIGHT = 12;
const MAX_MOOD = 10;
const MIN_MEANINGFUL_ITEMS = 2;

/** Chart-local setting key — deliberately NOT in SETTINGS_REGISTRY (it is not a
 *  user-facing Settings row; it is per-chart state stored as a JSON string array). */
const EXCLUDED_KEY = 'activity_correlation_excluded';

type Styles = ReturnType<typeof makeStyles>;

/** A single activity's with/without bar block. Extracted so the positive and
 *  negative sections share one renderer instead of duplicating the bar JSX. */
const CorrelationRow = ({
  item,
  colors,
  styles,
  svgW,
  positiveColor,
  negativeColor,
  carryover,
  onLayout,
  onExclude,
}: {
  item: ActivityCorrelationResult;
  colors: ThemeColors;
  styles: Styles;
  svgW: number;
  positiveColor: string;
  negativeColor: string;
  carryover: boolean;
  onLayout: (width: number) => void;
  onExclude: (name: string) => void;
}) => {
  const withW = (item.avg_with / MAX_MOOD) * svgW;
  const withoutW = (item.avg_without / MAX_MOOD) * svgW;
  const deltaPositive = item.delta >= 0;
  return (
    <View style={styles.row}>
      <View style={styles.rowHeader}>
        <View style={styles.nameWrap}>
          <Text style={styles.activityName}>{item.activity_name}</Text>
        </View>
        <View style={styles.rowHeaderRight}>
          <Text
            style={[
              styles.delta,
              { color: deltaPositive ? positiveColor : negativeColor },
            ]}
          >
            {deltaPositive ? '+' : ''}
            {item.delta.toFixed(1)}
          </Text>
          <Pressable
            onPress={() => onExclude(item.activity_name)}
            hitSlop={10}
            style={styles.excludeButton}
            accessibilityRole="button"
            accessibilityLabel={`Hide ${item.activity_name} from correlation`}
          >
            <Ionicons name="eye-off-outline" size={16} color={colors.textSecondary} />
          </Pressable>
        </View>
      </View>

      <View
        style={styles.barBlock}
        onLayout={(e) => onLayout(e.nativeEvent.layout.width)}
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
        {carryover
          ? `n ≈ ${Math.round(item.count_with)} with / ${Math.round(item.count_without)} without`
          : `n = ${item.count_with} with / ${item.count_without} without`}
      </Text>
    </View>
  );
};

const ActivityCorrelationChart = () => {
  const colors = useThemeColors();
  const db = useSQLiteContext();
  const { timeframe } = useTimeframe();
  const { settings } = useSettings();
  const carryover = settings.activity_carryover;
  const [meaningful, setMeaningful] = useState<ActivityCorrelationResult[]>([]);
  const [barWidth, setBarWidth] = useState(0);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [showHidden, setShowHidden] = useState(false);

  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Load the persisted excluded list once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await getSetting(db, EXCLUDED_KEY);
        if (!cancelled) setExcluded(parseExcludedActivities(raw));
      } catch (error) {
        console.error('Error loading excluded activities:', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [db]);

  const persistExcluded = useCallback(
    (next: string[]) => {
      setExcluded(next);
      updateSetting(db, EXCLUDED_KEY, serializeExcludedActivities(next)).catch(
        (error) => console.error('Error saving excluded activities:', error),
      );
    },
    [db],
  );

  const handleExclude = useCallback(
    (name: string) => {
      if (excluded.includes(name)) return;
      persistExcluded([...excluded, name]);
    },
    [excluded, persistExcluded],
  );

  const handleRestore = useCallback(
    (name: string) => {
      persistExcluded(excluded.filter((n) => n !== name));
    },
    [excluded, persistExcluded],
  );

  const fetchData = useCallback(async () => {
      try {
        // Parameterised local-time window (?start, ?end) — NOT the UTC-anchored
        // timeframeCondition string the old delta-from-mean chart used. With
        // carryover ON the query lower bound is pulled 36h earlier so activities
        // logged just before the window can decay forward into it; windowStart
        // marks the TRUE start so those earlier rows stay out of the day universe.
        const window = computeWindow(timeframe as Timeframe);
        const { queryStart, queryEnd, windowStart } = carryoverQueryBounds(
          window,
          carryover,
        );
        // Raw joined rows (one per entry×activity) -> day-key + with/without
        // split in JS (the old SQL keyed days with date(e.date) in UTC).
        const rawRows = await db.getAllAsync<ActivityCorrelationRawRow>(
          ACTIVITY_CORRELATION,
          [queryStart, queryEnd],
        );
        const { meaningful: m } = computeActivityCorrelation(
          aggregateActivityCorrelation(rawRows, { carryover, windowStart }),
        );
        setMeaningful(m);
      } catch (error) {
        console.error('Error fetching activity correlation:', error);
        setMeaningful([]);
      }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- query reads db + timeframe + carryover; setState identities are stable
    }, [db, timeframe, carryover]);
  // Focus-aware refetch (replaces useEffect([db, refreshCount, timeframe])).
  useDataRefresh(fetchData, [db, timeframe, carryover]);

  const view = useMemo(
    () => selectCorrelationView(meaningful, { excluded, expanded }),
    [meaningful, excluded, expanded],
  );

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
  const onRowLayout = (w: number) => {
    if (w > 0 && Math.abs(w - barWidth) > 1) setBarWidth(w);
  };

  const renderRow = (item: ActivityCorrelationResult) => (
    <CorrelationRow
      key={item.activity_name}
      item={item}
      colors={colors}
      styles={styles}
      svgW={svgW}
      positiveColor={positiveColor}
      negativeColor={negativeColor}
      carryover={carryover}
      onLayout={onRowLayout}
      onExclude={handleExclude}
    />
  );

  const nothingVisible = view.positive.length === 0 && view.negative.length === 0;

  return (
    <Card>
      <InfoBubble
        text={
          "Compares your average mood on days you logged an activity ('with') against days you didn't ('without'). A positive delta means the activity lines up with better days — and we only show activities with enough days on each side to be meaningful. By default you see the top few that lift and weigh on your mood; tap the eye to hide an activity (the next-strongest takes its place), or expand to see them all." +
          (carryover
            ? " Activity Carryover is on, so an activity also counts toward your later entries and the next day with a fading weight — the 'with' amounts are effective (approximate) counts."
            : '')
        }
        position="top-right"
      />
      <Text style={styles.title}>Activity Correlation</Text>
      <Text style={styles.subtitle}>Average mood with vs. without each activity</Text>

      {nothingVisible ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>
            All activities are hidden. Restore one below.
          </Text>
        </View>
      ) : (
        <>
          {view.positive.length > 0 && (
            <View style={styles.section}>
              <Text style={[styles.sectionLabel, { color: positiveColor }]}>
                Lifts your mood
              </Text>
              {view.positive.map(renderRow)}
            </View>
          )}

          {view.negative.length > 0 && (
            <View style={styles.section}>
              <Text style={[styles.sectionLabel, { color: negativeColor }]}>
                Weighs you down
              </Text>
              {view.negative.map(renderRow)}
            </View>
          )}
        </>
      )}

      {(expanded || view.hiddenByCollapse > 0) && (
        <Pressable
          onPress={() => setExpanded((e) => !e)}
          hitSlop={8}
          style={styles.toggleRow}
          accessibilityRole="button"
          accessibilityLabel={expanded ? 'Show fewer activities' : 'Show all activities'}
        >
          <Text style={styles.toggleText}>
            {expanded ? 'Show less' : `Show all (${view.hiddenByCollapse} more)`}
          </Text>
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={colors.accent}
          />
        </Pressable>
      )}

      {excluded.length > 0 && (
        <View style={styles.hiddenFooter}>
          <Pressable
            onPress={() => setShowHidden((s) => !s)}
            hitSlop={8}
            style={styles.toggleRow}
            accessibilityRole="button"
            accessibilityLabel={
              showHidden ? 'Collapse hidden activities' : 'Show hidden activities'
            }
          >
            <Text style={styles.hiddenLabel}>Hidden activities ({excluded.length})</Text>
            <Ionicons
              name={showHidden ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={colors.textSecondary}
            />
          </Pressable>

          {showHidden && (
            <View style={styles.chipWrap}>
              {excluded.map((name) => (
                <Pressable
                  key={name}
                  onPress={() => handleRestore(name)}
                  hitSlop={6}
                  style={styles.chip}
                  accessibilityRole="button"
                  accessibilityLabel={`Restore ${name} to correlation`}
                >
                  <Text style={styles.chipText}>{name}</Text>
                  <Ionicons name="add" size={14} color={colors.text} />
                </Pressable>
              ))}
            </View>
          )}
        </View>
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
    section: {
      marginBottom: 8,
    },
    sectionLabel: {
      fontSize: 12,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: 10,
    },
    row: {
      marginBottom: 18,
    },
    rowHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 6,
    },
    nameWrap: {
      flex: 1,
      marginRight: 8,
    },
    rowHeaderRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
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
    excludeButton: {
      padding: 2,
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
    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      paddingVertical: 8,
    },
    toggleText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.accent,
    },
    hiddenFooter: {
      marginTop: 4,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.overlays.border,
      paddingTop: 4,
    },
    hiddenLabel: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    chipWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      paddingTop: 4,
      paddingBottom: 8,
    },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: 16,
      backgroundColor: colors.overlays.tag,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.overlays.tagBorder,
    },
    chipText: {
      fontSize: 13,
      color: colors.text,
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

export default ActivityCorrelationChart;
