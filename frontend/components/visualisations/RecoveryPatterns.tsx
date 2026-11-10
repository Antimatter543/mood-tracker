import { useCallback, useState, useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { Card } from '@/components/Card';
import { ThemeColors, useThemeColors } from '@/styles/global';
import { useDataRefresh } from '@/hooks/useDataRefresh';
import { useDateFormat } from '@/hooks/useDateFormat';
import InfoBubble from '../InfoBubble';
import {
    analyseRecoveryPatterns,
    type MoodActivityRow,
    type RecoveryEpisode,
} from './transforms/recoveryPatterns';
import {
    startOfLocalDay,
    addDays,
    localDateString,
    localDateTimeString,
} from './transforms/dateHelpers';
import { now } from '@/lib/clock';
import { Activity } from '../types';
import { OverlayModal } from '../OverlayModal';
import RecoveryEpisodeDetails from '../RecoveryEpisodeDetails';
import { Feather } from '@expo/vector-icons';
import { IconFamilyType } from '../iconRegistry';

type RawMoodEntry = {
    id: number;
    date: string;
    mood: number;
    aId: number;
    aName: string;
    aGroup: number;
    aIconFamily: IconFamilyType;
    aIconName: string;
    aPosition: number;
 };

const RecoveryAnalysis = () => {
    const colors = useThemeColors();
    const { format: formatDate } = useDateFormat();
    const db = useSQLiteContext();
    const [currentEpisode, setCurrentEpisode] = useState<RecoveryEpisode | null>(null);
    const [historicalEpisodes, setHistoricalEpisodes] = useState<RecoveryEpisode[]>([]);
    const [successRate, setSuccessRate] = useState<number>(0);
    const [avgDuration, setAvgDuration] = useState<number>(0);
    const [selected, setSelected] = useState<RecoveryEpisode | null>(null);  
    const styles = useThemedStyles(colors);
    
    const run = useCallback(async () => {
        try {
            // Last 90 days of entries with activity names. The lower bound is now a
            // parameterised LOCAL-time UTC ISO string (start of 90 days ago in the
            // user's timezone) rather than SQLite's UTC date('now', '-90 days'),
            // which silently dropped late-evening entries for users east of UTC.
            const start = startOfLocalDay(
                addDays(localDateString(now()), -90)
            );

            const rawEntries = await db.getAllAsync<RawMoodEntry>(`
                WITH MoodActivities AS (
                  SELECT
                    e.id AS id,
                    e.date AS date,
                    e.mood AS mood,
                    a.id AS aId,
                    a.name AS aName,
                    a.group_id AS aGroup,
                    a.icon_family AS aIconFamily,
                    a.icon_name AS aIconName,
                    a.position AS aPosition
                  FROM entries e
                  LEFT JOIN entry_activities ea ON e.id = ea.entry_id
                  LEFT JOIN activities a ON ea.activity_id = a.id
                  WHERE e.deleted_at IS NULL AND e.date >= ?
                  ORDER BY e.date, e.id ASC
                )
                SELECT * FROM MoodActivities
            `, [start]);

            // Process the raw entry + activities rows
            let lastEntry: MoodActivityRow | null  = null;
            let entries: MoodActivityRow[] = [];
            let activityMap = new Map<number, Activity>();
            for (const raw of rawEntries) {
                // Get the activity object or create and cache a new one
                let activity: Activity | undefined = undefined
                if (raw.aId) {
                    activity = activityMap.get(raw.aId);
                    if (!activity) {
                        activity = {
                            id: raw.aId,
                            name: raw.aName,
                            group_id: raw.aGroup,
                            icon_family: raw.aIconFamily,
                            icon_name: raw.aIconName,
                            position: raw.aPosition,
                        };
                        activityMap.set(raw.aId, activity);
                    }
                }

                // Entries & activities are ordered by date and then
                // by the entry id: when id changes, create new entry.
                if (!lastEntry || lastEntry.id != raw.id) {
                    lastEntry = {
                        id: raw.id,
                        date: localDateTimeString(raw.date),
                        mood: raw.mood,
                        activities: [],
                    };
                    entries.push(lastEntry);
                }

                if (activity)
                    lastEntry.activities.push(activity);
            }

            const result = analyseRecoveryPatterns(entries);
            setSuccessRate(result.successRate);
            setAvgDuration(result.avgDuration);
            setHistoricalEpisodes(result.historicalEpisodes);
            setCurrentEpisode(result.currentEpisode);
        } catch (error) {
            console.error('Error analyzing recovery patterns:', error);
        }
      // eslint-disable-next-line react-hooks/exhaustive-deps -- query reads only db; setState identities are stable
      }, [db]);
    useDataRefresh(run, [db]);

    const episodeEntry = (episode: RecoveryEpisode, key: string) => (
        <Pressable
            key={key}
            style={({ pressed }) => [
                styles.episodeItem,
                pressed && styles.episodePressed,
                key != 'current' && styles.bottomBorder
            ]}
            onPress={() => setSelected(episode)}
            accessibilityRole="button"
            accessibilityLabel={`Open episode details`}
        >          
            <View style={styles.episodeIcon}>
                <Feather name='calendar' size={18} color={colors.textSecondary}/>
                <Text style={styles.secondaryText}>{episode.durationDays} days</Text>
            </View>
            <View style={styles.grow}>
                <Text style={styles.text}>
                    {formatDate(episode.startDate, 'numericShort')} – {episode.endDate ? formatDate(episode.endDate, 'numericShort') : 'ongoing'}
                </Text>
                {episode.dips > 1 && (
                    <Text style={styles.text}>{episode.dips} dips{episode.endDate && (episode.recovered ? ', recovered' : ', not recovered')}</Text>
                )}
                {episode.dips == 1 && (
                    <Text style={styles.text}>{episode.dips} dip{episode.endDate && (episode.recovered ? ', recovered' : ', not recovered')}</Text>
                )}
                {episode.dips == 0 && episode.endDate && (
                    <Text style={styles.text}>{episode.recovered ? 'Recovered' : 'Not recovered'}</Text>
                )}
                <Text style={styles.text}>
                    Mood {episode.worstMood.toFixed(1)} – {episode.currentMood.toFixed(1)} (worst – latest)
                </Text>
            </View>
            <Feather
                name="chevron-right"
                size={18}
                color={colors.textSecondary}
            />
        </Pressable>
    );
    
    if (!currentEpisode && historicalEpisodes.length == 0)
        return (
            <Card>
                <InfoBubble 
                    text="Recovery analysis tracks how you bounce back from low moods. It shows your recovery patterns, duration, and success rate. A recovery is completed once two days exceed an average mood of 6 (after having delved below 4). Episode is marked as non-recovered, if the mood is at least 5 for four days."
                    position="top-right"
                />
                <Text style={styles.title}>Recovery analysis</Text>
                <View style={styles.emptyState}>
                    <Text style={styles.emptyText}>
                        No recovery episodes recognized. Keep on logging moods!
                    </Text>
                </View>
            </Card>
        )

    return (
        <Card>
            <InfoBubble 
                text="Recovery analysis tracks how you bounce back from low moods. It shows your recovery patterns, duration, and success rate. A recovery is completed once two days exceed an average mood of 6 (after having delved below 4). Episode is marked as non-recovered, if the mood is at least 5 for four days."
                position="top-right"
            />
            <Text style={styles.title}>Recovery analysis</Text>
            
            {currentEpisode != null && (<Text style={styles.subtitle}>Current episode</Text>)}
            {currentEpisode != null && episodeEntry(currentEpisode!, 'current')}

            <View style={styles.stats}>
                <View style={styles.statItem}>
                    <Text style={styles.statLabel}>Success rate</Text>
                    <Text style={styles.statValue}>{successRate.toFixed(0)}%</Text>
                    <Text style={styles.statDetail}>full recovery</Text>
                </View>

                <View style={styles.statItem}>
                    <Text style={styles.statLabel}>Average duration</Text>
                    <Text style={styles.statValue}>{avgDuration.toFixed(1)}</Text>
                    <Text style={styles.statDetail}>days to recover</Text>
                </View>
            </View>

            {historicalEpisodes.length > 0 && (
                <View>
                    <Text style={styles.subtitle}>Recent episodes</Text>
                    <View style={styles.history}>
                        {historicalEpisodes.slice(0, 5).map((episode, index) => (
                            episodeEntry(episode, `episode-${index}`)
                        ))}
                    </View>
                </View>
            )}

            {selected && (
                <OverlayModal
                    visible={selected !== null}
                    onClose={() => setSelected(null)}
                    fullScreen
                >
                    {selected && (
                        <RecoveryEpisodeDetails
                            episode={selected}
                            onClose={() => setSelected(null)}
                        />
                    )}
                </OverlayModal>            
            )}
        </Card>
    );
};

export default RecoveryAnalysis;



// Themed styles hook
const useThemedStyles = (colors: ThemeColors) => {
    return useMemo(() => StyleSheet.create({
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
        stats: {
            flexDirection: 'row',
            justifyContent: 'space-around',
            marginTop: 16,
            marginBottom: 32,
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
            marginBottom: 16,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: colors.overlays.border,
        },
        bottomBorder: {
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: colors.overlays.border,
        },
        episodeItem: {
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: 12,
            paddingVertical: 10,
        },
        episodePressed: {
        opacity: 0.6,
        },
        episodeIcon: {
            width: 70,
            height: 50,
            color: colors.textSecondary,
            borderRadius: 25,
            backgroundColor: colors.accentLight,
            alignItems: 'center',
            justifyContent: 'center',
        },
        grow: { flex: 1 },
        text: {
            color: colors.text,
            fontSize: 14,
            marginBottom: 4,
        },
        secondaryText: {
            color: colors.textSecondary,
            fontSize: 14,
            marginBottom: 4,
        },
        emptyState: {
            alignItems: 'center',
            gap: 10,
            paddingVertical: 20,
        },
        emptyText: {
            fontSize: 14,
            color: colors.textSecondary,
            textAlign: 'center',
            lineHeight: 20,
        },
    }), [colors]);
};
