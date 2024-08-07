import React, { useState, useEffect } from 'react';
import axios from 'axios';

const DataDisplay = () => {
    const [moods, setMoods] = useState([]);
    const [activities, setActivities] = useState([]);

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        try {
            const moodsResponse = await axios.get('http://localhost:8000/api/mood');
            const activitiesResponse = await axios.get('http://localhost:8000/api/activity');
            setMoods(moodsResponse.data);
            setActivities(activitiesResponse.data);
        } catch (error) {
            console.error('Error fetching data:', error);
        }
    };

    return (
        <div>
            <h2>Moods</h2>
            <table>
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>Date</th>
                        <th>Mood</th>
                    </tr>
                </thead>
                <tbody>
                    {moods.map((mood) => (
                        <tr key={mood.id}>
                            <td>{mood.id}</td>
                            <td>{mood.date}</td>
                            <td>{mood.mood}</td>
                        </tr>
                    ))}
                </tbody>
            </table>

            <h2>Activities</h2>
            <table>
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>Date</th>
                        <th>Activity</th>
                    </tr>
                </thead>
                <tbody>
                    {activities.map((activity) => (
                        <tr key={activity.id}>
                            <td>{activity.id}</td>
                            <td>{activity.date}</td>
                            <td>{activity.activity}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

export default DataDisplay;
