import React, { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const moods = [
  { name: 'Great', color: '#4CAF50', emoji: '😎' },
  { name: 'Good', color: '#8BC34A', emoji: '😊' },
  { name: 'Okay', color: '#FFC107', emoji: '😐' },
  { name: 'Bad', color: '#FF9800', emoji: '😞' },
  { name: 'Awful', color: '#F44336', emoji: '😡' },
];

const CalendarView = () => {
  const [currentDate, setCurrentDate] = useState(new Date());

  const navigateMonth = direction => {
    setCurrentDate(new Date(currentDate.setMonth(currentDate.getMonth() + direction)));
  };

  // Dummy function to simulate fetching mood data for each day
  const getDummyMoodForDay = day => {
    const mood = moods[Math.floor(Math.random() * moods.length)];
    return <div className="w-6 h-6 rounded-full mx-auto" style={{ backgroundColor: mood.color }} />;
  };

  const renderCalendar = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const days = [];
    for (let i = 0; i < firstDay; i++) {
      days.push(<div key={`empty-${i}`} className="h-12" />);
    }
    for (let day = 1; day <= daysInMonth; day++) {
      days.push(
        <div key={day} className="h-12 border flex flex-col justify-between p-1">
          <span className="text-xs">{day}</span>
          {getDummyMoodForDay(day)}
        </div>
      );
    }

    return days;
  };

  return (
    <Card className="w-full max-w-3xl mx-auto">
      <CardHeader className="flex flex-row items-center justify-between">
        <Button onClick={() => navigateMonth(-1)} variant="ghost" size="icon">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <CardTitle>{currentDate.toLocaleString('default', { month: 'long', year: 'numeric' })}</CardTitle>
        <Button onClick={() => navigateMonth(1)} variant="ghost" size="icon">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-7 gap-1">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
            <div key={day} className="text-center font-bold">
              {day}
            </div>
          ))}
          {renderCalendar()}
        </div>
      </CardContent>
    </Card>
  );
};

export default CalendarView;
