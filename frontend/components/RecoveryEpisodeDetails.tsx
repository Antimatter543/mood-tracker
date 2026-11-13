import React, { memo, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { Svg, G, Polyline, Line, Circle, Rect, Text as SvgText } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemeColors, useThemeColors } from '@/styles/global';
import { useDateFormat } from '@/hooks/useDateFormat';
import { Card } from '@/components/Card';
import { ActivityIcon } from '@/components/activityIcon';
import { Activity } from '@/components/types';
import { localDateString } from '@/databases/dateHelpers';
import { now } from '@/lib/clock';
import {
    DIP_THRESHOLD,
    RECOVERY_THRESHOLD,
    sparklineDatePoints,
    type RecoveryEpisode,
} from './visualisations/transforms/recoveryPatterns';
import {
    daysLabel,
    daysSoFar,
    dipsLabel,
    formatMood,
    statusLabel,
} from './visualisations/transforms/lowStretchCopy';
import { OverlayModal } from './OverlayModal';
import ActivityInsightsDetail from './ActivityInsightsDetail';
import StatTile from './StatTile';

const SPARK_HEIGHT = 120;
/** The mood scale the chart is drawn on (as in sparklineDatePoints). */
const MOOD_MAX = 10;
/** Room for the 4 / 6 labels on the left and for the end dots. */
const CHART_INSET = { left: 16, right: 6, top: 6, bottom: 6 };

/** Full-screen details for ONE low stretch. */
export const RecoveryEpisodeDetails: React.FC<{
    episode: RecoveryEpisode;
    onClose: () => void;
}> = ({ episode, onClose }) => {
    const colors = useThemeColors();
    const styles = useThemedStyles(colors);
    const insets = useSafeAreaInsets();
    const { format: formatDate } = useDateFormat();

    const start = formatDate(episode.startDate, 'mediumNoYear');
    const end = episode.endDate ? formatDate(episode.endDate, 'mediumNoYear') : 'now';
    const status = episode.endDate
        ? statusLabel(episode)
        : `${daysLabel(daysSoFar(episode.startDate, localDateString(now())))} so far`;

    const moods = episode.entries.map((e) => e.mood);
    const avgMood = moods.length > 0 ? moods.reduce((s, m) => s + m, 0) / moods.length : 0;
    const hasActivities =
        episode.worseningActivities.size > 0 || episode.recoveringActivities.size > 0;

    return (
        <View style={styles.screen}>
            <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
                <View style={styles.grow}>
                    <Text style={styles.topTitle} numberOfLines={2} testID="low-stretch-detail-title">
                        Low stretch, {start} – {end}
                    </Text>
                    <Text style={styles.topSub} numberOfLines={1} testID="low-stretch-detail-status">{status}</Text>
                </View>
                <Pressable
                    onPress={onClose}
                    hitSlop={8}
                    style={styles.closeBtn}
                    accessibilityRole="button"
                    accessibilityLabel="Close low stretch details"
                >
                    <Feather name="x" size={24} color={colors.text} />
                </Pressable>
            </View>
            <ScrollView
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
            >
                <Card accentTop>
                    <Text style={styles.cardTitle}>Overview</Text>
                    <View style={styles.tileGrid}>
                        <View style={styles.tileCell}>
                            <StatTile icon="clock" value={daysLabel(episode.durationDays)} label="Logged over" />
                        </View>
                        <View style={styles.tileCell}>
                            <StatTile icon="edit-3" value={String(episode.entries.length)} label="Entries" />
                        </View>
                        <View style={styles.tileCell}>
                            <StatTile icon="arrow-down" value={formatMood(episode.worstMood)} label="Lowest mood" />
                        </View>
                        <View style={styles.tileCell}>
                            <StatTile icon="activity" value={avgMood.toFixed(1)} label="Average mood" />
                        </View>
                        {episode.dips > 0 && (
                            <View style={styles.tileCell}>
                                <StatTile icon="chevrons-down" value={dipsLabel(episode.dips)} label="Again at 4 or lower" />
                            </View>
                        )}
                    </View>
                </Card>

                <Card>
                    <Text style={styles.cardTitle}>Mood</Text>
                    <MoodChart values={episode.entries} colors={colors} styles={styles} />
                </Card>

                {hasActivities ? (
                    <>
                        <ActivitiesCard
                            title="Logged as your mood lifted"
                            activities={episode.recoveringActivities}
                        />
                        <ActivitiesCard
                            title="Logged as your mood dropped"
                            activities={episode.worseningActivities}
                        />
                    </>
                ) : (
                    <Card>
                        <Text style={styles.cardTitle}>Activities</Text>
                        <Text style={styles.cardBody}>Not enough entries yet</Text>
                    </Card>
                )}
            </ScrollView>
        </View>
    );
};

/**
 * Width-measured mood line on the 0-10 scale, with the 4 (low) band shaded and
 * the 6 line marked. Path math lives in the pure `sparklineDatePoints`; the
 * plot sits inside a small inset so end dots and the axis labels are not cut.
 */
const MoodChart: React.FC<{
    values: { date: string; mood: number }[];
    colors: ThemeColors;
    styles: Styles;
}> = ({ values, colors, styles }) => {
    const [width, setWidth] = useState(0);
    const plotW = Math.max(0, width - CHART_INSET.left - CHART_INSET.right);
    const plotH = SPARK_HEIGHT - CHART_INSET.top - CHART_INSET.bottom;
    const points = sparklineDatePoints(values, plotW, plotH);
    const yFor = (mood: number) => CHART_INSET.top + plotH - (mood / MOOD_MAX) * plotH;
    const lowY = yFor(DIP_THRESHOLD);
    const upY = yFor(RECOVERY_THRESHOLD);
    const plotRight = CHART_INSET.left + plotW;

    return (
        <View
            testID="low-stretch-chart"
            style={styles.chartWrap}
            onLayout={(e) => {
                const w = e.nativeEvent.layout.width;
                if (w > 0 && Math.abs(w - width) > 1) setWidth(w);
            }}
        >
            {plotW > 0 && points.length > 0 && (
                <Svg width={width} height={SPARK_HEIGHT}>
                    <Rect
                        x={CHART_INSET.left}
                        y={lowY}
                        width={plotW}
                        height={CHART_INSET.top + plotH - lowY}
                        fill={colors.accentLight}
                    />
                    <Line
                        x1={CHART_INSET.left}
                        y1={upY}
                        x2={plotRight}
                        y2={upY}
                        stroke={colors.textSecondary}
                        strokeOpacity={0.5}
                        strokeWidth={1}
                        strokeDasharray="4 4"
                    />
                    <SvgText x={0} y={upY + 4} fill={colors.textSecondary} fontSize={11}>
                        6
                    </SvgText>
                    <SvgText x={0} y={lowY + 4} fill={colors.textSecondary} fontSize={11}>
                        4
                    </SvgText>
                    <G transform={`translate(${CHART_INSET.left} ${CHART_INSET.top})`}>
                        {points.length > 1 && (
                            <Polyline
                                points={points.map((p) => `${p.x},${p.y}`).join(' ')}
                                fill="none"
                                stroke={colors.accent}
                                strokeWidth={2.5}
                                strokeLinejoin="round"
                                strokeLinecap="round"
                            />
                        )}
                        {points.map((p, i) => (
                            <Circle key={`pt-${i}`} cx={p.x} cy={p.y} r={3} fill={colors.accent} />
                        ))}
                    </G>
                </Svg>
            )}
        </View>
    );
};

const ActivitiesCard = memo(function ActivitiesCard({
    title,
    activities,
}: {
    title: string;
    activities: Set<Activity>;
}) {
    const colors = useThemeColors();
    const styles = useThemedStyles(colors);
    const [selected, setSelected] = useState<Activity | null>(null);

    if (activities.size === 0) return null;

    return (
        <Card>
            <Text style={styles.cardTitle}>{title}</Text>
            <View style={styles.activitiesContainer}>
                {[...activities]
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((activity) => (
                        <Pressable
                            key={`activity-${activity.id}`}
                            style={styles.activityUnit}
                            onPress={() => setSelected(activity)}
                            accessibilityRole="button"
                            accessibilityLabel={`Open ${activity.name} insights`}
                        >
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
                        </Pressable>
                    ))}
            </View>

            <OverlayModal visible={selected !== null} onClose={() => setSelected(null)} fullScreen>
                {selected && (
                    <ActivityInsightsDetail activity={selected} onClose={() => setSelected(null)} />
                )}
            </OverlayModal>
        </Card>
    );
});

type Styles = ReturnType<typeof useThemedStyles>;

const useThemedStyles = (colors: ThemeColors) =>
    useMemo(
        () =>
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
                grow: { flex: 1, minWidth: 0 },
                topTitle: {
                    fontSize: 20,
                    fontWeight: '800',
                    color: colors.text,
                    letterSpacing: -0.4,
                },
                topSub: {
                    fontSize: 14,
                    color: colors.textSecondary,
                    marginTop: 2,
                },
                closeBtn: {
                    minWidth: 44,
                    minHeight: 44,
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginLeft: 8,
                },
                scrollContent: {
                    padding: 16,
                    paddingBottom: 40,
                },
                cardTitle: {
                    fontSize: 16,
                    fontWeight: '700',
                    color: colors.text,
                    marginBottom: 6,
                },
                cardBody: {
                    fontSize: 15,
                    lineHeight: 22,
                    color: colors.textSecondary,
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
                chartWrap: {
                    height: SPARK_HEIGHT,
                    marginTop: 8,
                    alignSelf: 'stretch',
                },
                activitiesContainer: {
                    flexDirection: 'row',
                    flexWrap: 'wrap',
                    columnGap: 16,
                },
                activityUnit: {
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                    minHeight: 44,
                    maxWidth: '100%',
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
                    flexShrink: 1,
                    color: colors.text,
                    fontSize: 14,
                    fontWeight: '500',
                },
            }),
        [colors]
    );

export default RecoveryEpisodeDetails;
