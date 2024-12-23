import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import * as SQLite from 'expo-sqlite';
import { 
  Heart, Battery, Sun, Crown,
  BedDouble, Moon, Coffee, CloudRain,
  Brain, Smile, Frown, Meh, Book, Music, Users,
  Plus,
  LucideIcon,
  LucideProps
} from 'lucide-react-native';
import { colors, globalStyles } from '@/styles/global';

type Activity = {
  id: number;
  name: string;
  group: string;
  icon_path: string;
};

type ActivityGroup = {
  name: string;
  activities: Activity[];
};

type ActivitySelectorProps = {
  onSelectActivity: (activityId: number) => void;
  selectedActivities: number[];
};

const IconMap: Record<string, LucideIcon> = {
  'happy': Smile,
  'tired': BedDouble,
  'relaxed': Smile,
  'energetic': Battery,
  'stressed': Brain,
  'anxious': CloudRain,
  'content': Sun,
  'sleeping': Moon,
  'reading': Book,
  'exercise': Battery,
  'music': Music,
  'social': Users,
  // Add more mappings as needed
};

export function ActivitySelector({ onSelectActivity, selectedActivities }: ActivitySelectorProps) {
  const [activityGroups, setActivityGroups] = useState<ActivityGroup[]>([]);
  const db = SQLite.useSQLiteContext();

  useEffect(() => {
    loadActivities();
  }, []);

  const loadActivities = async () => {
    try {
      const activities = await db.getAllAsync<Activity>(
        'SELECT * FROM activities ORDER BY "group", name'
      );

      // Group activities by their group property
      const grouped = activities.reduce((acc: { [key: string]: Activity[] }, activity) => {
        if (!acc[activity.group]) {
          acc[activity.group] = [];
        }
        acc[activity.group].push(activity);
        return acc;
      }, {});

      const groups = Object.entries(grouped).map(([name, activities]) => ({
        name,
        activities,
      }));

      setActivityGroups(groups);
      console.log("Did activities thing! We have activities", activityGroups.length, activities)
    } catch (error) {
      console.error('Error loading activities:', error);
    }
  };

  const handleActivityPress = (activityId: number) => {
    onSelectActivity(activityId);
  };

  const renderIcon = (iconPath: string, isSelected: boolean) => {
    const IconComponent = IconMap[iconPath.toLowerCase()] || Plus;
    const iconProps: LucideProps = {
      size: 24,
      color: isSelected ? 'pink' : colors.text // Changed to use pink for selected state
    };
    
    return <IconComponent {...iconProps} />;
  };

  if (activityGroups.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyStateText}>No activities found.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      {activityGroups.map((group) => (
        <View key={group.name} style={styles.groupContainer}>
          <Text style={styles.groupTitle}>{group.name}</Text>
          <View style={styles.activitiesGrid}>
            {group.activities.map((activity) => {
              const isSelected = selectedActivities.includes(activity.id);
              return (
                <TouchableOpacity
                  key={activity.id}
                  style={[
                    styles.activityButton,
                    isSelected && styles.selectedActivity,
                  ]}
                  onPress={() => handleActivityPress(activity.id)}
                >
                  {renderIcon(activity.icon_path, isSelected)}
                  <Text
                    style={[
                      styles.activityText,
                      isSelected && styles.selectedText,
                    ]}
                  >
                    {activity.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    color: 'white',
    marginBottom: 16,
    height: 300,
    // minHeight: 200, // Add this to ensure visibility
  },
  groupContainer: {
    marginBottom: 20,
  },
  groupTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 10,
    paddingHorizontal: 16,
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  activitiesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 8,
  },
  activityButton: {
    width: '20%',
    aspectRatio: 1,
    padding: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    margin: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    shadowColor: 'pink',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 4.65,
    elevation: 8,
  },
  selectedActivity: {
    backgroundColor: 'rgba(255, 192, 203, 0.15)', // Light pink with transparency
    borderColor: 'pink',
  },
  activityText: {
    color: colors.text,
    fontSize: 12,
    marginTop: 4,
    textAlign: 'center',
  },
  selectedText: {
    color: 'pink',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyStateText: {
    color: colors.text,
    fontSize: 16,
  },
});