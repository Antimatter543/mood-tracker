import React, { memo, useMemo, useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    Pressable,
} from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { Svg, Polyline, Line } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemeColors, useThemeColors } from '@/styles/global';
import { useDateFormat } from '@/hooks/useDateFormat';
import { Card } from '@/components/Card';
import { ActivityIcon } from '@/components/activityIcon';
import { Activity } from '@/components/types';
import { sparklineDatePoints } from '@/components/visualisations/transforms/activityDetail';
import { RecoveryEpisode } from './visualisations/transforms/recoveryPatterns';
import { OverlayModal } from './OverlayModal';
import ActivityInsightsDetail from './ActivityInsightsDetail';
import StatTile from './StatTile';


const SPARK_HEIGHT = 100;

/**
 * Full-screen details for ONE recent episode.
 */
export const RecoveryEpisodeDetails: React.FC<{
    episode: RecoveryEpisode;
    onClose: () => void;
}> = ({ episode, onClose }) => {
    const colors = useThemeColors();
    const styles = useThemedStyles(colors);
    const insets = useSafeAreaInsets();
    const { format: formatDate } = useDateFormat();

    const header = (
        <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
            <View style={[styles.topIcon, { backgroundColor: colors.accentLight }]}>
                <Feather name="search" size={22} color={colors.accent}/>
            </View>
            <Text> </Text>
            <Text style={styles.topTitle}>
                Episode {formatDate(episode.startDate, 'numericShort')} – {episode.endDate ? formatDate(episode.endDate, 'numericShort') : 'ongoing'}
            </Text>
            <Pressable
                onPress={onClose}
                hitSlop={16}
                style={styles.closeBtn}
                accessibilityRole="button"
                accessibilityLabel="Close recovery episode details"
            >
                <Feather name="x" size={24} color={colors.text} />
            </Pressable>
        </View>
    );

    const avgMood = episode.entries.reduce((sum, e) => sum + e.mood, 0.0) / episode.entries.length
    const minMood = episode.entries.reduce((min, e) => Math.min(min, e.mood), avgMood)
    const maxMood = episode.entries.reduce((max, e) => Math.max(max, e.mood), minMood)

    return (
        <View style={styles.screen}>
            {header}
            <ScrollView
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
            >
                {/* (d) Variability callout — the centerpiece, placed prominently up top */}
                <Card accentTop>
                    <Text style={styles.cardTitle}>Overview</Text>
                    <View style={styles.tileGrid}>
                        <View key="duration" style={styles.tileCell}>
                            <StatTile icon='clock'
                                value={`${episode.durationDays} ${episode.durationDays == 1 ? 'day' : 'days'}`}
                                label='Duration'/>
                        </View>
    
                        {episode.dips > 0 && (
                            <View key="dips" style={styles.tileCell}>
                                <StatTile icon='chevrons-down' value={episode.dips}
                                    label='Mood dips'/>
                            </View>
                        )}
    
                        <View key="avg" style={styles.tileCell}>
                            <StatTile icon='activity'
                                value={avgMood.toFixed(1)}
                                label='Avg mood'/>
                        </View>

                        <View key="max" style={styles.tileCell}>
                            <StatTile icon='arrow-up'
                                value={maxMood.toFixed(1)}
                                label='Max mood'/>
                        </View>

                        <View key="min" style={styles.tileCell}>
                            <StatTile icon='arrow-down'
                                value={minMood.toFixed(1)}
                                label='Min mood'/>
                        </View>

                        <View key="entries" style={styles.tileCell}>
                            <StatTile icon='edit-3'
                                value={episode.entries.length}
                                label='Entries'/>
                        </View>
                    </View>
                </Card>

                {episode.worseningActivities.size == 0 && episode.recoveringActivities.size == 0 ? (
                    <Card>
                        <Text style={styles.cardTitle}>Activity correlation</Text>
                        <View style={styles.activitiesContainer}>
                            <Text>Not enough activities logged</Text>
                        </View>
                    </Card>
                ) : null}
                <ActivitiesCard title="Worsening activities" activities={episode.worseningActivities}/>
                <ActivitiesCard title="Recovering activities" activities={episode.recoveringActivities}/>

                <Card>
                    <Text style={styles.cardTitle}>Mood trend</Text>
                    <Sparkline values={episode.entries}
                        color={colors.accent} styles={styles}/>
                </Card>
            </ScrollView>
        </View>
    );
};

/** Width-measured SVG sparkline. Path math lives in the pure `sparklineDatePoints`. */
const Sparkline: React.FC<{ values: {date: string, mood: number}[]; color: string; styles: Styles }> = ({
    values,
    color,
    styles,
}) => {
    const [width, setWidth] = useState(0);
    const points = sparklineDatePoints(values, width, SPARK_HEIGHT);
    const grid =[0, 2, 4, 6, 8, 10].map((value) =>(
        {y: Math.round((SPARK_HEIGHT - value * SPARK_HEIGHT / 10) * 10) / 10,
            label: value.toString()}));

    const pointsStr = points.map((p) => `${p.x},${p.y}`).join(' ');
    return (
        <View
            testID="episode-trend-sparkline"
            style={styles.sparkWrap}
            onLayout={(e) => {
                const w = e.nativeEvent.layout.width;
                if (w > 0 && Math.abs(w - width) > 1) setWidth(w);
            }}
        >
            {width > 0 && points.length > 1 && (
                <Svg width={width} height={SPARK_HEIGHT}>
                    {grid.map((g) => (
                        <React.Fragment key={`grid-${g.label}`}>
                            <Line
                                accessibilityLabel={g.label}
                                x1={0}
                                y1={g.y}
                                x2={width}
                                y2={g.y}
                                stroke={Number.parseInt(g.label) <= 4 ? "red" : "lightgray"}
                                strokeOpacity={0.8}
                                strokeWidth={1.3}
                            />
                        </React.Fragment>
                    ))}                    
                    <Polyline
                        points={pointsStr}
                        fill="none"
                        stroke={color}
                        strokeWidth={2}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                    />
                </Svg>
            )}
        </View>
    );
};


const ActivitiesCard = memo(function ActivitiesCard({ title, activities }: { title: string, activities: Set<Activity> }) {
    const colors = useThemeColors();
    const styles = useThemedStyles(colors);
    const [selected, setSelected] = useState<Activity | null>(null);

    if (activities.size === 0) return null;

    return (
        <Card>
            <Text style={styles.cardTitle}>{title}</Text>
            <View style={styles.activitiesContainer}>
                {[...activities].sort((a, b) => a.name.localeCompare(b.name)).map((activity, index) => (
                    <Pressable
                        key={`${activity.name}-${index}`}
                        onPress={() => setSelected({...activity, group_id: 0, position: 0})}
                        accessibilityRole="button"
                        accessibilityLabel={`Open ${activity.name} insights`}
                    >
                        <View style={styles.activityUnit}>
                            <View style={styles.activityChip}>
                                <ActivityIcon
                                    iconName={activity.icon_name}
                                    iconFamily={activity.icon_family}
                                    color={colors.accent}
                                    size={15}
                                />
                            </View>
                            <Text style={styles.activityText} numberOfLines={1}>
                                {activity.name}
                            </Text>
                        </View>
                   </Pressable>
                ))}
            </View>

            <OverlayModal
                visible={selected !== null}
                onClose={() => setSelected(null)}
                fullScreen
            >
                {selected && (
                    <ActivityInsightsDetail
                        activity={selected}
                        onClose={() => setSelected(null)}
                    />
                )}
            </OverlayModal>            
        </Card>
    );
});


type Styles = ReturnType<typeof useThemedStyles>;

const useThemedStyles = (colors: ThemeColors) => useMemo(() =>
    StyleSheet.create({
        screen: {
            flex: 1,
            backgroundColor: colors.background,
        },
        topBar: {
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 16,
            paddingBottom: 12,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: colors.border,
            backgroundColor: colors.background,
        },
        topTitle: {
            flex: 1,
            fontSize: 20,
            fontWeight: '800',
            color: colors.text,
            letterSpacing: -0.4,
        },
        topIcon: {
            width: 32,
            height: 32,
            borderRadius: 16,
            alignItems: 'center',
            justifyContent: 'center',
        },
        closeBtn: {
            padding: 4,
            marginLeft: 8,
        },
        scrollContent: {
            padding: 16,
            paddingBottom: 40,
        },
        cardTitle: {
            fontSize: 17,
            fontWeight: '700',
            color: colors.text,
            marginBottom: 6,
        },
        tileGrid: {
            flexDirection: 'row',
            flexWrap: 'wrap',
        },
        tileCell: {
            width: '50%',
            paddingVertical: 12,
            paddingHorizontal: 4,
        },        
        sparkWrap: {
            height: SPARK_HEIGHT,
            marginTop: 14,
            alignSelf: 'stretch',
        },
        activitiesContainer: {
            flexDirection: 'row',
            flexWrap: 'wrap',
            rowGap: 14,
            columnGap: 16,
        },
        activityUnit: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
        },
        activityChip: {
            width: 30,
            height: 30,
            borderRadius: 15,
            backgroundColor: colors.accentLight,
            alignItems: 'center',
            justifyContent: 'center',
        },
        activityText: {
            color: colors.text,
            fontSize: 14,
            fontWeight: '500',
        },        
    }), [colors]);

export default RecoveryEpisodeDetails;
