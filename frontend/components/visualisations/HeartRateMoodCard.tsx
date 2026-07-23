import React from 'react';
import MetricMoodCard from './MetricMoodCard';
import { HEALTH_METRIC_CONFIGS } from './healthMetricConfigs';
import type { MetricMoodCorrelation } from './transforms/healthMoodCorrelation';

/**
 * Heart-rate↔mood insight card. Thin wrapper over {@link MetricMoodCard}; the
 * metric-specific config lives in HEALTH_METRIC_CONFIGS (shared with the
 * swipeable HealthMoodPagerCard) and the gating/framing lives in MetricMoodCard
 * + the pure `heartRateMoodCorrelation` transform (which keys on avgHeartRate).
 */
const HeartRateMoodCard: React.FC<{ correlation: MetricMoodCorrelation }> = ({
    correlation,
}) => <MetricMoodCard {...HEALTH_METRIC_CONFIGS.heartRate} correlation={correlation} />;

export default HeartRateMoodCard;
