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
import { addDays, convertStringToDate, localDateString } from "@/databases/dateHelpers";

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
                occurance.recovering += (mood - currentEp!.currentMood)
                        + (mood >= RECOVERY_THRESHOLD ? 1 : 0);
                activityOccurance.set(a, occurance);
            });
        else if (mood < currentEp.currentMood || mood <= DIP_THRESHOLD)
            activities.forEach((a) => {
                const occurance = activityOccurance.get(a) ?? {worsening: 0, recovering: 0};
                occurance.worsening += (currentEp!.currentMood - mood)
                        + (mood <= DIP_THRESHOLD ? 1 : 0);
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

        // Count activities that have at least 5 % more worsening occurancies
        // than recovering as worsening activites. Select the ten such activities
        // with highest worsening - recovering count.
        episode.worseningActivities = new Set(activities.filter((v) => {
                const [_, {worsening, recovering}] = v;
                return worsening / (worsening + recovering) >= 0.55;
            })
            .sort((v1, v2) => 
                    (v2[1].worsening - v2[1].recovering)
                    - (v1[1].worsening - v1[1].recovering))
            .splice(0, 10)
            .map((v) => v[0]));

        // Count activities that have at least 5 % more recovering occurancies
        // than worsening as recovering activites. Select the ten such activities
        // with highest recovering - worsening count.
        episode.recoveringActivities = new Set(activities.filter((v) => {
                const [_, {worsening, recovering}] = v;
                return recovering / (worsening + recovering) >= 0.55;
            })
            .sort((v1, v2) => 
                    (v2[1].recovering - v2[1].worsening)
                    - (v1[1].recovering - v1[1].worsening))
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

    const lastDay = addDays(localDateString(entries[entries.length - 1].date), -1);
    for (const entry of entries) {
        if (!entry || typeof entry.date !== 'string') continue;
        if (typeof entry.mood !== 'number' || !Number.isFinite(entry.mood)) continue;
        if (Number.isNaN(convertStringToDate(entry.date).getTime())) continue;

        // If current entry day or the following day has a dip, entry is not
        // considered for inclusion in recovery.
        const localDay = localDateString(entry.date);
        const dipping = dipDates.has(localDay) || (localDay <= lastDay && dipDates.has(addDays(localDay, 1)));

        const mood = entry.mood;

        if (!currentEp && mood <= DIP_THRESHOLD) {
            currentEp = {
                startDate: entry.date,
                endDate: null,
                worstMood: mood,
                currentMood: mood,
                durationDays: 0,
                dips: 0,
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
        else if (currentEp) {
            processEntry(entry);

            if (!dipping && mood >= RECOVERY_THRESHOLD) {
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
            else if (!dipping && mood >= NONRECOVERY_THRESHOLD) {
                startOfRecovery = null;
                if (startOfNonRecovery == null) {
                    startOfNonRecovery = entry.date;
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