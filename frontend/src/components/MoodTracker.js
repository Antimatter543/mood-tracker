import React, { useState } from 'react';
import { Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import MoodLogger from './MoodLogger';
import CalendarView from './CalendarView';

const MoodTracker = () => {
  const [view, setView] = useState('logger');

  return (
    <div className="p-4">
      <div className="flex justify-center mb-4">
        <Button onClick={() => setView('logger')} className="mr-2">
          Log Mood
        </Button>
        <Button onClick={() => setView('calendar')}>
          <Calendar className="mr-2 h-4 w-4" /> Calendar View
        </Button>
      </div>
      {view === 'logger' ? <MoodLogger /> : <CalendarView />}
    </div>
  );
};

export default MoodTracker;
