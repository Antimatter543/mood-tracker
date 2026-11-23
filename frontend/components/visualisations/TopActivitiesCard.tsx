import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ThemeColors, useThemeColors } from '@/styles/global';
import { Card } from '@/components/Card';
import { OverlayModal } from '../OverlayModal';
import ActivityInsightsDetail from '../ActivityInsightsDetail';
import { Activity } from '../types';
import { getActivity } from '@/databases/activities';
import { useSQLiteContext } from 'expo-sqlite';
import { ActivityCorrelationResult } from './transforms/activityCorrelation';
import { Feather } from '@expo/vector-icons';

type TopActivitiesCardProps = {
    /** Activities that lift mood, strongest first. Empty = not enough signal yet. */
    activities: ActivityCorrelationResult[];
};

/**
 * "What lifts your mood" — one sentence per top activity (the caller caps the
 * list), or a gentle "keep logging" hint when no activity lifts mood yet.
 */
const TopActivitiesCard: React.FC<TopActivitiesCardProps> = ({ activities }) => {
    const colors = useThemeColors();
    const styles = useStyles(colors);
    const db = useSQLiteContext();
    const [selected, setSelected] = useState<Activity | null>(null);

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
                    Log activities alongside your mood or change the time period, and
                    the ones that tend to lift your mood most will surface.
                </Text>
            ) : (
                activities.map((a, index) => (
                    <Pressable
                        key={index}
                        style={({ pressed }) => [
                            index > 0 && styles.divider,
                            pressed && styles.pressed,
                            styles.rowContainer,
                        ]}
                        onPress={async () => {
                            const activity = await getActivity(db, a.activity_id);
                            setSelected(activity);
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={`Show activity details for ${a.activity_name}.`}
                    >
                        <View style={styles.row}>
                            <Text key={a.activity_name} style={styles.body}>
                                When you log <Text style={styles.emphasis}>{a.activity_name}</Text>, your mood
                                averages <Text style={styles.emphasis}>{a.avg_with.toFixed(1)}</Text>{' '}
                                — that's{' '}
                                <Text style={[styles.emphasis, { color: colors.accent }]}>
                                    +{a.delta.toFixed(1)}
                                </Text>{' '}
                                above days without it ({a.avg_without.toFixed(1)}).
                            </Text>
                        </View>
                            <Feather
                                style={styles.arrow}
                                name="chevron-right"
                                size={18}
                                color={colors.textSecondary}
                            />
                    </Pressable>
                ))
            )}
            <OverlayModal visible={selected !== null} onClose={() => setSelected(null)} fullScreen>
                {selected && (
                    <ActivityInsightsDetail activity={selected} onClose={() => setSelected(null)} />
                )}
            </OverlayModal>
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
                    flex: 1,
                    fontSize: 15,
                    lineHeight: 22,
                    color: colors.textSecondary,
                    marginBottom: 8,
                },
                emphasis: {
                    color: colors.text,
                    fontWeight: '700',
                },
                arrow: {
                    flex: 0,
                },
                row: {
                    flex: 1,
                    flexDirection: 'row',
                    alignItems: 'flex-start',
                    gap: 12,
                    minHeight: 48,
                    paddingVertical: 10,
                },
                rowContainer: {
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                },
                divider: {
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderTopColor: colors.overlays.border,
                },
                pressed: { opacity: 0.6 },
        }),
        [colors]
    );
