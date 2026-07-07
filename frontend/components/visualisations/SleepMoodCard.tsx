import React from 'react';
import MetricMoodCard from './MetricMoodCard';
import type { MetricMoodCorrelation } from './transforms/healthMoodCorrelation';

const METHOD_NOTE =
    'Your nightly sleep total (counted toward the day you woke) compared with ' +
    "that day's mood, across days you logged both. A pattern in your own data — " +
    'an association, not a cause, and not medical advice.';

/** Minutes → "H.Hh" for display (the transform stores sleep as minutes). */
const formatHours = (minutes: number): string => `${(minutes / 60).toFixed(1)}h`;

/**
 * Sleep↔mood insight card. A thin wrapper over {@link MetricMoodCard}; all the
 * gating/framing lives there and in the pure `sleepMoodCorrelation` transform.
 */
const SleepMoodCard: React.FC<{ correlation: MetricMoodCorrelation }> = ({
    correlation,
}) => (
    <MetricMoodCard
        icon="moon-outline"
        title="Sleep & mood"
        metricNoun="sleep"
        halfWords={{ lower: 'shorter-sleep', upper: 'longer-sleep' }}
        formatMetric={formatHours}
        methodNote={METHOD_NOTE}
        correlation={correlation}
    />
);

export default SleepMoodCard;
