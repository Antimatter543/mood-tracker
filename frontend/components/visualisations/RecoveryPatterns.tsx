import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { Card } from '@/components/Card';
import { useThemeColors } from '@/styles/global';
import { useDataContext } from '@/context/DataContext';
import InfoBubble from '../InfoBubble';
import {
  analyseRecoveryPatterns,
  type MoodActivityRow,
  type RecoveryEpisode,
} from './transforms/recoveryPatterns';

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
    const run = async () => {
      try {
        // Last 30 days of entries with activity names. Note: the date filter
        // here is still UTC-anchored; the windowing issue is being tackled
        // chart-by-chart and this surface will move to parameterised dates
        // in a follow-up. For now the analysis works on whatever the DB
        // returns; the transform is window-agnostic.
        const entries = await db.getAllAsync<MoodActivityRow>(`
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

        const result = analyseRecoveryPatterns(entries);
        setSuccessRate(result.successRate);
        setAvgDuration(result.avgDuration);
        setHistoricalEpisodes(result.historicalEpisodes);
        setCurrentEpisode(result.currentEpisode);
      } catch (error) {
        console.error('Error analyzing recovery patterns:', error);
      }
    };

    run();
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