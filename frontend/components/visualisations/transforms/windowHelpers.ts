// windowHelpers.ts
//
// Timeframe helpers for the Statistics screen.
//
// The window math itself lives in ./periodWindow.ts — a signed period `offset`
// so the Stats header can page backwards, plus arbitrary custom ranges. All this
// file still holds is a plain offset-0 `computeWindow` for callers OUTSIDE the
// navigable Stats screen, and the `Timeframe` re-export a lot of charts import
// from here for historical reasons.
//
// IF YOU ARE A CHART ON THE STATS SCREEN, DO NOT CALL `computeWindow`. Read
// `window` off `useTimeframe()` instead — it already reflects whichever period
// the user has paged to, and one shared object means the header and the charts
// can never describe different ranges.

import { computePeriodWindow, todayLocalDay, type Timeframe } from './periodWindow';

export type { Timeframe };

export type Window = { start: string; end: string };

/**
 * The CURRENT period's local-time window (offset 0), as UTC ISO bounds for
 * `WHERE date BETWEEN ? AND ?`. Convenience wrapper for callers that have no
 * period navigation of their own; the Stats charts use the context window.
 */
export const computeWindow = (timeframe: Timeframe): Window =>
    computePeriodWindow(timeframe, 0, todayLocalDay());

// REMOVED: `daysInTimeframe(timeframe)`.
//
// It answered "how many days is a period of this LENGTH", which stopped being the
// same question as "how many days is the window on screen" the moment a custom
// range could be any length at all — and it was already fudging 'alltime' as a
// flat 365. The consistency KPI's denominator now comes from `windowDayCount` on
// TimeframeContext, which measures the ACTUAL window (and 'alltime' from the
// user's first entry). Deriving a day count from a timeframe NAME is the bug.
