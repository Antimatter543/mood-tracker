import React, { useCallback, useMemo, useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    Pressable,
    ActivityIndicator,
    type DimensionValue,
} from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { Svg, Polyline } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';

import { ThemeColors, useThemeColors } from '@/styles/global';
import { useDataRefresh } from '@/hooks/useDataRefresh';
import { Card } from '@/components/Card';
import { ActivityIcon } from '@/components/activityIcon';
import { Activity } from '@/components/types';
import { moodColor } from '@/components/timeline/moodColor';
import { startOfLocalDay, endOfLocalDay } from '@/databases/dateHelpers';
import {
    ENTRIES_FOR_ACTIVITY,
    WEEKLY_MOOD_AVERAGES,
    CO_OCCURRING_ACTIVITIES,
} from '@/components/visualisations/queries';
import { NUM_BUCKETS } from '@/components/visualisations/transforms/scatter';
import {
    activityMoodStats,
    classifyVariability,
    activityMoodImpact,
    bucketMoodHistogram,
    moodTrendForActivity,
    sparklinePoints,
    topCoOccurring,
    type VariabilityKind,
    type CoOccurringRow,
} from '@/components/visualisations/transforms/activityDetail';

type FeatherName = React.ComponentProps<typeof Feather>['name'];

/** Minimum distinct logged days before the optional trend sparkline is worth it. */
const MIN_TREND_DAYS = 6;
const SPARK_HEIGHT = 48;
const HISTOGRAM_HEIGHT = 132;

type EntryRow = { id: number; date: string; mood: number };
type DetailData = {
    activityRows: EntryRow[];
    allRows: { date: string; mood: number }[];
    coRows: CoOccurringRow[];
};
const EMPTY_DATA: DetailData = { activityRows: [], allRows: [], coRows: [] };

const VARIABILITY_ICON: Record<VariabilityKind, FeatherName> = {
    insufficient: 'clock',
    consistent_positive: 'sun',
    consistent_low: 'cloud-rain',
    consistent_neutral: 'meh',
    polarizing: 'shuffle',
};

const fmtDate = (iso: string): string =>
    new Date(iso).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    });

/**
 * Full-screen detail for ONE activity: its mood distribution, variability
 * ("hit or miss" vs "reliably good"), how it compares to your usual mood, and
 * what you pair it with. Rendered as the body of an `<OverlayModal fullScreen>`
 * (never a native <Modal>). All numbers come from pure, unit-tested transforms.
 */
export const ActivityInsightsDetail: React.FC<{
    activity: Activity;
    onClose: () => void;
}> = ({ activity, onClose }) => {
    const colors = useThemeColors();
    const insets = useSafeAreaInsets();
    const db = useSQLiteContext();
    const styles = useMemo(() => makeStyles(colors), [colors]);
    const [data, setData] = useState<DetailData | null>(null);

    const load = useCallback(() => {
        let active = true;
        (async () => {
            try {
                // All-time bounds for the "vs usual" split (all entries).
                const start = startOfLocalDay(new Date(0));
                const end = endOfLocalDay(new Date());
                const [activityRows, allRows, coRows] = await Promise.all([
                    db.getAllAsync<EntryRow>(ENTRIES_FOR_ACTIVITY, [activity.id]),
                    db.getAllAsync<{ date: string; mood: number }>(WEEKLY_MOOD_AVERAGES, [
                        start,
                        end,
                    ]),
                    db.getAllAsync<CoOccurringRow>(CO_OCCURRING_ACTIVITIES, [activity.id]),
                ]);
                if (active) setData({ activityRows, allRows, coRows });
            } catch (e) {
                console.error('Error loading activity insights:', e);
                if (active) setData(EMPTY_DATA);
            }
        })();
        return () => {
            active = false;
        };
    }, [db, activity.id]);
    useDataRefresh(load, [db, activity.id]);

    const model = useMemo(() => {
        const d = data ?? EMPTY_DATA;
        const moods = d.activityRows.map((r) => r.mood);
        return {
            stats: activityMoodStats(moods),
            variability: classifyVariability(moods, { label: activity.name }),
            impact: activityMoodImpact(d.allRows, d.activityRows),
            buckets: bucketMoodHistogram(d.activityRows),
            trend: moodTrendForActivity(d.activityRows),
            co: topCoOccurring(d.coRows),
            firstDate: d.activityRows[0]?.date ?? null,
            lastDate: d.activityRows[d.activityRows.length - 1]?.date ?? null,
        };
    }, [data, activity.name]);

    const header = (
        <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
            <Text style={styles.topTitle} numberOfLines={1}>
                {activity.name}
            </Text>
            <Pressable
                onPress={onClose}
                hitSlop={16}
                style={styles.closeBtn}
                accessibilityRole="button"
                accessibilityLabel="Close activity insights"
            >
                <Feather name="x" size={24} color={colors.text} />
            </Pressable>
        </View>
    );

    // Still loading.
    if (data === null) {
        return (
            <View style={styles.screen}>
                {header}
                <View style={styles.centerFill}>
                    <ActivityIndicator color={colors.accent} />
                </View>
            </View>
        );
    }

    // Never logged — calm empty state.
    if (model.stats.count === 0) {
        return (
            <View style={styles.screen}>
                {header}
                <View style={styles.centerFill}>
                    <View style={[styles.iconHalo, { backgroundColor: colors.accentLight }]}>
                        <ActivityIcon
                            iconName={activity.icon_name}
                            iconFamily={activity.icon_family}
                            color={colors.accent}
                            size={30}
                        />
                    </View>
                    <Text style={styles.emptyTitle}>No {activity.name} entries yet</Text>
                    <Text style={styles.emptyBody}>
                        Log {activity.name} alongside your mood a few times and its pattern will
                        show up here.
                    </Text>
                </View>
            </View>
        );
    }

    const s = model.stats;
    const v = model.variability;
    const imp = model.impact;
    const varColor =
        v.kind === 'consistent_low'
            ? colors.isDark
                ? '#FF8A80'
                : '#E57373'
            : v.kind === 'insufficient'
              ? colors.textSecondary
              : colors.accent;

    const rangeText =
        model.firstDate && model.lastDate
            ? fmtDate(model.firstDate) === fmtDate(model.lastDate)
                ? fmtDate(model.firstDate)
                : `${fmtDate(model.firstDate)} – ${fmtDate(model.lastDate)}`
            : '';

    const maxFreq = Math.max(1, ...model.buckets);

    return (
        <View style={styles.screen}>
            {header}
            <ScrollView
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
            >
                {/* (a) Header — icon, name, count, date range */}
                <Card>
                    <View style={styles.headerRow}>
                        <View style={[styles.iconChip, { backgroundColor: colors.accentLight }]}>
                            <ActivityIcon
                                iconName={activity.icon_name}
                                iconFamily={activity.icon_family}
                                color={colors.accent}
                                size={26}
                            />
                        </View>
                        <View style={styles.grow}>
                            <Text style={styles.activityTitle}>{activity.name}</Text>
                            <Text style={styles.activitySub}>
                                {s.count} {s.count === 1 ? 'entry' : 'entries'}
                                {rangeText ? ` · ${rangeText}` : ''}
                            </Text>
                        </View>
                    </View>
                </Card>

                {/* (d) Variability callout — the centerpiece, placed prominently up top */}
                <Card accentTop>
                    <View style={styles.calloutRow}>
                        <View style={[styles.iconChip, { backgroundColor: colors.accentLight }]}>
                            <Feather name={VARIABILITY_ICON[v.kind]} size={22} color={varColor} />
                        </View>
                        <View style={styles.grow}>
                            <Text style={[styles.calloutHeadline, { color: varColor }]}>
                                {v.headline}
                            </Text>
                            <Text style={styles.calloutBody}>{v.detail}</Text>
                            {v.kind !== 'insufficient' && (
                                <Text style={styles.calloutStat}>
                                    Average {s.mean.toFixed(1)} · typical swing ±{s.stdev.toFixed(1)}{' '}
                                    · range {s.min.toFixed(1)}–{s.max.toFixed(1)}
                                </Text>
                            )}
                        </View>
                    </View>
                </Card>

                {/* (b) Mood when doing X — vs your usual */}
                <Card>
                    <Text style={styles.cardTitle}>Mood when doing {activity.name}</Text>
                    {imp.isMeaningful && imp.withAvg !== null && imp.withoutAvg !== null ? (
                        <>
                            <Text style={styles.cardBody}>
                                On {activity.name} days your mood averages{' '}
                                <Text style={styles.emphasis}>{imp.withAvg.toFixed(1)}</Text> —
                                that's{' '}
                                <Text
                                    style={[
                                        styles.emphasis,
                                        {
                                            color:
                                                (imp.delta ?? 0) >= 0
                                                    ? colors.accent
                                                    : varColorForNegative(colors),
                                        },
                                    ]}
                                >
                                    {(imp.delta ?? 0) >= 0 ? '+' : ''}
                                    {(imp.delta ?? 0).toFixed(1)}
                                </Text>{' '}
                                vs {imp.withoutAvg.toFixed(1)} on your other days.
                            </Text>
                            <View style={styles.compare}>
                                <CompareBar
                                    label={`With ${activity.name}`}
                                    value={imp.withAvg}
                                    fill={colors.accent}
                                    styles={styles}
                                    colors={colors}
                                />
                                <CompareBar
                                    label="Other days"
                                    value={imp.withoutAvg}
                                    fill={colors.textSecondary}
                                    styles={styles}
                                    colors={colors}
                                />
                            </View>
                        </>
                    ) : (
                        <Text style={styles.cardBody}>
                            You've logged {activity.name} on{' '}
                            <Text style={styles.emphasis}>
                                {imp.withDays} {imp.withDays === 1 ? 'day' : 'days'}
                            </Text>
                            {imp.withAvg !== null
                                ? ` (averaging ${imp.withAvg.toFixed(1)})`
                                : ''}
                            . Log it a few more times — and some days without it — to compare it to
                            your usual mood.
                        </Text>
                    )}
                </Card>

                {/* (c) Distribution histogram */}
                <Card>
                    <Text style={styles.cardTitle}>How those days are distributed</Text>
                    <Text style={styles.cardBody}>
                        How often your mood on {activity.name} days lands at each level.
                    </Text>
                    <View style={styles.histRow}>
                        {model.buckets.map((count, i) => (
                            <View key={i} style={styles.histCol}>
                                {count > 0 && <Text style={styles.histCount}>{count}</Text>}
                                <View
                                    style={[
                                        styles.histBar,
                                        {
                                            height: Math.max(2, (count / maxFreq) * HISTOGRAM_HEIGHT),
                                            backgroundColor: moodColor(
                                                i + 0.5,
                                                colors.accent,
                                                colors.overlays.tag,
                                            ),
                                        },
                                    ]}
                                />
                                <Text style={styles.histAxis}>{i}</Text>
                            </View>
                        ))}
                    </View>
                    <Text style={styles.axisCaption}>Mood rating (0–{NUM_BUCKETS - 1})</Text>
                </Card>

                {/* (e) Often paired with */}
                {model.co.length > 0 && (
                    <Card>
                        <Text style={styles.cardTitle}>Often paired with</Text>
                        <View style={styles.chipWrap}>
                            {model.co.map((c) => (
                                <View key={c.id} style={styles.pairChip}>
                                    <ActivityIcon
                                        iconName={c.icon_name}
                                        iconFamily={c.icon_family}
                                        color={colors.text}
                                        size={14}
                                    />
                                    <Text style={styles.pairName}>{c.name}</Text>
                                    <Text style={styles.pairCount}>×{c.n}</Text>
                                </View>
                            ))}
                        </View>
                    </Card>
                )}

                {/* (f) Optional trend sparkline */}
                {model.trend.length >= MIN_TREND_DAYS && (
                    <Card>
                        <Text style={styles.cardTitle}>Trend over time</Text>
                        <Text style={styles.cardBody}>
                            Your daily average mood on {activity.name} days, oldest to newest.
                        </Text>
                        <Sparkline
                            values={model.trend.map((t) => t.avg)}
                            color={colors.accent}
                            styles={styles}
                        />
                    </Card>
                )}
            </ScrollView>
        </View>
    );
};

const varColorForNegative = (colors: ThemeColors): string =>
    colors.isDark ? '#FF8A80' : '#E57373';

/** A single labelled proportional bar (value on the 0–10 mood scale). */
const CompareBar: React.FC<{
    label: string;
    value: number;
    fill: string;
    styles: Styles;
    colors: ThemeColors;
}> = ({ label, value, fill, styles, colors }) => {
    const pct = `${Math.min(100, Math.max(0, (value / 10) * 100))}%` as DimensionValue;
    return (
        <View style={styles.compareRow}>
            <Text style={styles.compareLabel} numberOfLines={1}>
                {label}
            </Text>
            <View style={[styles.compareTrack, { backgroundColor: colors.overlays.tag }]}>
                <View style={[styles.compareFill, { width: pct, backgroundColor: fill }]} />
            </View>
            <Text style={styles.compareValue}>{value.toFixed(1)}</Text>
        </View>
    );
};

/** Width-measured SVG sparkline. Path math lives in the pure `sparklinePoints`. */
const Sparkline: React.FC<{ values: number[]; color: string; styles: Styles }> = ({
    values,
    color,
    styles,
}) => {
    const [width, setWidth] = useState(0);
    const points = sparklinePoints(values, width, SPARK_HEIGHT);
    const pointsStr = points.map((p) => `${p.x},${p.y}`).join(' ');
    return (
        <View
            testID="activity-trend-sparkline"
            style={styles.sparkWrap}
            onLayout={(e) => {
                const w = e.nativeEvent.layout.width;
                if (w > 0 && Math.abs(w - width) > 1) setWidth(w);
            }}
        >
            {width > 0 && points.length > 1 && (
                <Svg width={width} height={SPARK_HEIGHT}>
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

type Styles = ReturnType<typeof makeStyles>;

const makeStyles = (colors: ThemeColors) =>
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
        closeBtn: {
            padding: 4,
            marginLeft: 8,
        },
        scrollContent: {
            padding: 16,
            paddingBottom: 40,
        },
        centerFill: {
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            padding: 32,
        },
        grow: { flex: 1 },
        headerRow: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 14,
        },
        iconChip: {
            width: 48,
            height: 48,
            borderRadius: 24,
            alignItems: 'center',
            justifyContent: 'center',
        },
        activityTitle: {
            fontSize: 22,
            fontWeight: '800',
            color: colors.text,
            letterSpacing: -0.5,
        },
        activitySub: {
            fontSize: 13,
            color: colors.textSecondary,
            marginTop: 2,
        },
        calloutRow: {
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: 14,
        },
        calloutHeadline: {
            fontSize: 19,
            fontWeight: '800',
            letterSpacing: -0.3,
        },
        calloutBody: {
            fontSize: 15,
            lineHeight: 22,
            color: colors.text,
            marginTop: 4,
        },
        calloutStat: {
            fontSize: 12.5,
            color: colors.textSecondary,
            marginTop: 8,
        },
        cardTitle: {
            fontSize: 17,
            fontWeight: '700',
            color: colors.text,
            marginBottom: 6,
        },
        cardBody: {
            fontSize: 14.5,
            lineHeight: 21,
            color: colors.textSecondary,
        },
        emphasis: {
            color: colors.text,
            fontWeight: '700',
        },
        compare: {
            marginTop: 14,
            gap: 10,
        },
        compareRow: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
        },
        compareLabel: {
            width: 92,
            fontSize: 12,
            color: colors.textSecondary,
        },
        compareTrack: {
            flex: 1,
            height: 12,
            borderRadius: 6,
            overflow: 'hidden',
        },
        compareFill: {
            height: 12,
            borderRadius: 6,
        },
        compareValue: {
            width: 30,
            fontSize: 12,
            fontWeight: '600',
            color: colors.text,
            textAlign: 'right',
        },
        histRow: {
            flexDirection: 'row',
            alignItems: 'flex-end',
            height: HISTOGRAM_HEIGHT + 34,
            marginTop: 14,
        },
        histCol: {
            flex: 1,
            alignItems: 'center',
            justifyContent: 'flex-end',
        },
        histCount: {
            fontSize: 10,
            color: colors.textSecondary,
            marginBottom: 2,
        },
        histBar: {
            width: '72%',
            borderTopLeftRadius: 4,
            borderTopRightRadius: 4,
        },
        histAxis: {
            fontSize: 11,
            color: colors.textSecondary,
            marginTop: 6,
        },
        axisCaption: {
            fontSize: 12,
            color: colors.textSecondary,
            textAlign: 'center',
            marginTop: 4,
        },
        chipWrap: {
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 8,
            marginTop: 10,
        },
        pairChip: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            paddingVertical: 7,
            paddingHorizontal: 12,
            borderRadius: 16,
            backgroundColor: colors.overlays.tag,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: colors.overlays.tagBorder,
        },
        pairName: {
            fontSize: 13,
            color: colors.text,
            fontWeight: '500',
        },
        pairCount: {
            fontSize: 12,
            color: colors.textSecondary,
        },
        sparkWrap: {
            height: SPARK_HEIGHT,
            marginTop: 14,
            alignSelf: 'stretch',
        },
        iconHalo: {
            width: 72,
            height: 72,
            borderRadius: 36,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 16,
        },
        emptyTitle: {
            fontSize: 18,
            fontWeight: '700',
            color: colors.text,
            textAlign: 'center',
            marginBottom: 8,
        },
        emptyBody: {
            fontSize: 14.5,
            lineHeight: 21,
            color: colors.textSecondary,
            textAlign: 'center',
        },
    });

export default ActivityInsightsDetail;
