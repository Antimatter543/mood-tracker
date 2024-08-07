import React, { useState } from 'react';
import axios from 'axios';

const MoodSelector = () => {
    const [mood, setMood] = useState('');

    const handleMoodChange = (e) => {
        setMood(e.target.value);
    };

    const saveMood = () => {
        axios.post('http://localhost:8000/api/mood', { mood })
            .then(response => {
                console.log('Mood saved:', response.data);
            })
            .catch(error => {
                console.error('There was an error saving the mood!', error);
            });
    };

    return (
        <div>
            <select value={mood} onChange={handleMoodChange}>
                <option value="Great">Great</option>
                <option value="Good">Good</option>
                <option value="Okay">Okay</option>
                <option value="Bad">Bad</option>
                <option value="Awful">Awful</option>
            </select>
            <button onClick={saveMood}>Save Mood</button>
        </div>
    );
};

export default MoodSelector;
