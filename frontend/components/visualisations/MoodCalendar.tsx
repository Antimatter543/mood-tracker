import { Card } from '@/components/Card';
import { useDataContext } from '@/context/DataContext';
import { useThemeColors } from '@/styles/global';
import { useSQLiteContext } from 'expo-sqlite';
import React, { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { Calendar } from 'react-native-calendars';
import {
  buildCalendarMarkers,
  type MoodMarking,
  type MoodMarkerRow,
} from './transforms/calendarMarkers';
import {
  startOfLocalDay,
  endOfLocalDay,
  localDateString,
} from './transforms/dateHelpers';

// Changed to default export
const MoodCalendar = () => {
  const db = useSQLiteContext();
  const colors = useThemeColors();
  const { refreshCount } = useDataContext();
  const [moodMarkers, setMoodMarkers] = useState<MoodMarking>({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadMonthData = async () => {
      try {
        setIsLoading(true);
        // Use LOCAL-time boundaries so an entry made late on the last day of
        // the month doesn't fall outside the window because of UTC drift.
        const today = new Date();
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
        const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        const startStr = startOfLocalDay(localDateString(firstDay));
        const endStr = endOfLocalDay(localDateString(lastDay));

        const rows = await db.getAllAsync<MoodMarkerRow>(`
          SELECT
            date(date) as date,
            ROUND(AVG(mood), 1) as avgMood
          FROM entries
          WHERE date BETWEEN ? AND ?
          GROUP BY date(date)
          ORDER BY date
        `, [startStr, endStr]);

        setMoodMarkers(buildCalendarMarkers(rows));
        setIsLoading(false);
      } catch (error) {
        console.error('Error loading mood calendar data:', error);
        setIsLoading(false);
      }
    };

    loadMonthData();
  }, [db, refreshCount]);

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