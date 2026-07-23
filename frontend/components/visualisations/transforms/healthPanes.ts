/**
 * Pane-selection logic for the swipeable Health Connect metric↔mood card.
 *
 * PURE + UI-FREE (no React, no vector-icons) so it's exhaustively unit-testable
 * and safe to import from a light consumer without dragging animation/native
 * runtimes into jest — same layering discipline as iconRegistry / the chart
 * transforms (see frontend/tasks/lessons.md 2026-06-13).
 *
 * The Insights screen renders ONE card that pages between a metric-vs-mood view
 * per metric that HAS on-device data. A metric with no data is excluded
 * entirely (never shown as an empty pane), and the order is fixed so the pager
 * is stable across renders.
 */

/** The health metrics that can each get a mood-correlation pane. */
export type HealthMetricKey = 'sleep' | 'heartRate' | 'restingHr' | 'hrv';

/** Per-metric data-availability flags (mirrors the Insights `d.has*Data`). */
export interface HealthPaneFlags {
    hasSleepData: boolean;
    hasHeartRateData: boolean;
    hasRestingHrData: boolean;
    hasHrvData: boolean;
}

/**
 * Canonical display order of the panes: sleep → heart rate → resting HR → HRV.
 * The pager and the dots indicator both walk this order.
 */
export const HEALTH_PANE_ORDER: readonly HealthMetricKey[] = [
    'sleep',
    'heartRate',
    'restingHr',
    'hrv',
];

/**
 * The ordered list of metric panes that HAVE data, in {@link HEALTH_PANE_ORDER}.
 * Empty when no metric has data. Panes with no data are omitted, never shown
 * empty.
 */
export function availableHealthPanes(flags: HealthPaneFlags): HealthMetricKey[] {
    const has: Record<HealthMetricKey, boolean> = {
        sleep: flags.hasSleepData,
        heartRate: flags.hasHeartRateData,
        restingHr: flags.hasRestingHrData,
        hrv: flags.hasHrvData,
    };
    return HEALTH_PANE_ORDER.filter((key) => has[key]);
}
