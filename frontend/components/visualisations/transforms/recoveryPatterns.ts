// recoveryPatterns.ts
//
// Finds "low stretches": runs of entries that start with a low mood (4 or
// lower) and end once moods have come back up for long enough.
//
// Pulled out of the React component so:
//   - The detection logic can be unit-tested with synthetic series.
//   - The component stays a thin renderer.
//   - The <2-data-point edge case (which crashed before) is handled here.
import { Activity } from "@/components/types";
import {
    addDays,
    calendarDaysSpanned,
    convertStringToDate,
    localDateString,
    localDateTimeString,
} from "@/databases/dateHelpers";

export const RECOVERY_THRESHOLD = 6.0;
export const DIP_THRESHOLD = 4.0;
export const NONRECOVERY_THRESHOLD = 5.0;
export const MIN_RECOVERY_DAYS = 2;
export const MIN_NONRECOVERY_DAYS = 4;
/** An activity is listed only when it was logged on at least this many entries of the stretch. */
export const MIN_ACTIVITY_ENTRIES = 2;
/** Share of an activity's score that must point one way before it is listed. */
export const ACTIVITY_SHARE = 0.55;
/** At most this many activities per list. */
export const MAX_ACTIVITIES = 10;

/**
 * What the (i) bubble says, written from the rules in the loop below. Keep it
 * in step with the thresholds: a test checks each number appears.
 */
export const LOW_STRETCH_EXPLAINER =
    'A low stretch starts with an entry of 4 or lower. It is back to 6+ once ' +
    'two days have entries of 6 or more, with nothing lower in between and no ' +
    'entry of 4 or lower that day or the next. If entries stay at 5 or more ' +
    'for four days without that, it ends as steady at 5+. This looks at the ' +
    'last 90 days. The activity lists show what you logged at those times, ' +
    'not what caused it.';

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
    /** Ended stretches, newest first. */
    historicalEpisodes: RecoveryEpisode[];
    /** Every stretch in the window, the open one included. */
    episodeCount: number;
    /** Ended stretches that came back to RECOVERY_THRESHOLD+. */
    recoveredCount: number;
    /** Mean length in days of the recovered stretches only; null when none. */
    avgRecoveredDays: number | null;
};

type ActivityScore = { worsening: number; recovering: number; entries: number };

/** A row the analysis can use: a parseable date and a finite mood. */
const isUsableRow = (entry: MoodActivityRow | null | undefined): entry is MoodActivityRow =>
    !!entry &&
    typeof entry.date === 'string' &&
    typeof entry.mood === 'number' &&
    Number.isFinite(entry.mood) &&
    !Number.isNaN(convertStringToDate(entry.date).getTime());

/**
 * Pick the activities that lean one way. Only activities logged on at least
 * MIN_ACTIVITY_ENTRIES entries of the stretch count, and only when at least
 * ACTIVITY_SHARE of their (never negative) score points that way.
 */
const leaningActivities = (
    scores: Map<Activity, ActivityScore>,
    side: 'worsening' | 'recovering',
): Set<Activity> => {
    const other = side === 'worsening' ? 'recovering' : 'worsening';
    return new Set(
        [...scores.entries()]
            .filter(([, s]) => {
                const total = s.worsening + s.recovering;
                return s.entries >= MIN_ACTIVITY_ENTRIES && total > 0 && s[side] / total >= ACTIVITY_SHARE;
            })
            .sort(([, a], [, b]) => (b[side] - b[other]) - (a[side] - a[other]))
            .slice(0, MAX_ACTIVITIES)
            .map(([activity]) => activity),
    );
};

/**
 * Analyse a list of mood entries (oldest first, the order the SQL emits:
 * `ORDER BY e.date, e.id ASC`) and return the low stretches + a summary.
 * Dates are local date-times (`YYYY-MM-DDTHH:mm:ss`) or bare `YYYY-MM-DD`
 * days; several entries a day are fine. Rows with an unparseable date or a
 * non-finite mood are skipped.
 *
 * Gracefully handles 0 data points — no crash, just empty episodes.
 */
export const analyseRecoveryPatterns = (
    rows: (MoodActivityRow | null | undefined)[]
): RecoveryAnalysis => {
    const entries = (rows ?? []).filter(isUsableRow);
    if (entries.length === 0) {
        return {
            currentEpisode: null,
            historicalEpisodes: [],
            episodeCount: 0,
            recoveredCount: 0,
            avgRecoveredDays: null,
        };
    }

    const episodes: RecoveryEpisode[] = [];
    let currentEp: RecoveryEpisode | null = null;
    let currentEntries: MoodActivityRow[] = [];
    // Local days with a qualifying entry since the current run started. A run
    // is broken by an entry that does not qualify (see the loop).
    const recoveryDays = new Set<string>();
    const nonRecoveryDays = new Set<string>();
    const activityScores = new Map<Activity, ActivityScore>();

    // Find all the days with mood dips
    const dipDates: Set<string> = new Set();
    entries.forEach((entry) => {
        if (entry.mood <= DIP_THRESHOLD)
            dipDates.add(localDateString(entry.date));
    });

    const processEntry = (entry: MoodActivityRow) => {
        if (!currentEp) return;

        const mood = entry.mood;
        const previous = currentEp.currentMood;
        const activities = entry.activities ?? [];

        // Each step adds a score that is never negative: a fall from 9 to 6
        // is not a lift, so it adds only the "at 6+" point.
        const lifted = mood >= RECOVERY_THRESHOLD || mood > previous;
        const dropped = !lifted && (mood < previous || mood <= DIP_THRESHOLD);
        const lift = Math.max(0, mood - previous) + (mood >= RECOVERY_THRESHOLD ? 1 : 0);
        const drop = Math.max(0, previous - mood) + (mood <= DIP_THRESHOLD ? 1 : 0);
        new Set(activities).forEach((a) => {
            const score = activityScores.get(a) ?? { worsening: 0, recovering: 0, entries: 0 };
            score.entries += 1;
            if (lifted) score.recovering += lift;
            else if (dropped) score.worsening += drop;
            activityScores.set(a, score);
        });

        if (mood <= DIP_THRESHOLD && previous >= NONRECOVERY_THRESHOLD)
            currentEp.dips += 1;

        if (mood < currentEp.worstMood)
            currentEp.worstMood = mood;

        currentEntries.push(entry);
        currentEp.currentMood = mood;
    }

    const finalizeCurrentEpisode = () => {
        if (!currentEp) return;

        const lastDate = currentEntries[currentEntries.length - 1].date;
        currentEp.durationDays = calendarDaysSpanned(currentEp.startDate, lastDate);
        currentEp.entries = currentEntries.map((e) => ({date: e.date, mood: e.mood}));
        currentEp.worseningActivities = leaningActivities(activityScores, 'worsening');
        currentEp.recoveringActivities = leaningActivities(activityScores, 'recovering');

        currentEntries = [];
        activityScores.clear();
    }

    const closeCurrentEpisode = (recovered: boolean) => {
        if (!currentEp) return;

        currentEp.recovered = recovered;
        finalizeCurrentEpisode();
        currentEp.endDate = currentEp.entries[currentEp.entries.length - 1].date;

        episodes.push(currentEp);
        currentEp = null;
    }

    for (const entry of entries) {
        // If current entry day or the following day has a dip, entry is not
        // considered for inclusion in recovery.
        const localDay = localDateString(entry.date);
        const dipping = dipDates.has(localDay) || dipDates.has(addDays(localDay, 1));

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
            recoveryDays.clear();
            nonRecoveryDays.clear();
            currentEntries = [];
            processEntry(entry);
        }
        else if (currentEp) {
            processEntry(entry);

            if (!dipping && mood >= RECOVERY_THRESHOLD) {
                // A 6+ entry also counts towards the 5+ run, but only a 6+
                // run can end the stretch here.
                recoveryDays.add(localDay);
                nonRecoveryDays.add(localDay);
                if (recoveryDays.size >= MIN_RECOVERY_DAYS)
                    closeCurrentEpisode(true);
            }
            else if (!dipping && mood >= NONRECOVERY_THRESHOLD) {
                recoveryDays.clear();
                nonRecoveryDays.add(localDay);
                if (nonRecoveryDays.size >= MIN_NONRECOVERY_DAYS)
                    closeCurrentEpisode(false);
            }
            else {
                recoveryDays.clear();
                nonRecoveryDays.clear();
            }
        }
    }

    // Ongoing episode, if any
    if (currentEp)
        finalizeCurrentEpisode();

    const completed = episodes.sort(
        (a, b) => convertStringToDate(b.startDate).getTime() - convertStringToDate(a.startDate).getTime());
    const recovered = completed.filter((ep) => ep.recovered);
    const avgRecoveredDays =
        recovered.length > 0
            ? recovered.reduce((s, ep) => s + ep.durationDays, 0) / recovered.length
            : null;

    return {
        currentEpisode: currentEp,
        historicalEpisodes: completed,
        episodeCount: completed.length + (currentEp ? 1 : 0),
        recoveredCount: recovered.length,
        avgRecoveredDays,
    };
};

/** One row of RECOVERY_ENTRY_ACTIVITIES: an entry joined to ONE of its activities (or none). */
export type RecoveryRawRow = {
    id: number;
    date: string;
    mood: number;
    aId: number | null;
    aName: string | null;
    aGroup: number | null;
    aIconFamily: Activity['icon_family'] | null;
    aIconName: string | null;
    aPosition: number | null;
};

/**
 * Fold the joined rows (one per entry x activity, ordered by date then entry
 * id) into one row per entry with its activities, the date turned into a
 * local date-time. One Activity object per id, so the analysis can key on it.
 * Rows whose stored date does not parse are skipped.
 */
export const groupRecoveryRows = (rawRows: RecoveryRawRow[]): MoodActivityRow[] => {
    const entries: MoodActivityRow[] = [];
    const activityById = new Map<number, Activity>();
    let lastEntry: MoodActivityRow | null = null;
    for (const raw of rawRows) {
        if (!raw || typeof raw.date !== 'string') continue;
        if (Number.isNaN(convertStringToDate(raw.date).getTime())) continue;

        // Entries & activities are ordered by date and then by the entry id:
        // when the id changes, a new entry starts.
        if (!lastEntry || lastEntry.id !== raw.id) {
            lastEntry = {
                id: raw.id,
                date: localDateTimeString(raw.date),
                mood: raw.mood,
                activities: [],
            };
            entries.push(lastEntry);
        }

        if (raw.aId != null) {
            let activity = activityById.get(raw.aId);
            if (!activity) {
                activity = {
                    id: raw.aId,
                    name: raw.aName ?? '',
                    group_id: raw.aGroup ?? 0,
                    icon_family: raw.aIconFamily as Activity['icon_family'],
                    icon_name: raw.aIconName ?? '',
                    position: raw.aPosition ?? 0,
                };
                activityById.set(raw.aId, activity);
            }
            lastEntry.activities.push(activity);
        }
    }
    return entries;
};

const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * Map a stretch's entries to line-chart pixel coordinates: mood 10 at the top
 * (y=0), mood 0 at the bottom (y=height); x spread by TIME between the first
 * and the last entry. One point, or entries that all share one instant, sit
 * in the middle. Moods are clamped to 0..10. Empty / non-positive dims → [].
 */
export const sparklineDatePoints = (
    values: {date: string | number, mood: number}[],
    width: number,
    height: number,
): { x: number; y: number }[] => {
    if (values.length === 0 || !(width > 0) || !(height > 0)) return [];

    const dateAsNumber = (date: string | number): number =>
        typeof date === 'string' ? convertStringToDate(date).getTime() : date;

    const n = values.length;
    const min = dateAsNumber(values[0].date);
    const max = dateAsNumber(values[n - 1].date);
    const span = max - min;
    return values.map((v) => {
        const clamped = Math.min(10, Math.max(0, v.mood));
        const x = n === 1 || !(span > 0) ? width / 2 : (dateAsNumber(v.date) - min) * (width / span);
        const y = height - clamped * (height / 10);
        return { x: round1(x), y: round1(y) };
    });
};
