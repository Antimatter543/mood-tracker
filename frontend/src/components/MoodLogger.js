import React, { useState } from 'react';
import axios from 'axios';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const moods = [
  { name: 'Great', color: '#4CAF50', emoji: '😎' },
  { name: 'Good', color: '#8BC34A', emoji: '😊' },
  { name: 'Okay', color: '#FFC107', emoji: '😐' },
  { name: 'Bad', color: '#FF9800', emoji: '😞' },
  { name: 'Awful', color: '#F44336', emoji: '😡' },
];

const MoodLogger = ({ onNewData }) => {
  const [selectedMood, setSelectedMood] = useState(null);
  const [note, setNote] = useState('');

  const handleSubmit = () => {
    axios
      .post('http://localhost:8000/api/mood', { mood: selectedMood, note })
      .then(response => {
        console.log('Mood saved:', response.data);
        setSelectedMood(null);
        setNote('');
        onNewData(); // Trigger data refresh
      })
      .catch(error => {
        console.error('There was an error saving the mood!', error);
      });
  };

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle>How are you feeling?</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex justify-between mb-4">
          {moods.map(mood => (
            <Button
              key={mood.name}
              onClick={() => setSelectedMood(mood.name)}
              className={`w-16 h-16 rounded-full ${
                selectedMood === mood.name ? 'ring-2 ring-offset-2' : ''
              }`}
              style={{ backgroundColor: mood.color }}
            >
              {mood.emoji}
            </Button>
          ))}
        </div>
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Add a note (optional)"
          className="w-full p-2 border rounded-md mb-4"
          rows={3}
        />
        <Button onClick={handleSubmit} className="w-full">
          Save Entry
        </Button>
      </CardContent>
    </Card>
  );
};

export default MoodLogger;
