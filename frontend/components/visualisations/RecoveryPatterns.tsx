import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { Card } from '@/components/Card';
import { useThemeColors } from '@/styles/global';
import { useDataContext } from '@/context/DataContext';
import _ from 'lodash';
import InfoBubble from '../InfoBubble';

// Define what constitutes a "recovery episode"
const RECOVERY_THRESHOLD = 6.0; // Mood above this is considered "recovered"
const DIP_THRESHOLD = 4.0; // Mood below this triggers a recovery episode
const MIN_RECOVERY_DAYS = 2; // Minimum days of good mood to count as recovered

type Activity = {
  id: number;
  name: string;
  count: number;
  avgImprovement: number;
};

type RecoveryEpisode = {
  startDate: string;
  endDate: string | null;
  startMood: number;
  currentMood: number;
  activities: Activity[];
  durationDays: number;
  recovered: boolean;
};
const RecoveryAnalysis = () => {
    const colors = useThemeColors();
    const db = useSQLiteContext();
    const { refreshCount } = useDataContext();
    const [currentEpisode, setCurrentEpisode] = useState<RecoveryEpisode | null>(null);
    const [historicalEpisodes, setHistoricalEpisodes] = useState<RecoveryEpisode[]>([]);
    const [successRate, setSuccessRate] = useState<number>(0);
    const [avgDuration, setAvgDuration] = useState<number>(0);
  
    const styles = useMemo(() => StyleSheet.create({
      title: {
        fontSize: 20,
        fontWeight: 'bold',
        color: colors.text,
        marginBottom: 16,
      },
      subtitle: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.text,
        marginBottom: 8,
      },
      currentEpisode: {
        padding: 12,
        backgroundColor: colors.overlays.tag,
        borderRadius: 8,
        marginBottom: 16,
      },
      stats: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        marginVertical: 16,
      },
      statItem: {
        alignItems: 'center',
      },
      statLabel: {
        fontSize: 14,
        color: colors.textSecondary,
        marginBottom: 4,
      },
      statValue: {
        fontSize: 24,
        fontWeight: 'bold',
        color: colors.accent,
      },
      statDetail: {
        fontSize: 12,
        color: colors.textSecondary,
      },
      history: {
        marginTop: 16,
      },
      episodeItem: {
        padding: 12,
        backgroundColor: colors.overlays.tag,
        borderRadius: 8,
        marginBottom: 8,
      },
      text: {
        color: colors.text,
        fontSize: 14,
        marginBottom: 4,
      },
    }), [colors]);

  useEffect(() => {
    const analyzeRecoveryPatterns = async () => {
      try {
        // Get mood entries with activities for the last 30 days
        const entries = await db.getAllAsync<{
          date: string;
          mood: number;
          activity_names: string;
        }>(`
          WITH MoodActivities AS (
            SELECT 
              e.date,
              e.mood,
              GROUP_CONCAT(a.name) as activity_names
            FROM entries e
            LEFT JOIN entry_activities ea ON e.id = ea.entry_id
            LEFT JOIN activities a ON ea.activity_id = a.id
            WHERE e.date >= date('now', '-30 days')
            GROUP BY e.date
            ORDER BY e.date DESC
          )
          SELECT * FROM MoodActivities
        `);

        // Process entries to find recovery episodes
        let episodes: RecoveryEpisode[] = [];
        let currentEp: RecoveryEpisode | null = null;
        
        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i];
          const mood = entry.mood;
          
          if (!currentEp && mood <= DIP_THRESHOLD) {
            // Start new episode
            currentEp = {
              startDate: entry.date,
              endDate: null,
              startMood: mood,
              currentMood: mood,
              activities: [],
              durationDays: 0,
              recovered: false
            };
          } else if (currentEp) {
            currentEp.durationDays++;
            currentEp.currentMood = mood;
            
            // Check if recovered
            if (mood >= RECOVERY_THRESHOLD) {
              let sustainedRecovery = true;
              // Check next MIN_RECOVERY_DAYS days maintain good mood
              for (let j = 1; j < MIN_RECOVERY_DAYS && i + j < entries.length; j++) {
                if (entries[i + j].mood < RECOVERY_THRESHOLD) {
                  sustainedRecovery = false;
                  break;
                }
              }
              
              if (sustainedRecovery) {
                currentEp.recovered = true;
                currentEp.endDate = entry.date;
                episodes.push(currentEp);
                currentEp = null;
              }
            }
          }
        }

        // Calculate statistics
        const completedEpisodes = episodes.filter(ep => ep.endDate);
        const recoveredEpisodes = completedEpisodes.filter(ep => ep.recovered);
        
        setSuccessRate(
          completedEpisodes.length > 0 
            ? (recoveredEpisodes.length / completedEpisodes.length) * 100 
            : 0
        );
        
        setAvgDuration(
          completedEpisodes.length > 0
            ? _.meanBy(completedEpisodes, 'durationDays')
            : 0
        );

        setHistoricalEpisodes(episodes.filter(ep => ep.endDate));
        setCurrentEpisode(currentEp);
        
      } catch (error) {
        console.error('Error analyzing recovery patterns:', error);
      }
    };

    analyzeRecoveryPatterns();
  }, [db, refreshCount]);

  return (
    <Card>
      <InfoBubble 
          text="Recovery analysis tracks how you bounce back from low moods. It shows your recovery patterns, duration, and success rate. A recovery is completed once two days exceed an average mood of 6 (after having delved below 4)."
          position="top-right"
      />
      <Text style={styles.title}>Recovery Analysis</Text>
      
      {currentEpisode && (
        <View style={styles.currentEpisode}>
          <Text style={styles.subtitle}>Current Recovery Episode</Text>
          <Text style={styles.text}>
            Started: {new Date(currentEpisode.startDate).toLocaleDateString()}
          </Text>
          <Text style={styles.text}>
            Duration: {currentEpisode.durationDays} days
          </Text>
          <Text style={styles.text}>
            Progress: {currentEpisode.startMood.toFixed(1)} → {currentEpisode.currentMood.toFixed(1)}
          </Text>
        </View>
      )}

      <View style={styles.stats}>
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>Success Rate</Text>
          <Text style={styles.statValue}>{successRate.toFixed(0)}%</Text>
          <Text style={styles.statDetail}>full recovery</Text>
        </View>

        <View style={styles.statItem}>
          <Text style={styles.statLabel}>Average Duration</Text>
          <Text style={styles.statValue}>{avgDuration.toFixed(1)}</Text>
          <Text style={styles.statDetail}>days to recover</Text>
        </View>
      </View>

      {historicalEpisodes.length > 0 && (
        <View style={styles.history}>
          <Text style={styles.subtitle}>Recent Episodes</Text>
          {historicalEpisodes.slice(0, 3).map((episode, index) => (
            <View key={index} style={styles.episodeItem}>
              <Text style={styles.text}>
                {new Date(episode.startDate).toLocaleDateString()} - 
                {episode.endDate ? new Date(episode.endDate).toLocaleDateString() : 'Ongoing'}
              </Text>
              <Text style={styles.text}>
                Duration: {episode.durationDays} days
              </Text>
            </View>
          ))}
        </View>
      )}
    </Card>
  );
};

export default RecoveryAnalysis;