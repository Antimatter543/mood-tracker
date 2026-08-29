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
  computePeriodWindow,
  formatPeriodLabel,
  todayLocalDay,
  type PeriodWindow,
  type Timeframe,
} from '@/components/visualisations/transforms/periodWindow';

export type { Timeframe };

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
  timeframe: Timeframe;
  /** Sets the period LENGTH. Always returns the user to the present (offset 0). */
  setTimeframe: (timeframe: Timeframe) => void;
  /** Which period of that length: 0 = current, -1 = the one before, … Never > 0. */
  offset: number;
  /** Step one period into the past. No-ops once there's no data further back. */
  goBack: () => void;
  /** Step one period toward the present. No-ops at offset 0 — never the future. */
  goForward: () => void;
  /** Jump straight back to the current period. */
  resetOffset: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
  /** THE window every timeframe-scoped chart on the screen must query with. */
  periodWindow: PeriodWindow;
  /** Concrete range for the header, e.g. "Aug 23 – 29" / "Jun – Aug 2026". */
  periodLabel: string;
  /** Local `YYYY-MM-DD` of the user's first ever entry; null while unknown. */
  earliestEntryDay: string | null;
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
  timeframeCondition: getTimeframeCondition(DEFAULT_TIMEFRAME),
  timeframeDescription: getTimeframeDescription(DEFAULT_TIMEFRAME),
});

export const TimeframeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const db = useSQLiteContext();
  const [timeframe, setTimeframeState] = useState<Timeframe>(DEFAULT_TIMEFRAME);
  const [offset, setOffset] = useState(0);
  const [earliestEntryDay, setEarliestEntryDay] = useState<string | null>(null);

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
    setTimeframeState(next);
    setOffset(0);
  }, []);

  const goBack = useCallback(() => {
    setOffset((current) =>
      canStepBack(timeframe, current, earliestEntryDay, today) ? current - 1 : current,
    );
  }, [timeframe, earliestEntryDay, today]);

  const goForward = useCallback(() => {
    setOffset((current) => (canStepForward(timeframe, current) ? current + 1 : current));
  }, [timeframe]);

  const resetOffset = useCallback(() => setOffset(0), []);

  // The earliest-entry query resolves AFTER first paint, so an offset that was
  // legal under "unknown" can become illegal a moment later. Snap it back
  // instead of stranding the user on a window with nothing behind it.
  useEffect(() => {
    setOffset((current) => clampOffset(timeframe, current, earliestEntryDay, today));
  }, [timeframe, earliestEntryDay, today]);

  // Memoised so the object identity is stable per (timeframe, offset, day) —
  // the charts put `periodWindow` in their reload deps, and a fresh object every
  // render would refetch the whole screen on every parent re-render.
  const periodWindow = useMemo(
    () => computePeriodWindow(timeframe, offset, today),
    [timeframe, offset, today],
  );
  const periodLabel = useMemo(
    () => formatPeriodLabel(timeframe, offset, today),
    [timeframe, offset, today],
  );

  const contextValue = useMemo<TimeframeContextType>(
    () => ({
      timeframe,
      setTimeframe,
      offset,
      goBack,
      goForward,
      resetOffset,
      canGoBack: canStepBack(timeframe, offset, earliestEntryDay, today),
      canGoForward: canStepForward(timeframe, offset),
      periodWindow,
      periodLabel,
      earliestEntryDay,
      timeframeCondition: getTimeframeCondition(timeframe),
      timeframeDescription: getTimeframeDescription(timeframe),
    }),
    [
      timeframe,
      setTimeframe,
      offset,
      goBack,
      goForward,
      resetOffset,
      earliestEntryDay,
      today,
      periodWindow,
      periodLabel,
    ],
  );

  return (
    <TimeframeContext.Provider value={contextValue}>
      {children}
    </TimeframeContext.Provider>
  );
};

export const useTimeframe = () => useContext(TimeframeContext);
