// dateRangeSelection.ts
//
// PURE selection logic for the Stats date-range picker. No React, no calendar
// library import — so the two-tap protocol, the marking dict and the summary
// line are unit-testable without rendering a month grid.
//
// THE PROTOCOL (a calendar, not a form): the first tap sets a start and leaves
// the range OPEN; the second tap closes it. Tapping a day EARLIER than the open
// start doesn't reject the tap — it treats the earlier day as the start, because
// on a calendar "I meant that one" is the normal correction and an error toast
// here would be user-hostile. Tapping once a range is COMPLETE starts a fresh
// one, so the picker never needs a "clear" button.
//
// Nothing here clamps to today or to the user's first entry: `maxDate` on the
// calendar keeps future days untappable, and `normaliseCustomRange` in
// periodWindow.ts is the authority that re-checks the pair before it can ever
// reach a chart. This module only shapes what the user is pointing at.

import { addDays } from './dateHelpers';
import {
    dayCountInclusive,
    daysBetweenDays,
    formatDayRangeLabel,
    type DayRange,
} from './periodWindow';

/** A selection in progress. `endDay: null` = a start is picked, waiting for the end. */
export type RangeSelection = {
    startDay: string;
    /** The closing day, or null while the range is still open. */
    endDay: string | null;
};

/**
 * One day's marking under `<Calendar markingType="period">` (the shape the
 * library's Marking props expect — verified against react-native-calendars
 * v1.1314 `markingType: 'period'`). Endpoints carry `startingDay`/`endingDay`
 * so the library rounds the correct side of the pill.
 */
export type PeriodDayMarking = {
    startingDay?: boolean;
    endingDay?: boolean;
    color: string;
    textColor: string;
};

export type PeriodMarkedDates = { [day: string]: PeriodDayMarking };

/**
 * Theme colors the marking builder needs, passed in so this transform hardcodes
 * NO palette (same contract as calendarMarkers.ts).
 */
export type RangeMarkingColors = {
    /** Fill for the two endpoints. */
    endpoint: string;
    /** Text on an endpoint fill. */
    onEndpoint: string;
    /** Fill for the days between the endpoints. */
    fill: string;
    /** Text on the between-days fill. */
    onFill: string;
};

/**
 * Iteration bound for building the marking dict. ~11 years of days is already
 * far more than anyone selects; past that a corrupt stored date could otherwise
 * spin a multi-million-iteration loop on the render path. Over the cap we mark
 * only the endpoints — a thin selection is a much better failure than a frozen
 * calendar. (Same reasoning as MAX_FILLED_DAYS in moodSeries.ts.)
 */
const MAX_MARKED_DAYS = 4000;

/** True once both ends are picked. Narrows so callers can read `endDay` safely. */
export const isComplete = (
    selection: RangeSelection | null,
): selection is RangeSelection & { endDay: string } =>
    selection != null && selection.endDay != null;

/** The completed range, or null while the selection is empty or still open. */
export const selectionRange = (selection: RangeSelection | null): DayRange | null =>
    isComplete(selection)
        ? { startDay: selection.startDay, endDay: selection.endDay }
        : null;

/**
 * Apply a day tap. See THE PROTOCOL at the top of the file:
 *  - no selection, or a complete one -> start over with an open range on `day`,
 *  - an open range -> close it, ordering the two days so start <= end.
 *
 * Tapping the SAME day twice closes a one-day range, which is a legitimate
 * question ("what did that Tuesday look like?"), not a mistake to swallow.
 */
export const advanceSelection = (
    selection: RangeSelection | null,
    day: string,
): RangeSelection => {
    if (!selection || isComplete(selection)) return { startDay: day, endDay: null };
    return daysBetweenDays(selection.startDay, day) < 0
        ? { startDay: day, endDay: selection.startDay }
        : { startDay: selection.startDay, endDay: day };
};

/**
 * The `markedDates` dict for the current selection under `markingType="period"`.
 *
 * An OPEN range marks just its single day as both ends (a round pill), so the
 * first tap gives immediate feedback instead of looking like nothing happened.
 */
export const buildRangeMarking = (
    selection: RangeSelection | null,
    colors: RangeMarkingColors,
): PeriodMarkedDates => {
    if (!selection) return {};

    const endpoint: PeriodDayMarking = {
        color: colors.endpoint,
        textColor: colors.onEndpoint,
    };

    if (!isComplete(selection)) {
        return {
            [selection.startDay]: { ...endpoint, startingDay: true, endingDay: true },
        };
    }

    const { startDay, endDay } = selection;
    if (startDay === endDay) {
        return { [startDay]: { ...endpoint, startingDay: true, endingDay: true } };
    }

    const marked: PeriodMarkedDates = {
        [startDay]: { ...endpoint, startingDay: true },
        [endDay]: { ...endpoint, endingDay: true },
    };

    const span = daysBetweenDays(startDay, endDay);
    if (span > MAX_MARKED_DAYS) return marked;
    for (let i = 1; i < span; i++) {
        marked[addDays(startDay, i)] = { color: colors.fill, textColor: colors.onFill };
    }
    return marked;
};

/**
 * The picker's one-line status. Reuses `formatDayRangeLabel` so the pending
 * selection is spelled exactly the way the Stats header will spell it once
 * applied — the user sees the label they are about to get, not a variant of it.
 */
export const selectionSummary = (
    selection: RangeSelection | null,
    today: string,
): string => {
    if (!selection) return 'Tap a start date';
    if (!isComplete(selection)) return 'Now tap an end date';
    const range = { startDay: selection.startDay, endDay: selection.endDay };
    const days = dayCountInclusive(range);
    return `${formatDayRangeLabel(range, today, 'day')} · ${days} ${
        days === 1 ? 'day' : 'days'
    }`;
};
