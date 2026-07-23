import React from 'react';
import MetricMoodCard from './MetricMoodCard';
import { HEALTH_METRIC_CONFIGS } from './healthMetricConfigs';
import type { MetricMoodCorrelation } from './transforms/healthMoodCorrelation';

/**
 * Sleep↔mood insight card. A thin wrapper over {@link MetricMoodCard}; the
 * metric-specific config lives in HEALTH_METRIC_CONFIGS (shared with the
 * swipeable HealthMoodPagerCard) and all the gating/framing lives in
 * MetricMoodCard + the pure `sleepMoodCorrelation` transform.
 */
const SleepMoodCard: React.FC<{ correlation: MetricMoodCorrelation }> = ({
    correlation,
}) => <MetricMoodCard {...HEALTH_METRIC_CONFIGS.sleep} correlation={correlation} />;

export default SleepMoodCard;
