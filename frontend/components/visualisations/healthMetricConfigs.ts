/**
 * Static per-metric config for the health↔mood cards — the metric-specific
 * words + formatters that used to live inline in each of the four thin wrapper
 * cards (Sleep / HeartRate / RestingHeartRate / Hrv). Centralised here as the
 * ONE source of truth so both the standalone cards and the swipeable
 * {@link HealthMoodPagerCard} render identical copy for a given metric.
 *
 * This holds everything MetricMoodCard needs EXCEPT the runtime `correlation`
 * (that's supplied per-render from the computed data). Type-only import of the
 * config interface keeps this module free of MetricMoodCard's UI graph.
 */
import type { MetricMoodCardConfig } from './MetricMoodCard';
import type { HealthMetricKey } from './transforms/healthPanes';

/** Everything a metric card needs except the runtime correlation. */
export type MetricStaticConfig = Omit<MetricMoodCardConfig, 'correlation'>;

/** Minutes → "H.Hh" (the transform stores sleep as minutes). */
const formatHours = (minutes: number): string => `${(minutes / 60).toFixed(1)}h`;
/** bpm → "NN bpm". */
const formatBpm = (bpm: number): string => `${Math.round(bpm)} bpm`;
/** ms → "NN ms". */
const formatMs = (ms: number): string => `${Math.round(ms)} ms`;

export const HEALTH_METRIC_CONFIGS: Record<HealthMetricKey, MetricStaticConfig> = {
    sleep: {
        icon: 'moon-outline',
        title: 'Sleep & mood',
        metricNoun: 'sleep',
        halfWords: { lower: 'shorter-sleep', upper: 'longer-sleep' },
        formatMetric: formatHours,
        methodNote:
            'Your nightly sleep total (counted toward the day you woke) compared with ' +
            "that day's mood, across days you logged both. A pattern in your own data — " +
            'an association, not a cause, and not medical advice.',
    },
    heartRate: {
        icon: 'heart-outline',
        title: 'Heart rate & mood',
        metricNoun: 'heart rate',
        halfWords: { lower: 'lower-heart-rate', upper: 'higher-heart-rate' },
        formatMetric: formatBpm,
        methodNote:
            "Your day's average heart rate compared with that day's mood, across days " +
            'you logged both. A pattern in your own data — an association, not a cause, ' +
            'and not medical advice.',
    },
    restingHr: {
        icon: 'heart-outline',
        title: 'Resting heart rate & mood',
        metricNoun: 'resting heart rate',
        halfWords: { lower: 'lower-resting-HR', upper: 'higher-resting-HR' },
        formatMetric: formatBpm,
        methodNote:
            "Your day's resting heart rate compared with that day's mood, across days " +
            'you logged both. A pattern in your own data — an association, not a cause, ' +
            'and not medical advice.',
    },
    hrv: {
        icon: 'pulse-outline',
        title: 'Heart rate variability & mood',
        metricNoun: 'heart rate variability',
        halfWords: { lower: 'lower-HRV', upper: 'higher-HRV' },
        formatMetric: formatMs,
        methodNote:
            "Your day's average heart rate variability (HRV, RMSSD) compared with that " +
            "day's mood, across days you logged both. A pattern in your own data — an " +
            'association, not a cause, and not medical advice.',
    },
};
