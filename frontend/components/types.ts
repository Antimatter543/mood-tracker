

// Base Types

import { IconFamilyType } from "./IconPicker";


// Activity table 
export type Activity = {
  id: number;
  group_id: number;
  name: string;
  icon_name: string;
  icon_family: IconFamilyType;
  position: number;
};


// Actity group table
export type ActivityGroup = {
  id: number;
  name: string;
};


// Entries table
export type MoodEntry = {
  id: number;
  mood: number;
  notes: string;
  date: string;
  activities: Activity[];
};
  
  // Database Response Types
  export type DatabaseResult = {
    success: boolean;
    message: string;
    data?: any;
    filePath?: string;  // Add this optional property
  };
  
  // Component Props Types
  export type ActivitySelectorProps = {
    onSelectActivity: (activityId: number) => void;
    selectedActivities: number[];
  };
  
  // Context Types
  export type DataContextType = {
    refetchEntries: () => void;
    refreshCount: number;
  };




/////// CHART STUFF

export type WeeklyMoodResult = {
    avgMood: number | null;
    date: string;
};