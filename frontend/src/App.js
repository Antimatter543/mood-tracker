import React, { useState } from 'react';
import MoodTracker from './components/MoodTracker';
import DataDisplay from './components/DataDisplay';

function App() {
  const [moods, setMoods] = useState([]);
  const [activities, setActivities] = useState([]);

  const handleNewData = () => {
    // Implement fetchData logic here to update moods and activities
  };

  return (
    <div className="App">
      <MoodTracker onNewData={handleNewData} />
      <DataDisplay moods={moods} activities={activities} />
    </div>
  );
}

export default App;
