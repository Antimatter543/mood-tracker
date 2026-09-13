import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  ReactNode,
} from 'react';
import { useSQLiteContext } from 'expo-sqlite';

import { useDataRefresh } from '@/hooks/useDataRefresh';
import { EARLIEST_ENTRY_DATE } from '@/components/visualisations/queries';
import { localDateString } from '@/components/visualisations/transforms/dateHelpers';
import {
  canStepBack,
  canStepForward,
  clampOffset,
  computeCustomWindow,
  computePeriodWindow,
  dayCountInclusive,
  formatDayRangeLabel,
  formatPeriodLabel,
  granularityForDays,
  normaliseCustomRange,
  PERIOD_LENGTH_DAYS,
  todayLocalDay,
  type DayRange,
  type PeriodWindow,
  type Timeframe,
} from '@/components/visualisations/transforms/periodWindow';

export type { Timeframe, DayRange };

// Helper function to get SQL date condition string based on timeframe.
//
// DEPRECATED — these strings are UTC-anchored (`date('now')`), which mis-buckets
// late-evening entries for users east/west of UTC, and they cannot express a
// period offset at all. Use `periodWindow` on this context (see periodWindow.ts).
// No live chart uses this; kept only until the last caller is confirmed gone.
export const getTimeframeCondition = (timeframe: Timeframe): string => {
  switch (timeframe) {
    case 'week':
      return "date >= date('now', '-7 days')";
    case 'month':
      return "date >= date('now', '-1 month')";
    case '3months':
      return "date >= date('now', '-3 months')";
    case 'year':
      return "date >= date('now', '-1 year')";
    case 'alltime':
    default:
      return "1=1"; // No time restriction
  }
};

// Readable name for the period LENGTH. The header shows the concrete date range
// (`periodLabel`) instead, because that's the only thing that stays honest once
// the user pages back — but this still names the pill for a11y / fallbacks.
export const getTimeframeDescription = (timeframe: Timeframe): string => {
  switch (timeframe) {
    case 'week':
      return "Past 7 days";
    case 'month':
      return "Past month";
    case '3months':
      return "Past 3 months";
    case 'year':
      return "Past year";
    case 'alltime':
      return "All time";
  }
};

interface TimeframeContextType {
  /**
   * The period LENGTH the screen is reading at.
   *
   * With a preset selected this is that preset. With a CUSTOM RANGE active it is
   * the preset whose length the range most resembles (`granularityForDays`) —
   * i.e. it is the charts' GRANULARITY descriptor, not a claim about which pill
   * is lit. That is deliberate: it lets every length-sensitive chart policy
   * (x-axis label density, moving-average width, titles) stay correct for an
   * arbitrary range without growing a 'custom' branch of its own. Anything that
   * needs to know whether the user picked dates must read `isCustom`, and
   * anything that needs a day count must read `windowDayCount` — never infer
   * either from this field.
   */
  timeframe: Timeframe;
  /**
   * Sets the period LENGTH. Always returns the user to the present (offset 0)
   * and clears any custom range — picking a pill means "show me this preset".
   */
  setTimeframe: (timeframe: Timeframe) => void;
  /** Which period of that length: 0 = current, -1 = the one before, … Never > 0. */
  offset: number;
  /** Step one period into the past. No-ops once there's no data further back. */
  goBack: () => void;
  /** Step one period toward the present. No-ops at offset 0 — never the future. */
  goForward: () => void;
  /**
   * Jump straight back to the current period: offset 0 AND no custom range.
   * The one escape hatch out of "you are looking at the past", whichever way
   * the user got there.
   */
  resetOffset: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
  /** THE window every timeframe-scoped chart on the screen must query with. */
  periodWindow: PeriodWindow;
  /** Concrete range for the header, e.g. "Aug 23 – 29" / "Jun – Aug 2026". */
  periodLabel: string;
  /** Local `YYYY-MM-DD` of the user's first ever entry; null while unknown. */
  earliestEntryDay: string | null;
  /** The user's hand-picked inclusive day range, or null when a preset is active. */
  customRange: DayRange | null;
  /** True while `customRange` is driving the window (no pill is lit, no paging). */
  isCustom: boolean;
  /**
   * Switch to an arbitrary inclusive local-day range (`YYYY-MM-DD`). Order
   * doesn't matter; a future end is clamped to today; an unusable pair is
   * ignored rather than throwing the screen into a bogus window.
   */
  setCustomRange: (startDay: string, endDay: string) => void;
  /**
   * REAL inclusive day count of `periodWindow` — the only honest denominator for
   * anything "per day" (the consistency KPI). Never derive this from
   * `timeframe`: a custom range's length is whatever the user picked, and
   * 'alltime' has no fixed length at all.
   */
  windowDayCount: number;
  /**
   * Does the window end TODAY? The precondition for any statistic that is a
   * claim about the present (the live logging streak). Strictly better than
   * `offset === 0`, which is blind to a custom range ending in the past.
   */
  isCurrentPeriod: boolean;
  timeframeCondition: string;
  timeframeDescription: string;
}

const DEFAULT_TIMEFRAME: Timeframe = 'month';

const TimeframeContext = createContext<TimeframeContextType>({
  timeframe: DEFAULT_TIMEFRAME,
  setTimeframe: () => {},
  offset: 0,
  goBack: () => {},
  goForward: () => {},
  resetOffset: () => {},
  canGoBack: false,
  canGoForward: false,
  periodWindow: computePeriodWindow(DEFAULT_TIMEFRAME, 0, todayLocalDay()),
  periodLabel: formatPeriodLabel(DEFAULT_TIMEFRAME, 0, todayLocalDay()),
  earliestEntryDay: null,
  customRange: null,
  isCustom: false,
  setCustomRange: () => {},
  windowDayCount: PERIOD_LENGTH_DAYS.month,
  isCurrentPeriod: true,
  timeframeCondition: getTimeframeCondition(DEFAULT_TIMEFRAME),
  timeframeDescription: getTimeframeDescription(DEFAULT_TIMEFRAME),
});

export const TimeframeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const db = useSQLiteContext();
  // The PILL the user picked. Stays put while a custom range is active so
  // clearing the range returns them to the preset they were on, and so the
  // paging bounds below never have to reason about a custom window.
  const [presetTimeframe, setPresetTimeframe] = useState<Timeframe>(DEFAULT_TIMEFRAME);
  const [offset, setOffset] = useState(0);
  const [earliestEntryDay, setEarliestEntryDay] = useState<string | null>(null);
  // Non-null = custom mode. Only ever set through `normaliseCustomRange`, so an
  // invalid or reversed pair can never reach the charts.
  const [customRange, setCustomRangeState] = useState<DayRange | null>(null);

  // Re-read every render rather than freezing at mount: a session left open
  // across local midnight should re-anchor "now" on its next render, not keep
  // paging relative to yesterday. It's a value-equal string, so the memos below
  // still only recompute when the day actually rolls over.
  const today = todayLocalDay();

  // The back-bound. One cheap indexed MIN over `entries`, refreshed on the same
  // focus/data-version signal as the charts so an import or a backdated entry
  // opens up the history it just created.
  const loadEarliestEntry = useCallback(() => {
    let active = true;
    db.getFirstAsync<{ date: string | null }>(EARLIEST_ENTRY_DATE)
      .then((row) => {
        if (!active) return;
        setEarliestEntryDay(row?.date ? localDateString(row.date) : null);
      })
      .catch(() => {
        // Leaving it null means "unknown", which keeps back-navigation OPEN.
        // Better to let the user page into an empty period than to lock the
        // feature out entirely because one query failed.
        if (active) setEarliestEntryDay(null);
      });
    return () => {
      active = false;
    };
  }, [db]);
  useDataRefresh(loadEarliestEntry, [db]);

  // Changing the period LENGTH returns to the present. Paging back five weeks
  // and then tapping "Year" has no obvious "five years back" reading, so the
  // least surprising answer is the current period of the new length.
  const setTimeframe = useCallback((next: Timeframe) => {
    setPresetTimeframe(next);
    setOffset(0);
    // Tapping a pill is an unambiguous "show me this preset instead".
    setCustomRangeState(null);
  }, []);

  const setCustomRange = useCallback(
    (startDay: string, endDay: string) => {
      const range = normaliseCustomRange(startDay, endDay, today);
      // An unusable pair (malformed day, or both ends in the future) is dropped:
      // the screen keeps showing the window it was already showing, which is far
      // better than an empty or inverted one under a confident label.
      if (!range) return;
      setCustomRangeState(range);
      // A custom range has no paging, so leaving a stale offset behind would let
      // it silently apply again the moment the range is cleared.
      setOffset(0);
    },
    [today],
  );

  const goBack = useCallback(() => {
    setOffset((current) =>
      canStepBack(presetTimeframe, current, earliestEntryDay, today) ? current - 1 : current,
    );
  }, [presetTimeframe, earliestEntryDay, today]);

  const goForward = useCallback(() => {
    setOffset((current) =>
      canStepForward(presetTimeframe, current) ? current + 1 : current,
    );
  }, [presetTimeframe]);

  const resetOffset = useCallback(() => {
    setOffset(0);
    setCustomRangeState(null);
  }, []);

  // The earliest-entry query resolves AFTER first paint, so an offset that was
  // legal under "unknown" can become illegal a moment later. Snap it back
  // instead of stranding the user on a window with nothing behind it.
  useEffect(() => {
    setOffset((current) => clampOffset(presetTimeframe, current, earliestEntryDay, today));
  }, [presetTimeframe, earliestEntryDay, today]);

  // Memoised so the object identity is stable per (timeframe, offset, day) —
  // the charts put `periodWindow` in their reload deps, and a fresh object every
  // render would refetch the whole screen on every parent re-render.
  const periodWindow = useMemo(
    () =>
      customRange
        ? computeCustomWindow(customRange)
        : computePeriodWindow(presetTimeframe, offset, today),
    [customRange, presetTimeframe, offset, today],
  );
  const periodLabel = useMemo(
    () =>
      customRange
        ? // Always DAY granularity: the user named two exact dates, so collapsing
          // them to months would stop describing what they actually picked.
          formatDayRangeLabel(customRange, today, 'day')
        : formatPeriodLabel(presetTimeframe, offset, today),
    [customRange, presetTimeframe, offset, today],
  );

  // The real inclusive length of whatever window is active. For a bounded preset
  // this is exactly PERIOD_LENGTH_DAYS[preset] (periodDayRange builds windows of
  // precisely that many days); 'alltime' is the one case with no length of its
  // own, so it is measured from the user's first entry — and falls back to a
  // year while that query is still in flight, rather than to the epoch, which
  // would divide the consistency KPI by ~20,000 days and read as 0%.
  const windowDayCount = useMemo(() => {
    if (!customRange && presetTimeframe === 'alltime') {
      return earliestEntryDay
        ? dayCountInclusive({ startDay: earliestEntryDay, endDay: today })
        : PERIOD_LENGTH_DAYS.year;
    }
    return dayCountInclusive(periodWindow);
  }, [customRange, presetTimeframe, earliestEntryDay, today, periodWindow]);

  // In custom mode `timeframe` reports the LENGTH-equivalent preset, so every
  // length-sensitive chart policy keeps working on an arbitrary range. See the
  // field's doc comment on TimeframeContextType.
  const timeframe: Timeframe = customRange
    ? granularityForDays(windowDayCount)
    : presetTimeframe;

  const contextValue = useMemo<TimeframeContextType>(
    () => ({
      timeframe,
      setTimeframe,
      offset,
      goBack,
      goForward,
      resetOffset,
      // Paging is a PRESET concept — see the CUSTOM RANGES note in
      // periodWindow.ts for why a custom range has no next/previous.
      canGoBack: !customRange && canStepBack(presetTimeframe, offset, earliestEntryDay, today),
      canGoForward: !customRange && canStepForward(presetTimeframe, offset),
      periodWindow,
      periodLabel,
      earliestEntryDay,
      customRange,
      isCustom: customRange !== null,
      setCustomRange,
      windowDayCount,
      isCurrentPeriod: periodWindow.endDay === today,
      timeframeCondition: getTimeframeCondition(timeframe),
      timeframeDescription: getTimeframeDescription(timeframe),
    }),
    [
      timeframe,
      presetTimeframe,
      setTimeframe,
      offset,
      goBack,
      goForward,
      resetOffset,
      earliestEntryDay,
      today,
      periodWindow,
      periodLabel,
      customRange,
      setCustomRange,
      windowDayCount,
    ],
  );

  return (
    <TimeframeContext.Provider value={contextValue}>
      {children}
    </TimeframeContext.Provider>
  );
};

export const useTimeframe = () => useContext(TimeframeContext);
