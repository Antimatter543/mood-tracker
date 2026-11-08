import { useCallback, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';
import { useDataRefresh } from '@/hooks/useDataRefresh';
import { getHealthMetricsRange } from '@/databases/health-metrics';
import { shouldShowHealthConnect } from '@/lib/healthConnectConfig';
import { now } from '@/lib/clock';
import type { MoodEntry } from '../types';
import { localDayKey, sectionKeyForDate } from './dateHeader';
import { dayHealthByDay, type DayHealth } from './dayHealth';
import type { TimelineHealth } from './timelineRows';

const NO_HEALTH: ReadonlyMap<string, DayHealth> = new Map();

/**
 * Health Connect figures for the days of the loaded entry window (newest first),
 * or undefined where Health Connect does not exist. Re-read on every data change,
 * which a sync and a disconnect both signal.
 */
export const useTimelineHealth = (
    db: SQLiteDatabase,
    entries: readonly MoodEntry[]
): TimelineHealth | undefined => {
    const enabled = shouldShowHealthConnect(Platform.OS);
    const newestDay = entries.length > 0 ? sectionKeyForDate(entries[0].date) : null;
    const oldestDay = entries.length > 0 ? sectionKeyForDate(entries[entries.length - 1].date) : null;
    const [byDay, setByDay] = useState(NO_HEALTH);

    const load = useCallback(() => {
        if (!enabled || !newestDay || !oldestDay) {
            setByDay(NO_HEALTH);
            return;
        }
        let live = true;
        getHealthMetricsRange(db, oldestDay, newestDay).then((rows) => {
            if (live) setByDay(dayHealthByDay(rows));
        });
        return () => {
            live = false;
        };
    }, [db, enabled, newestDay, oldestDay]);
    useDataRefresh(load, [load]);

    const todayKey = localDayKey(now());
    return useMemo(
        () => (enabled ? { byDay, todayKey } : undefined),
        [enabled, byDay, todayKey]
    );
};
