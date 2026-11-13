// dayHealth.ts
//
// The Health Connect figures of a finished Timeline day and a rough reading of
// each. Pure, so the Timeline row model and its tests need no native module.

import type { DailyHealthMetrics } from '@/lib/healthConnectPure';

export type DayHealth = {
    sleepMinutes: number | null;
    /** The dedicated RestingHeartRate reading, else the day's lowest bpm (as Insights does). */
    restingHeartRate: number | null;
    avgHeartRate: number | null;
    avgHrvMillis: number | null;
};

export type HealthRating = 'good' | 'fair' | 'poor';

export type DayHealthItem = {
    key: 'sleep' | 'restingHr' | 'heartRate' | 'hrv';
    icon: 'moon-outline' | 'heart-outline' | 'pulse-outline';
    label: string;
    value: string;
    /** Null for a figure that says what happened rather than how well (average heart rate). */
    rating: HealthRating | null;
    note: string;
};

/**
 * The rating colours per theme mode. A 16 px pulse is a graphic, so it needs 3:1
 * against what it sits on (the page background in the Timeline, the card in the
 * health card). The bright amber is about 2:1 on the light themes, so light
 * themes get darker shades. `__tests__/timelineDayHealth.test.tsx` checks every
 * theme against both surfaces.
 */
export const HEALTH_RATING_COLORS: Record<'dark' | 'light', Record<HealthRating, string>> = {
    dark: { good: '#43A047', fair: '#F9A825', poor: '#E53935' },
    light: { good: '#2E7D32', fair: '#B26A00', poor: '#C62828' },
};

export const healthRatingColor = (rating: HealthRating, theme: { isDark: boolean }): string =>
    HEALTH_RATING_COLORS[theme.isDark ? 'dark' : 'light'][rating];

export const HEALTH_RATING_LABELS: Record<HealthRating, string> = {
    good: 'Good',
    fair: 'Fair',
    poor: 'Poor',
};

const usable = (v: number | null | undefined): number | null =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;

/** A stored metrics row as the Timeline shows it; null when it holds nothing to show. */
export const dayHealthFromMetric = (m: DailyHealthMetrics): DayHealth | null => {
    const health: DayHealth = {
        sleepMinutes: usable(m.sleepTotalMinutes),
        restingHeartRate: usable(m.restingHeartRate) ?? usable(m.minHeartRate),
        avgHeartRate: usable(m.avgHeartRate),
        avgHrvMillis: usable(m.avgHrvMillis),
    };
    return Object.values(health).some((v) => v !== null) ? health : null;
};

/** Metrics rows keyed by their local day, empty days dropped. */
export const dayHealthByDay = (
    metrics: readonly DailyHealthMetrics[]
): ReadonlyMap<string, DayHealth> => {
    const byDay = new Map<string, DayHealth>();
    for (const m of metrics) {
        const health = dayHealthFromMetric(m);
        if (health) byDay.set(m.date, health);
    }
    return byDay;
};

/** 445 -> "7h 25m", 60 -> "1h", 42 -> "42m". */
export const formatSleep = (minutes: number): string => {
    const total = Math.round(minutes);
    const h = Math.floor(total / 60);
    const m = total % 60;
    if (h === 0) return `${m}m`;
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
};

type Reading = { rating: HealthRating; note: string };

// Rough bands for adults; the card says so.
const rateSleep = (minutes: number): Reading => {
    const h = minutes / 60;
    if (h < 6) return { rating: 'poor', note: 'Well under the 7–9 hours adults need. Short nights drain energy and mood.' };
    if (h < 7) return { rating: 'fair', note: 'A little under the 7–9 hours adults need.' };
    if (h <= 9) return { rating: 'good', note: 'Within the 7–9 hours adults need.' };
    if (h <= 10) return { rating: 'fair', note: 'A bit over the 7–9 hours. Fine now and then, e.g. to catch up.' };
    return { rating: 'poor', note: 'Well over the 7–9 hours. Often a sign of being run down or unwell.' };
};

const rateRestingHr = (bpm: number): Reading => {
    if (bpm < 40) return { rating: 'fair', note: 'Very low. Normal for well-trained people, otherwise unusual.' };
    // 60-100 bpm is the usual adult range at rest (some medications raise it).
    if (bpm <= 80) return { rating: 'good', note: 'Within the usual range for adults at rest.' };
    if (bpm <= 100) return { rating: 'fair', note: 'A bit high for rest. Stress, little sleep, caffeine or a cold can push it up.' };
    return { rating: 'poor', note: 'Above the usual range for rest. Illness, stress, alcohol or little sleep raise it.' };
};

/** The figures of a day, in a fixed order, skipping the ones it lacks. */
export const dayHealthItems = (h: DayHealth): DayHealthItem[] => {
    const items: DayHealthItem[] = [];
    if (h.sleepMinutes !== null) {
        items.push({ key: 'sleep', icon: 'moon-outline', label: 'Sleep (night before)', value: formatSleep(h.sleepMinutes), ...rateSleep(h.sleepMinutes) });
    }
    if (h.restingHeartRate !== null) {
        const bpm = Math.round(h.restingHeartRate);
        items.push({ key: 'restingHr', icon: 'heart-outline', label: 'Resting heart rate', value: `${bpm} bpm`, ...rateRestingHr(bpm) });
    }
    if (h.avgHeartRate !== null) {
        items.push({
            key: 'heartRate',
            icon: 'heart-outline',
            label: 'Average heart rate',
            value: `${Math.round(h.avgHeartRate)} bpm`,
            rating: null,
            note: 'Your average over the day. Mostly shows how active you were.',
        });
    }
    if (h.avgHrvMillis !== null) {
        const ms = Math.round(h.avgHrvMillis);
        // Not rated: HRV varies a lot between people and with age, so a fixed band
        // can't say how this person is doing. Only their own usual value can.
        items.push({
            key: 'hrv',
            icon: 'pulse-outline',
            label: 'Heart rate variability',
            value: `${ms} ms`,
            rating: null,
            note: 'Varies a lot from person to person. Compare with your own usual value: lower than usual often means stress, poor sleep or alcohol.',
        });
    }
    return items;
};

const SCORE: Record<HealthRating, number> = { good: 2, fair: 1, poor: 0 };

/** The day at a glance: the mean of its rated figures; null when none is rated. */
export const dayHealthRating = (h: DayHealth): HealthRating | null => {
    const rated = dayHealthItems(h).flatMap((i) => (i.rating ? [SCORE[i.rating]] : []));
    if (rated.length === 0) return null;
    const mean = rated.reduce((a, b) => a + b, 0) / rated.length;
    if (mean >= 1.5) return 'good';
    return mean >= 0.75 ? 'fair' : 'poor';
};
