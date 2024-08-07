import { Card } from '@/components/Card';
import { useDataContext } from '@/context/DataContext';
import { useSQLiteContext } from 'expo-sqlite';
import React, { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { Calendar } from 'react-native-calendars';

type MoodMarking = {
  [date: string]: {
    customStyles: {
      container: {
        backgroundColor: string;
      };
      text: {
        color: string;
      };
    };
  };
};

// Changed to default export
const MoodCalendar = () => {
  const db = useSQLiteContext();
  const { refreshCount } = useDataContext();
  const [moodMarkers, setMoodMarkers] = useState<MoodMarking>({});
  const [isLoading, setIsLoading] = useState(true);

  // Function to get color based on mood value
  const getMoodColor = (mood: number) => {
    if (mood >= 8) return '#4CAF50';
    if (mood >= 6) return '#8BC34A';
    if (mood >= 4) return '#FFC107';
    if (mood >= 2) return '#FF9800';
    return '#F44336';
  };

  useEffect(() => {
    console.log('MoodCalendar mounted');
    const loadMonthData = async () => {
      try {
        setIsLoading(true);
        const today = new Date();
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
        const firstDayStr = firstDay.toISOString().split('T')[0];
        const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        const lastDayStr = lastDay.toISOString().split('T')[0];

        const entries = await db.getAllAsync<{date: string, avgMood: number}>(`
          SELECT 
            date(date) as date,
            AVG(mood) as avgMood
          FROM entries
          WHERE date BETWEEN ? AND ?
          GROUP BY date(date)
          ORDER BY date
        `, [firstDayStr, lastDayStr]);

        const markers: MoodMarking = {};
        entries.forEach(entry => {
          const moodColor = getMoodColor(Number(entry.avgMood));
          markers[entry.date] = {
            customStyles: {
              container: {
                backgroundColor: moodColor,
              },
              text: {
                color: '#FFFFFF',
              },
            },
          };
        });

        setMoodMarkers(markers);
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
        <Text style={{ color: '#ffffff', textAlign: 'center', padding: 20 }}>
          Loading calendar...
        </Text>
      ) : (
        <Calendar
          markingType={'custom'}
          markedDates={moodMarkers}
          theme={{
            backgroundColor: '#25292e',
            calendarBackground: '#25292e',
            textSectionTitleColor: '#ffffff',
            selectedDayBackgroundColor: '#4CAF50',
            selectedDayTextColor: '#ffffff',
            todayTextColor: '#4CAF50',
            dayTextColor: '#ffffff',
            textDisabledColor: '#666666',
            monthTextColor: '#ffffff',
            arrowColor: '#ffffff',
          }}
          style={{ borderRadius: 16 }}
        />
      )}
    </Card>
  );
};

// Add default export
export default MoodCalendar;