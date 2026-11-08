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

export const HEALTH_RATING_COLORS: Record<HealthRating, string> = {
    good: '#43A047',
    fair: '#F9A825',
    poor: '#E53935',
};

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
    if (h <= 10) return { rating: 'fair', note: 'A bit more than usual. Fine now and then, e.g. to catch up.' };
    return { rating: 'poor', note: 'Much longer than usual. Can be a sign of being run down or unwell.' };
};

const rateRestingHr = (bpm: number): Reading => {
    if (bpm < 40) return { rating: 'fair', note: 'Very low. Normal for well-trained people, otherwise unusual.' };
    if (bpm <= 65) return { rating: 'good', note: 'A calm, well-rested heart.' };
    if (bpm <= 80) return { rating: 'fair', note: 'Normal, but stress, little sleep or a cold can push it up.' };
    return { rating: 'poor', note: 'High for rest. Stress, illness, alcohol or little sleep raise it.' };
};

const rateHrv = (ms: number): Reading => {
    if (ms >= 40) return { rating: 'good', note: 'Your body is recovering well.' };
    if (ms >= 20) return { rating: 'fair', note: 'Some strain. Stress, poor sleep or alcohol lower it. Your own usual value matters most.' };
    return { rating: 'poor', note: 'Low: your body is under strain. Your own usual value matters most.' };
};

/** The figures of a day, in a fixed order, skipping the ones it lacks. */
export const dayHealthItems = (h: DayHealth): DayHealthItem[] => {
    const items: DayHealthItem[] = [];
    if (h.sleepMinutes !== null) {
        items.push({ key: 'sleep', icon: 'moon-outline', label: 'Sleep', value: formatSleep(h.sleepMinutes), ...rateSleep(h.sleepMinutes) });
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
        items.push({ key: 'hrv', icon: 'pulse-outline', label: 'Heart rate variability', value: `${ms} ms`, ...rateHrv(ms) });
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
