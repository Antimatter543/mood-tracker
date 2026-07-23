import React from 'react';
import MetricMoodCard from './MetricMoodCard';
import { HEALTH_METRIC_CONFIGS } from './healthMetricConfigs';
import type { MetricMoodCorrelation } from './transforms/healthMoodCorrelation';

/**
 * Resting-heart-rate↔mood insight card. Thin wrapper over {@link MetricMoodCard};
 * the metric-specific config lives in HEALTH_METRIC_CONFIGS (shared with the
 * swipeable HealthMoodPagerCard) and the gating/framing lives in MetricMoodCard
 * + the pure `restingHeartRateMoodCorrelation` transform (which prefers the
 * dedicated RestingHeartRate reading and falls back to minHeartRate — the day's
 * lowest bpm — as an intraday-min proxy). A lower resting HR is the "recovered"
 * signal, so this often reads oppositely to average heart rate.
 */
const RestingHeartRateMoodCard: React.FC<{ correlation: MetricMoodCorrelation }> = ({
    correlation,
}) => <MetricMoodCard {...HEALTH_METRIC_CONFIGS.restingHr} correlation={correlation} />;

export default RestingHeartRateMoodCard;
