// recoveryPatterns.ts
//
// Detects "recovery episodes" — sequences where mood dipped below a threshold
// and (hopefully) climbed back above a recovery threshold for a sustained run.
//
// Pulled out of the React component so:
//   - The detection logic can be unit-tested with synthetic series.
//   - The component stays a thin renderer.
//   - The <2-data-point edge case (which crashed before) is handled here.
import { Activity } from "@/components/types";
import { daysBetween } from "./dateHelpers";
import { convertStringToDate, localDateString } from "@/databases/dateHelpers";

export const RECOVERY_THRESHOLD = 6.0;
export const DIP_THRESHOLD = 4.0;
export const NONRECOVERY_THRESHOLD = 5.0;
export const MIN_RECOVERY_DAYS = 2;
export const MIN_NONRECOVERY_DAYS = 4;

export type MoodActivityRow = {
    id: number;
    date: string;
    mood: number;
    activities: Activity[];
};

export type MoodEntry = {
    date: string;
    mood: number;
}

export type RecoveryEpisode = {
    startDate: string;
    endDate: string | null;
    worstMood: number;
    currentMood: number;
    worseningActivities: Set<Activity>;
    recoveringActivities: Set<Activity>;
    entries: MoodEntry[];
    durationDays: number;
    dips: number;
    recovered: boolean;
};

export type RecoveryAnalysis = {
    currentEpisode: RecoveryEpisode | null;
    historicalEpisodes: RecoveryEpisode[];
    successRate: number;  // 0..100
    avgDuration: number;  // mean days for completed episodes
};

/**
 * Analyse a list of mood entries (one row per day, sorted DESC by date — same
 * order the original SQL emits) and return episodes + summary stats. Mood entries
 * are expected to have local date time. Both daily (without time) and date.time
 * entries are supported properly.
 *
 * Gracefully handles 0 data points — no crash, just empty episodes.
 */
export const analyseRecoveryPatterns = (
    entries: MoodActivityRow[]
): RecoveryAnalysis => {
    if (!entries || entries.length === 0) {
        return {
            currentEpisode: null,
            historicalEpisodes: [],
            successRate: 0,
            avgDuration: 0,
        };
    }

    const episodes: RecoveryEpisode[] = [];
    let currentEp: RecoveryEpisode | null = null;
    let currentEntries: MoodActivityRow[] = [];
    let startOfRecovery: string | null = null;
    let startOfNonRecovery: string | null = null;
    let activityOccurance: Map<Activity, {worsening: number, recovering: number}> = new Map();

    // Find all the days with mood dips
    const dipDates: Set<string> = new Set();
    entries.forEach((entry) => {
        if (entry.mood <= DIP_THRESHOLD)
            dipDates.add(localDateString(entry.date));
    });

    const processEntry = (entry: MoodActivityRow) => {
        if (!currentEp) return;

        const mood = entry.mood;
        const activities = entry.activities ?? [];

        if (mood >= RECOVERY_THRESHOLD || mood > currentEp.currentMood)
            activities.forEach((a) => {
                const occurance = activityOccurance.get(a) ?? {worsening: 0, recovering: 0};
                occurance.recovering += 1;
                activityOccurance.set(a, occurance);
            });
        else if (mood < currentEp.currentMood || mood <= DIP_THRESHOLD)
            activities.forEach((a) => {
                const occurance = activityOccurance.get(a) ?? {worsening: 0, recovering: 0};
                occurance.worsening += 1;
                activityOccurance.set(a, occurance);
            });

        if (mood <= DIP_THRESHOLD && currentEp.currentMood >= NONRECOVERY_THRESHOLD)
                currentEp.dips += 1;

        if (mood < currentEp.worstMood)
            currentEp.worstMood = mood;

        currentEntries.push(entry);
        currentEp.currentMood = mood;
    }
        
    const finalizeActivities = (episode: RecoveryEpisode) => {
        const activities = [...activityOccurance.entries()]
        episode.worseningActivities = new Set(activities.filter((v) => {
                const [_, {worsening, recovering}] = v;
                return worsening > recovering;
            })
            .sort((v1, v2) => v2[1].worsening - v1[1].worsening)
            .splice(0, 10)
            .map((v) => v[0]));

        episode.recoveringActivities = new Set(activities.filter((v) => {
                const [_, {worsening, recovering}] = v;
                return recovering > worsening;
            })
            .sort((v1, v2) => v2[1].recovering - v1[1].recovering)
            .splice(0, 10)
            .map((v) => v[0]));
    }

    const finalizeCurrentEpisode = () => {
        if (!currentEp) return;

        const lastDate = currentEntries[currentEntries.length - 1]?.date ?? null;
        currentEp.durationDays = daysBetween(currentEp.startDate, lastDate, true);
        currentEp.entries = currentEntries.map((e) => ({date: e.date, mood: e.mood}));

        finalizeActivities(currentEp);

        currentEntries = [];
        activityOccurance.clear();
    }

    const closeCurrentEpisode = () => {
        if (!currentEp) return;

        finalizeCurrentEpisode();

        const lastDate = currentEp.entries[currentEp.entries.length - 1]?.date ?? null;
        currentEp.endDate = lastDate;

        episodes.push(currentEp);
        currentEp = null;
    }

    for (const entry of entries) {
        if (!entry || typeof entry.date !== 'string') continue;
        if (typeof entry.mood !== 'number' || !Number.isFinite(entry.mood)) continue;
        if (Number.isNaN(convertStringToDate(entry.date).getTime())) continue;

        const mood = entry.mood;
        const isOnDipDate = dipDates.has(localDateString(entry.date));
        if (!currentEp && mood <= DIP_THRESHOLD) {
            currentEp = {
                startDate: entry.date,
                endDate: null,
                worstMood: mood,
                currentMood: mood,
                durationDays: 0,
                dips: 1,
                entries: [],
                worseningActivities: new Set(),
                recoveringActivities: new Set(),
                recovered: false,
            };
            startOfRecovery = null;
            startOfNonRecovery = null;
            currentEntries = [];
            processEntry(entry);
        }
        else if (currentEp && !isOnDipDate && mood >= RECOVERY_THRESHOLD) {
            processEntry(entry);

            if (startOfRecovery == null) {
                startOfRecovery = entry.date;
                if (startOfNonRecovery == null)
                    startOfNonRecovery = entry.date;
                continue;
            }

            const recoveryDays = daysBetween(startOfRecovery, entry.date, true);
            if (recoveryDays >= MIN_RECOVERY_DAYS) {
                currentEp.recovered = true;
                closeCurrentEpisode();
            }
        }
        else if (currentEp) {
            processEntry(entry);

            if (!isOnDipDate && mood >= NONRECOVERY_THRESHOLD) {
                if (startOfNonRecovery == null) {
                    startOfNonRecovery = entry.date;
                    startOfRecovery = null;
                    continue;
                }

                const recoveryDays = daysBetween(startOfNonRecovery, entry.date, true);
                if (recoveryDays >= MIN_NONRECOVERY_DAYS) {
                    currentEp.recovered = false;
                    closeCurrentEpisode();
                }
            }
            else {
                startOfRecovery = null;
                startOfNonRecovery = null;
            }
        }
    }

    // Ongoing episode, if any
    if (currentEp)
        finalizeCurrentEpisode();

    const completed = episodes.filter((ep) => ep.endDate).sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
    const recovered = completed.filter((ep) => ep.recovered);
    const successRate =
        completed.length > 0 ? (recovered.length / completed.length) * 100 : 0;
    const avgDuration =
        completed.length > 0
            ? completed.reduce((s, ep) => s + ep.durationDays, 0) /
              completed.length
            : 0;

    return {
        currentEpisode: currentEp,
        historicalEpisodes: completed,
        successRate,
        avgDuration,
    };
};