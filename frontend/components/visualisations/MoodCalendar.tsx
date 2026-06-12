import { Card } from '@/components/Card';
import { useDataRefresh } from '@/hooks/useDataRefresh';
import { useThemeColors } from '@/styles/global';
import { useSQLiteContext } from 'expo-sqlite';
import React, { useCallback, useState } from 'react';
import { Text } from 'react-native';
import { Calendar } from 'react-native-calendars';
import {
  buildCalendarMarkers,
  type MoodMarking,
} from './transforms/calendarMarkers';
import { dailyAverageRows } from './transforms/dailyAverages';
import { WEEKLY_MOOD_AVERAGES } from './queries';
import {
  startOfLocalDay,
  endOfLocalDay,
  localDateString,
} from './transforms/dateHelpers';

// Changed to default export
const MoodCalendar = () => {
  const db = useSQLiteContext();
  const colors = useThemeColors();
  const [moodMarkers, setMoodMarkers] = useState<MoodMarking>({});
  const [isLoading, setIsLoading] = useState(true);

  const loadMonthData = useCallback(async () => {
      try {
        setIsLoading(true);
        // Use LOCAL-time boundaries so an entry made late on the last day of
        // the month doesn't fall outside the window because of UTC drift.
        const today = new Date();
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
        const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        const startStr = startOfLocalDay(localDateString(firstDay));
        const endStr = endOfLocalDay(localDateString(lastDay));

        // Raw {date: instant, mood} rows -> per-LOCAL-day markers in JS, so a
        // late-evening entry is marked on the user's calendar day, not the UTC
        // one (the old SQL grouped via date(date) in UTC).
        const rawRows = await db.getAllAsync<{ date: string; mood: number }>(
          WEEKLY_MOOD_AVERAGES,
          [startStr, endStr],
        );

        setMoodMarkers(buildCalendarMarkers(dailyAverageRows(rawRows)));
        setIsLoading(false);
      } catch (error) {
        console.error('Error loading mood calendar data:', error);
        setIsLoading(false);
      }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- query reads only db; setState identities are stable
    }, [db]);
  // Focus-aware refetch (replaces useEffect([db, refreshCount])).
  useDataRefresh(loadMonthData, [db]);

  if (!Calendar) {
    return (
      <Card>
        <Text style={{ color: '#ff4444', textAlign: 'center', padding: 20 }}>
          Calendar component not available
        </Text>
      </Card>
    );
  }

  return (
    <Card>
      {isLoading ? (
        <Text style={{ color: colors.textSecondary, textAlign: 'center', padding: 20 }}>
          Loading calendar...
        </Text>
      ) : (
        <Calendar
          markingType={'custom'}
          markedDates={moodMarkers}
          theme={{
            backgroundColor: colors.cardBackground,
            calendarBackground: colors.cardBackground,
            textSectionTitleColor: colors.text,
            selectedDayBackgroundColor: colors.accent,
            selectedDayTextColor: '#FFFFFF',
            todayTextColor: colors.accent,
            dayTextColor: colors.text,
            textDisabledColor: colors.textSecondary,
            monthTextColor: colors.text,
            arrowColor: colors.text,
          }}
          style={{ borderRadius: 16 }}
        />
      )}
    </Card>
  );
};

// Add default export
export default MoodCalendar;