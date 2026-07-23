import React from 'react';
import MetricMoodCard from './MetricMoodCard';
import { HEALTH_METRIC_CONFIGS } from './healthMetricConfigs';
import type { MetricMoodCorrelation } from './transforms/healthMoodCorrelation';

/**
 * HRV↔mood insight card. Thin wrapper over {@link MetricMoodCard}; the
 * metric-specific config lives in HEALTH_METRIC_CONFIGS (shared with the
 * swipeable HealthMoodPagerCard) and the gating/framing lives in MetricMoodCard
 * + the pure `hrvMoodCorrelation` transform (which keys on avgHrvMillis). HRV is
 * optional + sparse, so most users see the "keep logging" state — the card only
 * mounts when HRV data actually exists.
 */
const HrvMoodCard: React.FC<{ correlation: MetricMoodCorrelation }> = ({
    correlation,
}) => <MetricMoodCard {...HEALTH_METRIC_CONFIGS.hrv} correlation={correlation} />;

export default HrvMoodCard;
