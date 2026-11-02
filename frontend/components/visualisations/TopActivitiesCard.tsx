import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ThemeColors, useThemeColors } from '@/styles/global';
import { Card } from '@/components/Card';

export type TopActivity = {
    name: string;
    avgWith: number;
    avgWithout: number;
    delta: number;
};

type TopActivitiesCardProps = {
    /** Activities that lift mood, strongest first. Empty = not enough signal yet. */
    activities: TopActivity[];
};

/**
 * "What lifts your mood" — one sentence per top activity (the caller caps the
 * list), or a gentle "keep logging" hint when no activity lifts mood yet.
 */
const TopActivitiesCard: React.FC<TopActivitiesCardProps> = ({ activities }) => {
    const colors = useThemeColors();
    const styles = useStyles(colors);

    return (
        <Card>
            <View style={styles.headerRow}>
                <View style={[styles.iconCircle, { backgroundColor: colors.accentLight }]}>
                    <Ionicons name="sparkles-outline" size={20} color={colors.accent} />
                </View>
                <Text style={styles.title}>What lifts your mood</Text>
            </View>

            {activities.length === 0 ? (
                <Text style={styles.body}>
                    Log activities alongside your mood and we'll surface which ones tend to
                    lift you most.
                </Text>
            ) : (
                activities.map((a) => (
                    <Text key={a.name} style={styles.body}>
                        When you log <Text style={styles.emphasis}>{a.name}</Text>, your mood
                        averages <Text style={styles.emphasis}>{a.avgWith.toFixed(1)}</Text>{' '}
                        — that's{' '}
                        <Text style={[styles.emphasis, { color: colors.accent }]}>
                            +{a.delta.toFixed(1)}
                        </Text>{' '}
                        above days without it ({a.avgWithout.toFixed(1)}).
                    </Text>
                ))
            )}
        </Card>
    );
};

export default TopActivitiesCard;

const useStyles = (colors: ThemeColors) =>
    useMemo(
        () =>
            StyleSheet.create({
                headerRow: {
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    marginBottom: 12,
                },
                iconCircle: {
                    width: 44,
                    height: 44,
                    borderRadius: 22,
                    justifyContent: 'center',
                    alignItems: 'center',
                },
                title: {
                    fontSize: 16,
                    fontWeight: '700',
                    color: colors.text,
                    flex: 1,
                },
                body: {
                    fontSize: 15,
                    lineHeight: 22,
                    color: colors.textSecondary,
                    marginBottom: 8,
                },
                emphasis: {
                    color: colors.text,
                    fontWeight: '700',
                },
            }),
        [colors]
    );
