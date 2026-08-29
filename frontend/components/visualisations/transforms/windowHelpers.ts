// windowHelpers.ts
//
// Timeframe helpers for the Statistics screen.
//
// The window math itself now lives in ./periodWindow.ts, which added a signed
// period `offset` so the Stats header can page backwards through history. This
// file keeps the two things that aren't offset-dependent: the period-length
// lookup used by the consistency KPI, and a plain offset-0 `computeWindow` for
// callers outside the navigable Stats screen.
//
// IF YOU ARE A CHART ON THE STATS SCREEN, DO NOT CALL `computeWindow`. Read
// `window` off `useTimeframe()` instead — it already reflects whichever period
// the user has paged to, and one shared object means the header and the charts
// can never describe different ranges.

import {
    computePeriodWindow,
    todayLocalDay,
    PERIOD_LENGTH_DAYS,
    type Timeframe,
} from './periodWindow';

export type { Timeframe };

export type Window = { start: string; end: string };

/**
 * The CURRENT period's local-time window (offset 0), as UTC ISO bounds for
 * `WHERE date BETWEEN ? AND ?`. Convenience wrapper for callers that have no
 * period navigation of their own; the Stats charts use the context window.
 */
export const computeWindow = (timeframe: Timeframe): Window =>
    computePeriodWindow(timeframe, 0, todayLocalDay());

/**
 * Calendar days covered by one period of `timeframe`. Used by the KPI
 * consistency math (entries / daysInWindow) — and it is EXACT, not approximate:
 * `periodDayRange` builds windows of precisely this many days. For 'alltime' the
 * caller should override with the real span; this returns a workable default.
 */
export const daysInTimeframe = (timeframe: Timeframe): number =>
    timeframe === 'alltime' ? 365 : PERIOD_LENGTH_DAYS[timeframe];
