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
import { startOfLocalDay, endOfLocalDay } from '@/databases/dateHelpers';
import {
    CO_OCCURRING_ACTIVITIES,
    ACTIVITY_CORRELATION,
    ENTRIES_FOR_ACTIVITY_IN_RANGE,
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
import { now } from '@/lib/clock';
import { useSettings } from '@/context/SettingsContext';
import { ActivityCorrelationRawRow, MIN_SAMPLES } from './visualisations/transforms/activityCorrelation';
import { getActivityGroups } from '@/databases/groups';
import { ActivityEditModal } from './forms/ActivityEditModal';
import { getActivity } from '@/databases/activities';

type FeatherName = React.ComponentProps<typeof Feather>['name'];

/** Minimum distinct logged values before the optional trend sparkline is worth it. */
const MIN_TREND_VALUES = 6;
const SPARK_HEIGHT = 48;
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
    const { format } = useDateFormat();
    /** "18 Sep 2026" in the user's chosen order (setting `date_format`). */
    const fmtDate = (iso: string): string => format(iso, 'medium');
    const insets = useSafeAreaInsets();
    const db = useSQLiteContext();
    const styles = useMemo(() => makeStyles(colors), [colors]);
    const { settings } = useSettings();
    const perEntry = settings.activity_per_entry;
    const carryover = settings.activity_carryover;
    const [currentActivity, setCurrentActivity] = useState(activity);
    const [data, setData] = useState<DetailData | null>(null);
    const [editorVisible, setEditorVisible] = useState<boolean>(false);

    const load = useCallback(() => {
        let active = true;
        (async () => {
            try {
                // All-time bounds for the "vs usual" split (all entries).
                const start = startOfLocalDay(new Date(0));
                const end = endOfLocalDay(now());
                const [activityRows, allRows, coRows, groups] = await Promise.all([
                    db.getAllAsync<ActivityCorrelationRawRow>(ENTRIES_FOR_ACTIVITY_IN_RANGE,
                        [currentActivity.id, start, end]),
                    db.getAllAsync<ActivityCorrelationRawRow>(ACTIVITY_CORRELATION,
                        [start, end]),
                    db.getAllAsync<CoOccurringRow>(CO_OCCURRING_ACTIVITIES, [currentActivity.id]),
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
    }, [db, currentActivity.id, currentActivity.group_id]);
    useDataRefresh(load, [db, currentActivity.id, currentActivity.group_id]);

    const model = useMemo(() => {
        const d = data ?? EMPTY_DATA;
        const moods = d.activityRows.map((r) => r.mood);
        return {
            stats: activityMoodStats(moods),
            variability: classifyVariability(moods, { label: currentActivity.name }),
            impact: activityMoodImpact(activity.id, d.allRows, MIN_SAMPLES, perEntry, carryover),
            buckets: bucketMoodHistogram(d.activityRows),
            trend: moodTrendForActivity(d.activityRows, perEntry),
            co: topCoOccurring(d.coRows),
            firstDate: d.activityRows[0]?.date ?? null,
            lastDate: d.activityRows[d.activityRows.length - 1]?.date ?? null,
        };
    }, [data, currentActivity.name, perEntry, carryover]);

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
                key={activity.id}
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
                                {imp.withCount} {imp.withCount === 1 ? (!perEntry ? "day" : "entry") : (!perEntry ? "days" : "entries")}
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
                    <Text style={styles.cardTitle}>How entries are distributed</Text>
                    <Text style={styles.cardBody}>
                        How often your mood on {currentActivity.name} lands at each level.
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
                {model.trend.length >= MIN_TREND_VALUES && (
                    <Card>
                        <Text style={styles.cardTitle}>Trend over time</Text>
                        <Text style={styles.cardBody}>
                            Your {!perEntry ? "daily average mood" : "mood"} on {currentActivity.name}, oldest to newest.
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
