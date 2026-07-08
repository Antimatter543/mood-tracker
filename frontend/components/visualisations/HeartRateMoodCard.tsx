import React from 'react';
import MetricMoodCard from './MetricMoodCard';
import type { MetricMoodCorrelation } from './transforms/healthMoodCorrelation';

const METHOD_NOTE =
    "Your day's average heart rate compared with that day's mood, across days " +
    'you logged both. A pattern in your own data — an association, not a cause, ' +
    'and not medical advice.';

/** bpm → "NN bpm" for display. */
const formatBpm = (bpm: number): string => `${Math.round(bpm)} bpm`;

/**
 * Heart-rate↔mood insight card. Thin wrapper over {@link MetricMoodCard}; the
 * gating/framing lives there and in the pure `heartRateMoodCorrelation`
 * transform (which keys on avgHeartRate).
 */
const HeartRateMoodCard: React.FC<{ correlation: MetricMoodCorrelation }> = ({
    correlation,
}) => (
    <MetricMoodCard
        icon="heart-outline"
        title="Heart rate & mood"
        metricNoun="heart rate"
        halfWords={{ lower: 'lower-heart-rate', upper: 'higher-heart-rate' }}
        formatMetric={formatBpm}
        methodNote={METHOD_NOTE}
        correlation={correlation}
    />
);

export default HeartRateMoodCard;
