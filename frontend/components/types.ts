

// Base Types

import { IconFamilyType } from "./iconRegistry";


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


// entry_media table — one row per photo attached to an entry.
export type EntryPhoto = {
  id: number;          // DB row id (0 for an unsaved/pending photo)
  entry_id: number;
  file_path: string;   // absolute path inside the app's documentDirectory
  media_type: string;  // 'image' for V1 (column reserved for future types)
  created_at?: string; // UTC ISO when available (legacy V1 rows may omit it)
};

// Entries table
export type MoodEntry = {
  id: number;
  mood: number;
  notes: string;
  date: string;
  activities: Activity[];
  // Optional so existing constructors that don't know about photos still
  // type-check. Populated by getMoodEntries / DBViewer.fetchEntriesPage.
  photos?: EntryPhoto[];
  // Star / pin state. NULL/absent = not starred; a UTC ISO-8601 instant = when
  // the entry was starred (the one column carries both the flag AND the when).
  // Optional so existing constructors that predate starring still type-check,
  // mirroring how `photos` was added. Populated by getMoodEntries /
  // getEntriesPage; toggled via setEntryStarred.
  starred_at?: string | null;
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
  };




/////// CHART STUFF

export type WeeklyMoodResult = {
    avgMood: number | null;
    date: string;
};