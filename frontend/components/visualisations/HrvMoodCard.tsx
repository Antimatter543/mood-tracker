import React from 'react';
import MetricMoodCard from './MetricMoodCard';
import type { MetricMoodCorrelation } from './transforms/healthMoodCorrelation';

const METHOD_NOTE =
    "Your day's average heart rate variability (HRV, RMSSD) compared with that " +
    "day's mood, across days you logged both. A pattern in your own data — an " +
    'association, not a cause, and not medical advice.';

/** ms → "NN ms" for display. */
const formatMs = (ms: number): string => `${Math.round(ms)} ms`;

/**
 * HRV↔mood insight card. Thin wrapper over {@link MetricMoodCard}; the
 * gating/framing lives there and in the pure `hrvMoodCorrelation` transform
 * (which keys on avgHrvMillis). HRV is optional + sparse, so most users see the
 * "keep logging" state — the card only mounts when HRV data actually exists.
 */
const HrvMoodCard: React.FC<{ correlation: MetricMoodCorrelation }> = ({
    correlation,
}) => (
    <MetricMoodCard
        icon="pulse-outline"
        title="Heart rate variability & mood"
        metricNoun="heart rate variability"
        halfWords={{ lower: 'lower-HRV', upper: 'higher-HRV' }}
        formatMetric={formatMs}
        methodNote={METHOD_NOTE}
        correlation={correlation}
    />
);

export default HrvMoodCard;
