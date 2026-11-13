import {
    daysLabel,
    daysSoFar,
    dipsLabel,
    formatMood,
    statusLabel,
    summaryLine,
    typicalLine,
} from '@/components/visualisations/transforms/lowStretchCopy';
import type {
    RecoveryAnalysis,
    RecoveryEpisode,
} from '@/components/visualisations/transforms/recoveryPatterns';

const analysis = (over: Partial<RecoveryAnalysis>): RecoveryAnalysis => ({
    currentEpisode: null,
    historicalEpisodes: [],
    episodeCount: 1,
    recoveredCount: 0,
    avgRecoveredDays: null,
    ...over,
});

describe('low stretch copy', () => {
    it('pluralises days, dips and stretches ("1 day", never "1 days")', () => {
        expect(daysLabel(1)).toBe('1 day');
        expect(daysLabel(2)).toBe('2 days');
        expect(dipsLabel(1)).toBe('1 dip');
        expect(dipsLabel(3)).toBe('3 dips');
        expect(summaryLine(1)).toBe('1 low stretch in the last 90 days');
        expect(summaryLine(4)).toBe('4 low stretches in the last 90 days');
    });

    it('shows whole moods without decimals and others to one place', () => {
        expect(formatMood(4)).toBe('4');
        expect(formatMood(4.5)).toBe('4.5');
        expect(formatMood(3.25)).toBe('3.3');
    });

    it('has no typical line until a stretch got back to 6+', () => {
        expect(typicalLine(analysis({ recoveredCount: 0, avgRecoveredDays: null }))).toBeNull();
    });

    it('reports one stretch as it was, and says "usually" from two', () => {
        expect(typicalLine(analysis({ recoveredCount: 1, avgRecoveredDays: 3 }))).toBe(
            'Back to 6+ in 3 days',
        );
        expect(typicalLine(analysis({ recoveredCount: 2, avgRecoveredDays: 3.5 }))).toBe(
            'Usually back to 6+ in about 4 days',
        );
    });

    it('names how an ended stretch ended', () => {
        const ep = { recovered: true } as RecoveryEpisode;
        expect(statusLabel(ep)).toBe('Back to 6+');
        expect(statusLabel({ ...ep, recovered: false })).toBe('Steady at 5+');
    });

    it('counts days so far including the start day and today', () => {
        expect(daysSoFar('2026-06-12T12:00:00', '2026-06-15')).toBe(4);
        expect(daysSoFar('2026-06-15T08:00:00', '2026-06-15')).toBe(1);
    });
});
