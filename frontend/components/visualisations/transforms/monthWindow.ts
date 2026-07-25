// monthWindow.ts
//
// Pure helpers for the mood calendar's "visible month" -> data-window mapping.
//
// DOCTRINE (see queries.ts / dailyAverages.ts): SQL only RANGE-FILTERS on the
// stored UTC instant with parameterised UTC ISO bounds. The bounds for a visible
// month are computed HERE, in local time, so the window covers the WHOLE of the
// rendered area in the user's timezone — never a UTC-shifted range. Works for
// ANY visible month the user navigates to, not just today's.
//
// WHY A GRID WINDOW, NOT A MONTH WINDOW: react-native-calendars renders a
// WEEK-ALIGNED grid, so July's page also shows the trailing days of June and the
// leading days of August (its `page()` in dateutils.js pads the month out to full
// weeks on both ends, respecting `firstDay`). If we only fetched the calendar
// MONTH, those adjacent-month cells would render UNCOLORED until the user
// happened to visit that neighbouring month (whose own fetch then filled them in).
// So the data window must be the exact RENDERED GRID: from the week-start of the
// week containing the 1st, through the week-end of the week containing the last
// day. This is computed to match `page()` exactly (verified against the installed
// v1.1314 source) so every cell the calendar draws has data.

import { startOfLocalDay, endOfLocalDay } from './dateHelpers';

/**
 * A visible calendar month. `month` is 1-INDEXED (January = 1), matching what
 * react-native-calendars' `onMonthChange` hands back — so no off-by-one at the
 * component boundary.
 */
export type VisibleMonth = { year: number; month: number };

/**
 * First day of the week the calendar renders with (0 = Sunday … 6 = Saturday,
 * JS `getDay()` semantics). MoodCalendar passes this to `<Calendar firstDay>`
 * AND to `gridWindowBounds` so the drawn grid and the fetched window can never
 * drift out of alignment. Monday (1) matches the app's chosen week start.
 */
export const CALENDAR_FIRST_DAY = 1;

/** Stable `YYYY-MM` cache key for a visible month. */
export const monthKey = ({ year, month }: VisibleMonth): string =>
  `${year}-${String(month).padStart(2, '0')}`;

/**
 * Days to walk BACK from a date to reach the start of its week for `firstDay`.
 * Matches react-native-calendars' `page()` alignment (dateutils.js): the shift
 * is `(dayOfWeek - firstDay + 7) % 7`.
 */
const daysToWeekStart = (dayOfWeek: number, firstDay: number): number =>
  (dayOfWeek - firstDay + 7) % 7;

/**
 * UTC ISO bounds `[start, end]` covering the whole WEEK-ALIGNED GRID the calendar
 * renders for a visible month — i.e. the month PLUS the leading/trailing days of
 * the adjacent months that share the first/last rendered week.
 *
 * `start` = 00:00:00.000 local on the grid's first cell (the week-start of the
 * week containing the 1st); `end` = 23:59:59.999 local on the grid's last cell
 * (the week-end of the week containing the last day). Every day in the range is
 * FULLY covered (00:00 → 23:59), so no day is ever half-fetched. Feed straight
 * into `WHERE date BETWEEN ?start AND ?end`.
 *
 * `firstDay` defaults to `CALENDAR_FIRST_DAY` so callers stay aligned with the
 * `<Calendar firstDay>` prop by construction.
 */
export const gridWindowBounds = (
  { year, month }: VisibleMonth,
  firstDay: number = CALENDAR_FIRST_DAY,
): { start: string; end: string } => {
  const first = new Date(year, month - 1, 1);
  // Day 0 of the NEXT month = the last calendar day of THIS month (handles
  // 28/29/30/31 and year rollover for December automatically).
  const last = new Date(year, month, 0);

  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - daysToWeekStart(first.getDay(), firstDay));

  const gridEnd = new Date(last);
  // Week-END = week-start + 6, i.e. walk FORWARD the complement of the back-shift.
  gridEnd.setDate(last.getDate() + (6 - daysToWeekStart(last.getDay(), firstDay)));

  return { start: startOfLocalDay(gridStart), end: endOfLocalDay(gridEnd) };
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
