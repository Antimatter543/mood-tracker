// monthWindow.ts
//
// Pure helpers for the mood calendar's "visible month" -> data-window mapping.
//
// DOCTRINE (see queries.ts / dailyAverages.ts): SQL only RANGE-FILTERS on the
// stored UTC instant with parameterised UTC ISO bounds. The bounds for a visible
// month are computed HERE, in local time, so a month's window covers the WHOLE
// of that month in the user's timezone (first day 00:00 local .. last day 23:59
// local) — never a UTC-shifted month. Works for ANY visible month the user
// navigates to, not just today's (the bug in the old loadMonthData, which was
// hardcoded to `new Date()`).

import { startOfLocalDay, endOfLocalDay } from './dateHelpers';

/**
 * A visible calendar month. `month` is 1-INDEXED (January = 1), matching what
 * react-native-calendars' `onMonthChange` hands back — so no off-by-one at the
 * component boundary.
 */
export type VisibleMonth = { year: number; month: number };

/** Stable `YYYY-MM` cache key for a visible month. */
export const monthKey = ({ year, month }: VisibleMonth): string =>
  `${year}-${String(month).padStart(2, '0')}`;

/**
 * UTC ISO bounds `[start, end]` covering the whole of a local visible month.
 * `start` = 00:00:00.000 local on the 1st; `end` = 23:59:59.999 local on the
 * last day. Feed straight into `WHERE date BETWEEN ?start AND ?end`.
 */
export const monthWindowBounds = ({
  year,
  month,
}: VisibleMonth): { start: string; end: string } => {
  const first = new Date(year, month - 1, 1);
  // Day 0 of the NEXT month = the last calendar day of THIS month (handles
  // 28/29/30/31 and year rollover for December automatically).
  const last = new Date(year, month, 0);
  return { start: startOfLocalDay(first), end: endOfLocalDay(last) };
};

/** The visible month that contains `date` (defaults to now). */
export const visibleMonthOf = (date: Date = new Date()): VisibleMonth => ({
  year: date.getFullYear(),
  month: date.getMonth() + 1,
});

/**
 * A `YYYY-MM-01` string for react-native-calendars' `current`/`initialDate`
 * prop (it only cares about the month, so the 1st is a safe canonical day).
 */
export const monthCurrentString = ({ year, month }: VisibleMonth): string =>
  `${year}-${String(month).padStart(2, '0')}-01`;
