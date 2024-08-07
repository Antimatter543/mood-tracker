import React from 'react';
import MoodSelector from './components/MoodSelector';
import ActivityLogger from './components/ActivityLogger';
import DataDisplay from './components/DataDisplay';

function App() {
    return (
        <div className="App">
            <h1>Mood Tracker</h1>
            <MoodSelector />
            <ActivityLogger />
            <DataDisplay />
        </div>
    );
}

export default App;
