import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { Calendar, type DateData } from 'react-native-calendars';
import { useSQLiteContext } from 'expo-sqlite';

import { Card } from '@/components/Card';
import { ActivityIcon } from '@/components/activityIcon';
import { OverlayModal } from '@/components/OverlayModal';
import { useDataRefresh } from '@/hooks/useDataRefresh';
import { ThemeColors, useThemeColors } from '@/styles/global';
import { Activity } from '@/components/types';
import { getActivities } from '@/databases/activities';

import {
  WEEKLY_MOOD_AVERAGES,
  ENTRIES_FOR_ACTIVITY_IN_RANGE,
  ACTIVITY_CORRELATION,
} from './queries';
import { dailyAverageRows } from './transforms/dailyAverages';
import {
  buildCalendarMarkers,
  mergeActivityDots,
  type MarkedDates,
  type CalendarMarkerColors,
} from './transforms/calendarMarkers';
import { activityDaySet } from './transforms/activityDays';
import {
  monthKey,
  monthWindowBounds,
  monthCurrentString,
  visibleMonthOf,
  type VisibleMonth,
} from './transforms/monthWindow';
import { startOfLocalDay, endOfLocalDay } from './transforms/dateHelpers';
import {
  dayEntriesSummary,
  type CorrelationRow,
  type DaySummary,
} from './transforms/daySummary';

// Semantic day-number colors used ON a mood marker (like the calendar's own
// selectedDayTextColor / the heatmap's on-square text). NOT a mood palette —
// buildCalendarMarkers picks between them per day by the marker's luminance so
// the number reads in every theme (dark markers -> white, light -> near-black).
const ON_DARK_MARKER_TEXT = '#FFFFFF';
const ON_LIGHT_MARKER_TEXT = '#1A1A1A';
// On-accent text/icon color for a selected filter chip (matches the app's other
// accent buttons, which all use white on the accent).
const ON_ACCENT = '#FFFFFF';

/**
 * Mood Calendar — a real month view of your moods.
 *
 * - Navigate months (react-native-calendars arrows -> onMonthChange); each
 *   visible month loads its own rows (previous markers stay rendered while the
 *   new month loads, so it never blanks).
 * - Each day is colored by that day's average mood via the app's canonical mood
 *   scale (buildCalendarMarkers, theme-aware).
 * - An activity filter chip row: pick an activity to see a small dot on every
 *   day it was logged, on TOP of the mood coloring. "All" clears the filter.
 * - Tap a day for a compact summary of that day's entries (via the in-tree
 *   OverlayModal — never a native <Modal>, which is broken on this Fabric build).
 *
 * DATE DOCTRINE: SQL only range-filters raw UTC instants (monthWindowBounds);
 * all day-keying is JS (dailyAverageRows / activityDaySet / localDateString).
 */
const MoodCalendar = () => {
  const db = useSQLiteContext();
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [activities, setActivities] = useState<Activity[]>([]);
  const [selectedActivityId, setSelectedActivityId] = useState<number | null>(null);
  const [visibleMonth, setVisibleMonth] = useState<VisibleMonth>(() => visibleMonthOf());

  // Per-month RAW rows (theme-independent), so a theme switch re-styles markers
  // WITHOUT re-querying, and navigating back to a visited month is instant.
  // Keyed `YYYY-MM`. Markers are BUILT from these in the memo below.
  const [moodRowsByMonth, setMoodRowsByMonth] = useState<
    Record<string, { date: string; avgMood: number }[]>
  >({});
  // Per (month, activity) list of LOCAL day strings that carry a dot. Keyed
  // `YYYY-MM|<activityId>`.
  const [activityDaysByKey, setActivityDaysByKey] = useState<Record<string, string[]>>({});

  // The pressed day's summary (null = overlay closed).
  const [daySummary, setDaySummary] = useState<DaySummary | null>(null);

  const markerColors: CalendarMarkerColors = useMemo(
    () => ({
      accent: colors.accent,
      cardBackground: colors.cardBackground,
      onDark: ON_DARK_MARKER_TEXT,
      onLight: ON_LIGHT_MARKER_TEXT,
    }),
    [colors.accent, colors.cardBackground],
  );

  // Accumulate markers from every loaded month (date-string keys are unique
  // across months) and, when an activity is selected, merge its dot layer.
  const markedDates = useMemo<MarkedDates>(() => {
    const base: MarkedDates = {};
    for (const key of Object.keys(moodRowsByMonth)) {
      Object.assign(base, buildCalendarMarkers(moodRowsByMonth[key], markerColors));
    }
    if (selectedActivityId == null) return base;
    const suffix = `|${selectedActivityId}`;
    const dotDays: string[] = [];
    for (const key of Object.keys(activityDaysByKey)) {
      if (key.endsWith(suffix)) dotDays.push(...activityDaysByKey[key]);
    }
    // Dot color contrasts each marker (derived from its number color); a bare
    // dot day (no mood marker) falls back to the plain-card text color.
    return mergeActivityDots(base, dotDays, colors.text);
  }, [moodRowsByMonth, activityDaysByKey, selectedActivityId, markerColors, colors.text]);

  // ── Loaders ────────────────────────────────────────────────────────────────
  const loadActivities = useCallback(() => {
    let active = true;
    (async () => {
      try {
        const list = await getActivities(db);
        if (active) setActivities(list);
      } catch (e) {
        console.error('MoodCalendar: activities load failed', e);
      }
    })();
    return () => {
      active = false;
    };
  }, [db]);
  useDataRefresh(loadActivities, [db]);

  // Load the visible month's mood rows (+ the selected activity's dot days).
  // Always re-queries and OVERWRITES the cache for the visible month, so the old
  // markers stay on screen until the fresh data resolves (no blank). extraDeps
  // includes month + activity, so user navigation / selection re-runs this; a
  // harmless double-fire on those user actions is idempotent (same cache keys).
  const loadCalendarData = useCallback(() => {
    let active = true;
    const month = visibleMonth;
    const activityId = selectedActivityId;
    const key = monthKey(month);
    const { start, end } = monthWindowBounds(month);
    (async () => {
      try {
        const raw = await db.getAllAsync<{ date: string; mood: number }>(
          WEEKLY_MOOD_AVERAGES,
          [start, end],
        );
        if (!active) return;
        setMoodRowsByMonth((prev) => ({ ...prev, [key]: dailyAverageRows(raw) }));
      } catch (e) {
        console.error('MoodCalendar: mood load failed', e);
      }
      if (activityId != null) {
        try {
          const rawAct = await db.getAllAsync<{ date: string }>(
            ENTRIES_FOR_ACTIVITY_IN_RANGE,
            [activityId, start, end],
          );
          if (!active) return;
          setActivityDaysByKey((prev) => ({
            ...prev,
            [`${key}|${activityId}`]: [...activityDaySet(rawAct)],
          }));
        } catch (e) {
          console.error('MoodCalendar: activity-day load failed', e);
        }
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps mirror useDataRefresh's extraDeps
  }, [db, visibleMonth, selectedActivityId]);
  useDataRefresh(loadCalendarData, [db, monthKey(visibleMonth), selectedActivityId]);

  // ── Day-press summary ────────────────────────────────────────────────────
  const openDay = useCallback(
    (day: DateData) => {
      const dayKey = day.dateString; // "YYYY-MM-DD" local calendar day
      // Local-parse (T00:00:00, no Z) so the window is this LOCAL day in every
      // timezone; startOfLocalDay('YYYY-MM-DD') alone would parse as UTC.
      const anchor = new Date(`${dayKey}T00:00:00`);
      const start = startOfLocalDay(anchor);
      const end = endOfLocalDay(anchor);
      (async () => {
        try {
          const rows = await db.getAllAsync<CorrelationRow>(ACTIVITY_CORRELATION, [
            start,
            end,
          ]);
          setDaySummary(dayEntriesSummary(rows, dayKey));
        } catch (e) {
          console.error('MoodCalendar: day summary load failed', e);
          setDaySummary({ day: dayKey, count: 0, avgMood: null, entries: [] });
        }
      })();
    },
    [db],
  );

  const calendarTheme = useMemo(
    () => ({
      backgroundColor: colors.cardBackground,
      calendarBackground: colors.cardBackground,
      textSectionTitleColor: colors.textSecondary,
      monthTextColor: colors.text,
      dayTextColor: colors.text,
      textDisabledColor: colors.textSecondary,
      todayTextColor: colors.accent,
      arrowColor: colors.accent,
      textDayFontWeight: '500' as const,
      textMonthFontWeight: '700' as const,
    }),
    [colors],
  );

  return (
    <Card>
      <Text style={styles.title}>Mood Calendar</Text>
      <Text style={styles.subtitle}>
        {activities.length > 0
          ? 'Each day is colored by your average mood. Pick an activity to dot the days you logged it. Tap a day for details.'
          : 'Each day is colored by your average mood. Tap a day for details.'}
      </Text>

      {activities.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
          style={styles.chipScroll}
        >
          <FilterChip
            label="All"
            selected={selectedActivityId == null}
            onPress={() => setSelectedActivityId(null)}
            icon={
              <Feather
                name="grid"
                size={15}
                color={selectedActivityId == null ? ON_ACCENT : colors.text}
              />
            }
            styles={styles}
          />
          {activities.map((a) => {
            const isSel = selectedActivityId === a.id;
            return (
              <FilterChip
                key={a.id}
                label={a.name}
                selected={isSel}
                onPress={() =>
                  setSelectedActivityId((prev) => (prev === a.id ? null : a.id))
                }
                icon={
                  <ActivityIcon
                    iconName={a.icon_name}
                    iconFamily={a.icon_family}
                    color={isSel ? ON_ACCENT : colors.text}
                    size={15}
                  />
                }
                styles={styles}
              />
            );
          })}
        </ScrollView>
      )}

      <Calendar
        // Initial month only — the calendar owns navigation and reports it via
        // onMonthChange; passing a live `current` would fight its arrows.
        current={INITIAL_MONTH}
        firstDay={1}
        markingType="custom"
        markedDates={markedDates}
        onMonthChange={(m) => setVisibleMonth({ year: m.year, month: m.month })}
        onDayPress={openDay}
        theme={calendarTheme}
        style={styles.calendar}
      />

      <OverlayModal visible={daySummary !== null} onClose={() => setDaySummary(null)}>
        {daySummary && (
          <DaySummaryCard
            summary={daySummary}
            onClose={() => setDaySummary(null)}
            styles={styles}
            colors={colors}
          />
        )}
      </OverlayModal>
    </Card>
  );
};

// Computed once at module load — the calendar's initial month. Navigation from
// here is internal to the library; visibleMonth state tracks it for data loads.
const INITIAL_MONTH = monthCurrentString(visibleMonthOf());

type Styles = ReturnType<typeof makeStyles>;

const FilterChip = ({
  label,
  selected,
  onPress,
  icon,
  styles,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  icon: React.ReactNode;
  styles: Styles;
}) => (
  <Pressable
    onPress={onPress}
    accessibilityRole="button"
    accessibilityState={{ selected }}
    accessibilityLabel={`Filter by ${label}`}
    style={({ pressed }) => [
      styles.chip,
      selected && styles.chipSelected,
      pressed && styles.chipPressed,
    ]}
  >
    {icon}
    <Text
      style={[styles.chipLabel, selected && styles.chipLabelSelected]}
      numberOfLines={1}
    >
      {label}
    </Text>
  </Pressable>
);

const formatDayHeading = (dayKey: string): string => {
  // Local-parse so the weekday/date is the user's, not UTC's.
  const d = new Date(`${dayKey}T00:00:00`);
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
};

const formatTime = (instant: string): string =>
  new Date(instant).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });

const DaySummaryCard = ({
  summary,
  onClose,
  styles,
  colors,
}: {
  summary: DaySummary;
  onClose: () => void;
  styles: Styles;
  colors: ThemeColors;
}) => (
  <View style={styles.summaryCard}>
    <View style={styles.summaryHeader}>
      <View style={styles.summaryHeaderText}>
        <Text style={styles.summaryDate}>{formatDayHeading(summary.day)}</Text>
        <Text style={styles.summaryMeta}>
          {summary.count === 0
            ? 'No entries this day'
            : `${summary.count} ${summary.count === 1 ? 'entry' : 'entries'}` +
              (summary.avgMood !== null ? ` · avg mood ${summary.avgMood}` : '')}
        </Text>
      </View>
      <Pressable
        onPress={onClose}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Close day details"
        style={styles.summaryClose}
      >
        <Feather name="x" size={22} color={colors.text} />
      </Pressable>
    </View>

    {summary.count === 0 ? (
      <View style={styles.summaryEmpty}>
        <Feather name="calendar" size={26} color={colors.textSecondary} />
        <Text style={styles.summaryEmptyText}>Nothing logged on this day.</Text>
      </View>
    ) : (
      <ScrollView style={styles.summaryList} contentContainerStyle={styles.summaryListContent}>
        {summary.entries.map((entry) => (
          <View key={entry.id} style={styles.summaryRow}>
            <View style={styles.summaryMoodPill}>
              <Text style={styles.summaryMoodValue}>{entry.mood}</Text>
            </View>
            <View style={styles.summaryRowBody}>
              <Text style={styles.summaryTime}>{formatTime(entry.instant)}</Text>
              {entry.activities.length > 0 && (
                <Text style={styles.summaryActivities} numberOfLines={2}>
                  {entry.activities.join(' · ')}
                </Text>
              )}
            </View>
          </View>
        ))}
      </ScrollView>
    )}
  </View>
);

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
      marginBottom: 12,
      lineHeight: 19,
    },
    chipScroll: {
      marginBottom: 12,
      marginHorizontal: -4,
    },
    chipRow: {
      gap: 8,
      paddingHorizontal: 4,
      paddingVertical: 2,
    },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.overlays.tagBorder,
      backgroundColor: colors.overlays.tag,
    },
    chipSelected: {
      backgroundColor: colors.accent,
      borderColor: colors.accent,
    },
    chipPressed: {
      opacity: 0.7,
    },
    chipLabel: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.text,
      maxWidth: 140,
    },
    chipLabelSelected: {
      color: ON_ACCENT,
    },
    calendar: {
      borderRadius: 16,
      backgroundColor: colors.cardBackground,
    },
    // ── Day-summary overlay card ─────────────────────────────────────────
    summaryCard: {
      backgroundColor: colors.cardBackground,
      width: '90%',
      maxWidth: 420,
      maxHeight: '80%',
      borderRadius: 20,
      padding: 20,
      borderWidth: 1,
      borderColor: colors.border,
    },
    summaryHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 12,
      marginBottom: 12,
    },
    summaryHeaderText: {
      flex: 1,
    },
    summaryDate: {
      fontSize: 17,
      fontWeight: '700',
      color: colors.text,
    },
    summaryMeta: {
      fontSize: 13,
      color: colors.textSecondary,
      marginTop: 3,
    },
    summaryClose: {
      padding: 2,
    },
    summaryEmpty: {
      alignItems: 'center',
      gap: 10,
      paddingVertical: 24,
    },
    summaryEmptyText: {
      fontSize: 14,
      color: colors.textSecondary,
    },
    summaryList: {
      flexGrow: 0,
    },
    summaryListContent: {
      gap: 10,
    },
    summaryRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    summaryMoodPill: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accentLight,
    },
    summaryMoodValue: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.accent,
    },
    summaryRowBody: {
      flex: 1,
    },
    summaryTime: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.text,
    },
    summaryActivities: {
      fontSize: 13,
      color: colors.textSecondary,
      marginTop: 2,
    },
  });

export default MoodCalendar;
