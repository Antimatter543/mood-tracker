import React, { useState } from 'react';
import axios from 'axios';

const ActivityLogger = () => {
    const [activity, setActivity] = useState('');

    const handleActivityChange = (e) => {
        setActivity(e.target.value);
    };

    const saveActivity = () => {
        axios.post('http://localhost:8000/api/activity', { activity })
            .then(response => {
                console.log('Activity saved:', response.data);
            })
            .catch(error => {
                console.error('There was an error saving the activity!', error);
            });
    };

    return (
        <div>
            <input type="text" value={activity} onChange={handleActivityChange} />
            <button onClick={saveActivity}>Save Activity</button>
        </div>
    );
};

export default ActivityLogger;
