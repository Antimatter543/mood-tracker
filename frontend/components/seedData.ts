import Feather from '@expo/vector-icons/Feather';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import Ionicons from '@expo/vector-icons/Ionicons';
import FontAwesome6 from '@expo/vector-icons/FontAwesome6';

// First let's update the type to accept any icon component
type IconComponent = typeof Feather | typeof MaterialCommunityIcons | typeof MaterialIcons | typeof Ionicons | typeof FontAwesome6;

export const initialActivityGroups = [
    { name: 'Emotions' },     // id 1
    { name: 'Sleep' },        // id 2
    { name: 'Social' },       // id 3
    { name: 'Activities' },   // id 4
    { name: 'Health' }        // id 5
];



export const initialActivities = [
    // Emotions (1)
    { name: 'Happy', group_id: 1, icon_family: 'Feather', icon_name: 'smile' },
    { name: 'Content', group_id: 1, icon_family: 'Feather', icon_name: 'sun' },
    { name: 'Grateful', group_id: 1, icon_family: 'Feather', icon_name: 'heart' },
    { name: 'Anxious', group_id: 1, icon_family: 'MaterialCommunityIcons', icon_name: 'weather-lightning-rainy' },
    { name: 'Stressed', group_id: 1, icon_family: 'Feather', icon_name: 'alert-circle' },
    { name: 'Tired', group_id: 1, icon_family: 'MaterialCommunityIcons', icon_name: 'sleep' },
    { name: 'Frustrated', group_id: 1, icon_family: 'Feather', icon_name: 'frown' },
    { name: 'Unmotivated', group_id: 1, icon_family: 'Feather', icon_name: 'meh' },
    { name: 'Overwhelmed', group_id: 1, icon_family: 'MaterialCommunityIcons', icon_name: 'brain' },
    { name: 'Calm', group_id: 1, icon_family: 'Feather', icon_name: 'cloud' },
    { name: 'Hopeful', group_id: 1, icon_family: 'Feather', icon_name: 'sun' },
    { name: 'Energetic', group_id: 1, icon_family: 'MaterialCommunityIcons', icon_name: 'lightning-bolt' },
    { name: 'Confident', group_id: 1, icon_family: 'MaterialCommunityIcons', icon_name: 'arm-flex-outline' },


    // Sleep (2)
    { name: 'Good Sleep', group_id: 2, icon_family: 'MaterialCommunityIcons', icon_name: 'sleep' },
    { name: 'Okay Sleep', group_id: 2, icon_family: 'FontAwesome6', icon_name: 'bed' },
    { name: 'Bad Sleep', group_id: 2, icon_family: 'MaterialCommunityIcons', icon_name: 'sleep-off' },
    { name: 'Nap', group_id: 2, icon_family: 'Feather', icon_name: 'sun' },

    // Social (3)
    { name: 'Family Time', group_id: 3, icon_family: 'Feather', icon_name: 'users' },
    { name: 'Friends', group_id: 3, icon_family: 'Feather', icon_name: 'users' },
    { name: 'Dates', group_id: 3, icon_family: 'Feather', icon_name: 'heart' },
    { name: 'Event', group_id: 3, icon_family: 'MaterialCommunityIcons', icon_name: 'party-popper' },
    { name: 'Me Time', group_id: 3, icon_family: 'Feather', icon_name: 'user' },

    // Activities (4)
    { name: 'Exercise', group_id: 4, icon_family: 'MaterialCommunityIcons', icon_name: 'run' },
    { name: 'Reading', group_id: 4, icon_family: 'Feather', icon_name: 'book' },
    { name: 'Music', group_id: 4, icon_family: 'Feather', icon_name: 'music' },
    { name: 'Gaming', group_id: 4, icon_family: 'MaterialCommunityIcons', icon_name: 'gamepad-variant' },
    { name: 'Work', group_id: 4, icon_family: 'Feather', icon_name: 'briefcase' },
    { name: 'Study', group_id: 4, icon_family: 'MaterialCommunityIcons', icon_name: 'book-open-page-variant' },
    { name: 'Coding', group_id: 4, icon_family: 'Feather', icon_name: 'code' },
    { name: 'Nature', group_id: 4, icon_family: 'MaterialCommunityIcons', icon_name: 'tree' },

    // Health (5)
    { name: 'Healthy Food', group_id: 5, icon_family: 'MaterialCommunityIcons', icon_name: 'fruit-watermelon' },
    { name: 'Fast Food', group_id: 5, icon_family: 'MaterialCommunityIcons', icon_name: 'hamburger' },
    { name: 'Sick', group_id: 5, icon_family: 'MaterialCommunityIcons', icon_name: 'emoticon-sick-outline' },
    { name: 'Headache', group_id: 5, icon_family: 'MaterialCommunityIcons', icon_name: 'head-sync' },
];