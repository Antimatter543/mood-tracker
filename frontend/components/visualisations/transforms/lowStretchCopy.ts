/**
 * The words of the "After low days" card and its detail page, as pure
 * functions so the copy is pinned by tests (no React tree needed).
 *
 * Wording rules (product call for PR #48): the unit is a "low stretch"; an
 * ended stretch is "Back to 6+" or "Steady at 5+"; no percentages, no
 * "episode", no "recovered / not recovered", no "worsening".
 */
import { calendarDaysSpanned } from '@/databases/dateHelpers';
import type { RecoveryAnalysis, RecoveryEpisode } from './recoveryPatterns';

/** "1 day" / "3 days". */
export const daysLabel = (n: number): string => `${n} ${n === 1 ? 'day' : 'days'}`;

/** Whole moods without decimals ("4"), anything else to one place ("4.5"). */
export const formatMood = (mood: number): string =>
    Number.isInteger(mood) ? String(mood) : mood.toFixed(1);

/** "2 low stretches in the last 90 days". */
export const summaryLine = (count: number): string =>
    `${count} low ${count === 1 ? 'stretch' : 'stretches'} in the last 90 days`;

/**
 * How long ended stretches took to get back to 6+, or null when none did.
 * One stretch is reported as it was; "usually" needs at least two.
 */
export const typicalLine = (analysis: RecoveryAnalysis): string | null => {
    const avg = analysis.avgRecoveredDays;
    if (analysis.recoveredCount === 0 || avg === null) return null;
    const days = Math.max(1, Math.round(avg));
    return analysis.recoveredCount === 1
        ? `Back to 6+ in ${daysLabel(days)}`
        : `Usually back to 6+ in about ${daysLabel(days)}`;
};

/** Status of an ended stretch. */
export const statusLabel = (episode: RecoveryEpisode): string =>
    episode.recovered ? 'Back to 6+' : 'Steady at 5+';

/** Days from the start of a current stretch up to and including `today`. */
export const daysSoFar = (startDate: string, today: string): number =>
    calendarDaysSpanned(startDate, today);

/** "Lowest 3 · latest 5.5". */
export const moodRangeLine = (episode: RecoveryEpisode): string =>
    `Lowest ${formatMood(episode.worstMood)} · latest ${formatMood(episode.currentMood)}`;

/** "1 dip" / "2 dips". */
export const dipsLabel = (n: number): string => `${n} ${n === 1 ? 'dip' : 'dips'}`;
