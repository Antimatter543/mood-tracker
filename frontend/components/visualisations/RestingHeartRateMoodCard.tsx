import React from 'react';
import MetricMoodCard from './MetricMoodCard';
import type { MetricMoodCorrelation } from './transforms/healthMoodCorrelation';

const METHOD_NOTE =
    "Your day's resting heart rate compared with that day's mood, across days " +
    'you logged both. A pattern in your own data — an association, not a cause, ' +
    'and not medical advice.';

/** bpm → "NN bpm" for display. */
const formatBpm = (bpm: number): string => `${Math.round(bpm)} bpm`;

/**
 * Resting-heart-rate↔mood insight card. Thin wrapper over {@link MetricMoodCard};
 * the gating/framing lives there and in the pure `restingHeartRateMoodCorrelation`
 * transform (which prefers the dedicated RestingHeartRate reading and falls back
 * to minHeartRate — the day's lowest bpm — as an intraday-min proxy). A lower
 * resting HR is the "recovered" signal, so this often reads oppositely to average
 * heart rate.
 */
const RestingHeartRateMoodCard: React.FC<{ correlation: MetricMoodCorrelation }> = ({
    correlation,
}) => (
    <MetricMoodCard
        icon="heart-outline"
        title="Resting heart rate & mood"
        metricNoun="resting heart rate"
        halfWords={{ lower: 'lower-resting-HR', upper: 'higher-resting-HR' }}
        formatMetric={formatBpm}
        methodNote={METHOD_NOTE}
        correlation={correlation}
    />
);

export default RestingHeartRateMoodCard;
