import { SQLiteDatabase } from 'expo-sqlite';
import { Activity, DatabaseResult } from './types';
import { getActivities } from "@/databases/database";

/// GENERATE DATA (SETTINGS / ADMIN STUFF)

// Sample data arrays for generating more realistic entries
const sampleNotes = [
  'Feeling energized after a great workout!',
  'Had a productive day at work',
  'Feeling a bit stressed about deadlines',
  'Really enjoyed spending time with friends today',
  'Tired but satisfied with what I accomplished',
  'Meditation session helped calm my mind',
  'Struggling with anxiety today',
  'Perfect weather for a walk outside',
  'Need to work on getting better sleep',
  'Started a new book - feeling inspired',
  'Family dinner was lovely',
  'Missing home a bit today',
  'Proud of sticking to my goals',
  'Could use a mental health day',
  'Weekend plans looking promising'
];

const timeOfDayPhrases = [
  'Woke up feeling',
  'Morning has been',
  'Afternoon is going',
  'Evening turned out',
  'End of day and I\'m',
];

const moodAdjectives = [
  'great',
  'okay',
  'mixed',
  'rough',
  'fantastic',
  'peaceful',
  'overwhelming',
  'promising',
  'challenging',
  'balanced'
];

// Helper to generate random date within a range
function randomDate(start: Date, end: Date) {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}

// Helper to generate more varied mood entries
function generateMoodEntry() {
  // Generate a realistic mood value
  const baseValue = Math.random() * 10;
  const mood = Math.round(baseValue * 10) / 10; // Round to 1 decimal place

  // Generate a more varied note by combining phrases
  let note = '';
  const noteStyle = Math.random();
  
  if (noteStyle < 0.4) {
    // Use a pre-written note
    note = sampleNotes[Math.floor(Math.random() * sampleNotes.length)];
  } else if (noteStyle < 0.7) {
    // Combine time of day with mood
    const timePhrase = timeOfDayPhrases[Math.floor(Math.random() * timeOfDayPhrases.length)];
    const adjective = moodAdjectives[Math.floor(Math.random() * moodAdjectives.length)];
    note = `${timePhrase} ${adjective}`;
  } else {
    // Use two random notes combined
    const note1 = sampleNotes[Math.floor(Math.random() * sampleNotes.length)];
    const note2 = sampleNotes[Math.floor(Math.random() * sampleNotes.length)];
    note = `${note1}. ${note2}`;
  }

  return {
    mood,
    notes: note,
    date: randomDate(new Date(2025, 0, 1), new Date()).toISOString()
  };
}

// Helper to get random activities for an entry
function getRandomActivities(activities: Activity[], count: number) {
    // Create array of indices and shuffle those instead of the activities
    const indices = Array.from(activities.keys());
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    
    // Use shuffled indices to get random activities
    return indices
      .slice(0, Math.min(count, activities.length))
      .map(i => activities[i]);
  }

// Main seeding function
export async function seedMoodEntries(
  db: SQLiteDatabase,
  numberOfEntries: number = 11
): Promise<DatabaseResult> {
  try {
    // First, get all available activities
    const activities = await getActivities(db);

    if (!activities.length) {
      return {
        success: false,
        message: 'No activities found in database. Please ensure activities are seeded first.'
      };
    }

    await db.withTransactionAsync(async () => {
      for (let i = 0; i < numberOfEntries; i++) {
        const entry = generateMoodEntry();
        
        // Insert the mood entry
        const result = await db.runAsync(
          `INSERT INTO entries (mood, notes, date) VALUES (?, ?, ?)`,
          [entry.mood, entry.notes, entry.date]
        );

        const entryId = result.lastInsertRowId;
        
        // Add 1-4 random activities for this entry
        const activityCount = Math.floor(Math.random() * 4) + 1;
        const selectedActivities = getRandomActivities(activities, activityCount);
        
        for (const activity of selectedActivities) {
          await db.runAsync(
            `INSERT INTO entry_activities (entry_id, activity_id) VALUES (?, ?)`,
            [entryId, activity.id]
          );
        }
      }
    });

    return {
      success: true,
      message: `Successfully seeded ${numberOfEntries} mood entries`
    };
  } catch (error) {
    console.error('Error seeding mood entries:', error);
    return {
      success: false,
      message: `Error seeding mood entries: ${error}`
    };
  }
}

// Helper function to clear all entries (useful for testing)
export async function clearAllEntries(db: SQLiteDatabase): Promise<DatabaseResult> {
  try {
    await db.withTransactionAsync(async () => {
      // Delete from entry_activities first due to foreign key constraints
      await db.runAsync('DELETE FROM entry_activities');
      await db.runAsync('DELETE FROM entries');
      
      // Reset the autoincrement counters
      await db.runAsync('DELETE FROM sqlite_sequence WHERE name IN (\'entries\', \'entry_activities\')');
    });

    return {
      success: true,
      message: 'Successfully cleared all entries'
    };
  } catch (error) {
    console.error('Error clearing entries:', error);
    return {
      success: false,
      message: `Error clearing entries: ${error}`
    };
  }
}