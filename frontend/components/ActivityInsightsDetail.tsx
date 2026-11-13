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
import { useDateFormat } from '@/hooks/useDateFormat';
import { Card } from '@/components/Card';
import { ActivityIcon } from '@/components/activityIcon';
import { Activity, ActivityGroup } from '@/components/types';
import { moodColor } from '@/components/timeline/moodColor';
import {
    ENTRIES_FOR_ACTIVITY_IN_RANGE,
    CO_OCCURRING_ACTIVITIES_IN_RANGE,
    ACTIVITY_CORRELATION,
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
import { useTimeframe } from '@/context/TimeframeContext';
import { now } from '@/lib/clock';
import { getActivityGroups } from '@/databases/groups';
import { ActivityEditModal } from './forms/ActivityEditModal';
import { getActivity } from '@/databases/activities';
import { ActivityCorrelationRawRow } from './visualisations/transforms/activityCorrelation';

type FeatherName = React.ComponentProps<typeof Feather>['name'];

/** Minimum distinct logged days before the optional trend sparkline is worth it. */
const MIN_TREND_DAYS = 6;
const SPARK_HEIGHT = 96;
const HISTOGRAM_HEIGHT = 132;

type DetailData = {
    activityRows: ActivityCorrelationRawRow[];
    allRows: ActivityCorrelationRawRow[];
    coRows: CoOccurringRow[];
    group: ActivityGroup | undefined;
    groups: ActivityGroup[];
};
const EMPTY_DATA: DetailData = { activityRows: [], allRows: [], coRows: [], group: undefined, groups: [] };

const VARIABILITY_ICON: Record<VariabilityKind, FeatherName> = {
    insufficient: 'clock',
    consistent_positive: 'sun',
    consistent_low: 'cloud-rain',
    consistent_neutral: 'meh',
    polarizing: 'shuffle',
};

// The date shape is the user's choice (`date_format`), so this is no longer a
// module-level helper: the component binds it from useDateFormat and passes it
// down. See lib/dateFormat.ts.

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
    const styles = useMemo(() => makeStyles(colors), [colors]);
    const { format } = useDateFormat();
    /** "18 Sep 2026" in the user's chosen order (setting `date_format`). */
    const fmtDate = (iso: string): string => format(iso, 'medium');
    const insets = useSafeAreaInsets();
    const db = useSQLiteContext();
    const [data, setData] = useState<DetailData | null>(null);
    const { periodWindow } = useTimeframe();
    const [currentActivity, setCurrentActivity] = useState(activity);
    const [editorVisible, setEditorVisible] = useState<boolean>(false);

    const load = useCallback(() => {
        let active = true;
        (async () => {
            try {                
                // All-time bounds for the "vs usual" split (all entries).
                const queryStart = periodWindow.start;
                const queryEnd = periodWindow.end;
                const [activityRows, allRows, coRows, groups] = await Promise.all([
                    db.getAllAsync<ActivityCorrelationRawRow>(ENTRIES_FOR_ACTIVITY_IN_RANGE,
                        [currentActivity.id, queryStart, queryEnd]),
                    db.getAllAsync<ActivityCorrelationRawRow>(ACTIVITY_CORRELATION,
                        [queryStart, queryEnd]),
                    db.getAllAsync<CoOccurringRow>(CO_OCCURRING_ACTIVITIES_IN_RANGE,
                        [queryStart, queryEnd, currentActivity.id]),
                    getActivityGroups(db),
                ]);
                if (active) {
                    const group = groups.find((g) => g.id === currentActivity.group_id);
                    setData({ activityRows, allRows, coRows, groups, group });
                }
            } catch (e) {
                console.error('Error loading activity insights:', e);
                if (active) setData(EMPTY_DATA);
            }
        })();
        return () => {
            active = false;
        };
    }, [db, currentActivity.id, currentActivity.group_id, periodWindow]);
    useDataRefresh(load, [db, currentActivity.id, currentActivity.group_id, periodWindow]);

    const model = useMemo(() => {
        const d = data ?? EMPTY_DATA;
        const moods = d.activityRows.map((r) => r.mood);
        return {
            stats: activityMoodStats(moods),
            variability: classifyVariability(moods, { label: currentActivity.name }),
            impact: activityMoodImpact(currentActivity.id, d.allRows),
            buckets: bucketMoodHistogram(d.activityRows),
            trend: moodTrendForActivity(d.activityRows),
            co: topCoOccurring(d.coRows),
            firstDate: d.activityRows[0]?.date ?? null,
            lastDate: d.activityRows[d.activityRows.length - 1]?.date ?? null,
        };
    }, [data, currentActivity.name]);

    // Re-read the activity after the edit dialog saved or deleted it: gone means
    // it was deleted, so this screen closes; otherwise show the new name/group.
    const onUpdate = async () => {
        const updated = await getActivity(db, currentActivity.id);
        if (updated === null) {
            onClose();
        } else {
            setCurrentActivity(updated);
        }
    };

    // Title, then the pencil right beside it (it edits the name and group shown
    // there), then the close X pinned to the right edge. The title block may
    // shrink and its lines ellipsize, so a long name never pushes the pencil or
    // the X off the row; the spacer keeps a clear gap before the X.
    const header = (
        <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
            <View style={styles.titleBlock}>
                <Text style={styles.topTitle} numberOfLines={1}>
                    {currentActivity.name}
                </Text>
                {data?.group && (
                    <Text style={styles.topSubtitle} numberOfLines={1}>
                        {data.group.name}
                    </Text>
                )}
            </View>

            <Pressable
                testID="activity-detail-edit"
                onPress={() => setEditorVisible(true)}
                disabled={data === null}
                style={({ pressed }) => [
                    styles.editBtn,
                    (pressed || data === null) && styles.editBtnDimmed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Edit activity name and group"
                accessibilityState={{ disabled: data === null }}
            >
                <Feather name="edit-2" size={20} color={colors.text} />
            </Pressable>

            <View style={styles.headerSpacer} />

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

    // The edit dialog belongs to EVERY state below (loading, never logged, the
    // full view), so the pencil also works on an activity with no entries yet,
    // e.g. one just added from the Explorer.
    const editModal = editorVisible && data !== null && (
        <ActivityEditModal
            visible
            activity={currentActivity}
            groups={data.groups}
            onClose={() => setEditorVisible(false)}
            onUpdate={onUpdate}
            db={db}
        />
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
                            iconName={currentActivity.icon_name}
                            iconFamily={currentActivity.icon_family}
                            color={colors.accent}
                            size={30}
                        />
                    </View>
                    <Text style={styles.emptyTitle}>No {currentActivity.name} entries yet</Text>
                    <Text style={styles.emptyBody}>
                        Log {currentActivity.name} alongside your mood a few times and its pattern will
                        show up here.
                    </Text>
                </View>
                {editModal}
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
        periodWindow.start && periodWindow.end
            ? fmtDate(periodWindow.start) === fmtDate(periodWindow.end)
                ? fmtDate(periodWindow.start)
                : `${fmtDate(periodWindow.start)} – ${fmtDate(periodWindow.end)}`
            :
        model.firstDate && model.lastDate
            ? fmtDate(model.firstDate) === fmtDate(model.lastDate)
                ? fmtDate(model.firstDate)
                : `${fmtDate(model.firstDate)} – ${fmtDate(model.lastDate)}`
            : '';

    const maxFrequency = Math.max(1, ...model.buckets);

    const getBarHeight = (count: number) => {
        if (maxFrequency === 0) return 0;
        return (count / maxFrequency) * HISTOGRAM_HEIGHT;
    };

    // Generate y-axis labels
    const yAxisLabels = Array.from(
        { length: 5 },
        (_, i) => Math.round(maxFrequency * (4 - i) / 4)
    );

    return (
        <View style={styles.screen}>
            {header}
            <ScrollView
                key={currentActivity.id}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
            >
                {/* (a) Header — icon, name, count, date range */}
                <Card>
                    <View style={styles.headerRow}>
                        <View style={[styles.iconChip, { backgroundColor: colors.accentLight }]}>
                            <ActivityIcon
                                iconName={currentActivity.icon_name}
                                iconFamily={currentActivity.icon_family}
                                color={colors.accent}
                                size={26}
                            />
                        </View>
                        <View style={styles.grow}>
                            <Text style={styles.activityTitle}>{currentActivity.name}</Text>
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
                    <Text style={styles.cardTitle}>Mood when logging {currentActivity.name}</Text>
                    {imp.isMeaningful && imp.withAvg !== null && imp.withoutAvg !== null ? (
                        <>
                            <Text style={styles.cardBody}>
                                When you log {currentActivity.name}, your mood averages{' '}
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
                                vs {imp.withoutAvg.toFixed(1)} without it.
                            </Text>
                            <View style={styles.compare}>
                                <CompareBar
                                    label={`With ${currentActivity.name}`}
                                    value={imp.withAvg}
                                    fill={colors.accent}
                                    styles={styles}
                                    colors={colors}
                                />
                                <CompareBar
                                    label="Without"
                                    value={imp.withoutAvg}
                                    fill={colors.textSecondary}
                                    styles={styles}
                                    colors={colors}
                                />
                            </View>
                        </>
                    ) : (
                        <Text style={styles.cardBody}>
                            You've logged {currentActivity.name} on{' '}
                            <Text style={styles.emphasis}>
                                {imp.withCount} {imp.withoutCount === 1 ? 'day' : 'days'}
                            </Text>
                            {imp.withAvg !== null
                                ? ` (averaging ${imp.withAvg.toFixed(1)})`
                                : ''}
                            . Log it a few more times — and a few times without it — to compare it to
                            your usual mood.
                        </Text>
                    )}
                </Card>

                {/* (c) Distribution histogram */}
                <Card>
                    <Text style={styles.cardTitle}>How those days are distributed</Text>
                    <Text style={styles.cardBody}>
                        How often your mood on {currentActivity.name} lands at each level.
                    </Text>

                    <View style={styles.distributionContainer}>
                        {/* Y-axis title */}
                        <View style={styles.yAxisTitleContainer}>
                            <Text style={[styles.axisTitle, styles.yAxisTitle]}>Frequency</Text>
                        </View>

                        {/* Y-axis labels and plot area */}
                        <View style={styles.plotContainer}>
                            {/* Y-axis labels */}
                            <View style={styles.yAxis}>
                                {yAxisLabels.map((label, index) => (
                                    <Text key={index} style={[styles.yAxisLabel, {top: (index * HISTOGRAM_HEIGHT) / 4 - 8,}]}>
                                        {label}
                                    </Text>
                                ))}
                            </View>

                            {/* Plot area */}
                            <View style={styles.plotArea}>
                                {/* Grid lines */}
                                {yAxisLabels.map((_, index) => (
                                    <View
                                        key={index}
                                        style={[
                                            styles.gridLine,
                                            {
                                                top: (index * HISTOGRAM_HEIGHT) / 4,
                                            }
                                        ]}
                                    />
                                ))}

                                {/* Bars */}
                                <View style={styles.barsContainer}>
                                    {model.buckets.map((count, index) => (
                                        <View key={index} style={styles.barWrapper}>
                                            <View
                                                style={[
                                                    styles.bar,
                                                    {
                                                        height: getBarHeight(count),
                                                    }
                                                ]}
                                            />
                                            {count > 0 && (
                                                <Text style={styles.freqLabel}>{count}</Text>
                                            )}
                                        </View>
                                    ))}
                                </View>
                            </View>
                        </View>
                    </View>

                    {/* X-axis container with labels */}
                    <View style={styles.xAxisContainer}>
                        {/* Tick marks and numbers */}
                        <View style={styles.xAxisLabels}>
                            {Array.from({ length: NUM_BUCKETS }, (_, i) => (
                                <Text key={i} style={styles.xAxisLabel}>
                                    {i}
                                </Text>
                            ))}
                        </View>

                        {/* X-axis title */}
                        <Text style={[styles.axisTitle, styles.xAxisTitle]}>Mood rating</Text>
                    </View>
                </Card>

                {/* (e) Often paired with */}
                {model.co.length > 0 && (
                    <Card>
                        <Text style={styles.cardTitle}>Often paired with</Text>
                        <View style={styles.chipWrap}>
                            {model.co.map((c) => (
                                <Pressable
                                    key={'button-' + c.id}
                                    onPress={() => setCurrentActivity(c)}
                                    style={({ pressed }) => [pressed && styles.chipPressed]}
                                    accessibilityRole="button"
                                    accessibilityLabel={`Open ${c.name} insights`}
                                >
                                    <View key={c.id} style={styles.pairChip}>
                                        <ActivityIcon
                                            iconName={c.icon_name}
                                            iconFamily={c.icon_family}
                                            color={colors.text}
                                            size={14}
                                        />
                                        <Text style={styles.pairName}>{c.name}</Text>
                                        <Text style={styles.pairCount}>×{c.n}</Text>
                                        <Feather name='chevron-right' size={14} color={colors.textSecondary} />
                                    </View>
                                </Pressable>
                            ))}
                        </View>
                    </Card>
                )}

                {/* (f) Optional trend sparkline */}
                {model.trend.length >= MIN_TREND_DAYS && (
                    <Card>
                        <Text style={styles.cardTitle}>Trend over time</Text>
                        <Text style={styles.cardBody}>
                            Your daily average mood on {currentActivity.name} days, oldest to newest.
                        </Text>
                        <Sparkline
                            values={model.trend.map((t) => t.avg)}
                            color={colors.accent}
                            styles={styles}
                        />
                    </Card>
                )}
            </ScrollView>
            {editModal}
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
            fontSize: 20,
            fontWeight: '800',
            color: colors.text,
            letterSpacing: -0.4,
            paddingBottom: 0,
        },
        topSubtitle: {
            marginTop: -3,
            padding: 0,
            fontSize: 13,
            color: colors.textSecondary,
        },
        // Shrinks (never grows) so a long name ellipsizes instead of pushing the
        // pencil and the X off the row.
        titleBlock: {
            flexShrink: 1,
            minWidth: 0,
        },
        // A 44dp target with the glyph centred: the visible pencil sits ~16dp
        // after the name.
        editBtn: {
            width: 44,
            height: 44,
            alignItems: 'center',
            justifyContent: 'center',
            marginLeft: 4,
            flexShrink: 0,
        },
        editBtnDimmed: {
            opacity: 0.5,
        },
        // Takes the free width between the pencil and the X; never less than a
        // clear gap, so the two buttons are not easy to mis-tap.
        headerSpacer: {
            flex: 1,
            minWidth: 16,
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
        distributionContainer: {
            flexDirection: 'row',
            marginTop: 30,
        },
        yAxisTitleContainer: {
            width: 16,
            height: HISTOGRAM_HEIGHT,
            justifyContent: 'center',
        },
        plotContainer: {
            flex: 1,
            flexDirection: 'row',
        },
        yAxis: {
            width: 30,
            height: HISTOGRAM_HEIGHT,
            alignItems: 'flex-end',
            paddingRight: 8,
        },
        yAxisLabel: {
            position: 'absolute',
            color: colors.textSecondary,
            fontSize: 12,
            paddingRight: 8,
        },
        plotArea: {
            flex: 1,
            height: HISTOGRAM_HEIGHT,
            position: 'relative',
        },
        gridLine: {
            position: 'absolute',
            left: 0,
            right: 0,
            height: 1,
            backgroundColor: colors.overlays.tag,
        },
        barsContainer: {
            flex: 1,
            flexDirection: 'row',
            alignItems: 'flex-end',
            height: HISTOGRAM_HEIGHT,
        },
        barWrapper: {
            flex: 1,
            alignItems: 'center',
            justifyContent: 'flex-end',
        },
        bar: {
            width: '80%',
            backgroundColor: colors.accent,
            borderTopLeftRadius: 4,
            borderTopRightRadius: 4,
            minHeight: 1,
        },
        freqLabel: {
            position: 'absolute',
            top: -20,
            color: colors.textSecondary,
            fontSize: 10,
        },
        xAxisContainer: {
            height: 30,
            marginLeft: 45,
            marginTop: 6,
            marginBottom: 8,
        },
        xAxisLabels: {
            flexDirection: 'row',
            justifyContent: 'flex-end',
            width: '100%',
        },
        xAxisLabel: {
            flex: 1,
            color: colors.textSecondary,
            fontSize: 12,
            textAlign: 'center',
            width: '100%',
        },
        axisTitle: {
            color: colors.textSecondary,
            fontSize: 14,
            fontWeight: '500',
        },
        yAxisTitle: {
            transform: [{ rotate: '-90deg' }],
            width: HISTOGRAM_HEIGHT,
            textAlign: 'center',
            position: 'absolute',
            left: -HISTOGRAM_HEIGHT / 2 + 10,
        },
        xAxisTitle: {
            textAlign: 'center',
            marginTop: 0,
        },
        chipWrap: {
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 8,
            marginTop: 10,
        },
        chipPressed: {
            opacity: 0.6,
        },
        pairChip: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            paddingVertical: 7,
            paddingHorizontal: 12,
            borderRadius: 16,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: colors.overlays.tagBorder,
            backgroundColor: colors.accentLight,
            justifyContent: 'center',
        },
        activityUnit: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
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
