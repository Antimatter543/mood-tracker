import React, { useMemo, useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    Pressable,
    LayoutChangeEvent,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Svg, { Path, Circle } from 'react-native-svg';
import { ThemeColors, useThemeColors } from '@/styles/global';
import { Card } from '@/components/Card';
import InfoBubble from '@/components/InfoBubble';
import { moodColor } from '@/components/timeline/moodColor';
import {
    buildChartGeometry,
    indexToX,
    type ChartDims,
    type ValueDomain,
    MOOD_DOMAIN,
} from './transforms/chartGeometry';
import {
    buildMoodMetricOverlay,
    OVERLAY_METRICS,
    OVERLAY_MIN_POINTS,
    type MoodMetricOverlay,
    type OverlayMetricConfig,
    type OverlayMetricKey,
} from './transforms/moodMetricOverlay';
import type { HealthMetricDay } from './transforms/healthMoodCorrelation';
import type { DailyAverage } from './transforms/dailyAverages';

/**
 * "Mood over time" — the mood↔metric OVERLAY card. Plots the user's daily mood
 * (fixed 0..10, left axis) against a chosen health metric (data-scaled, right
 * axis) over a recent window, with a toggle to switch the metric (Sleep hours /
 * Resting HR / HRV / Avg HR). Two independent series share the x (days); missing
 * days are gaps, never zeros.
 *
 * All data-prep + path math is pure + unit-tested (`moodMetricOverlay` +
 * `chartGeometry`); this is a thin, themed renderer. Only metrics with enough
 * paired data get a toggle, so a device with no HRV never shows an HRV toggle.
 */

const METHOD_NOTE =
    'Your daily mood (left) and the selected health metric (right) over the same ' +
    'days. Two views of your own data side by side — an association, not a cause, ' +
    'and not medical advice.';

const PAD_X = 16;
const PAD_TOP = 16;
const PAD_BOTTOM = 12;
const HEIGHT = 160;
const MOOD_DOT_R = 4;
const METRIC_DOT_R = 3;
const LABEL_SLOT_W = 56;
const GAP_DASH = '4 4';
const METRIC_LINE_OPACITY = 0.6;

const MONTHS = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** 'YYYY-MM-DD' → 'D Mon' (e.g. "1 Jul"). Fixed month names — no locale drift. */
function formatDayLabel(ymd: string): string {
    const [, m, d] = ymd.split('-').map(Number);
    const month = MONTHS[(m ?? 1) - 1] ?? '';
    return `${d ?? ''} ${month}`.trim();
}

/** Round a display metric for an axis label (1 dp for sleep hours, whole for bpm/ms). */
function formatMetric(value: number, unit: string): string {
    const n = unit === 'h' ? Math.round(value * 10) / 10 : Math.round(value);
    return `${n}${unit}`;
}

export interface MoodMetricOverlayCardProps {
    healthRows: ReadonlyArray<HealthMetricDay>;
    dailyMoods: ReadonlyArray<Pick<DailyAverage, 'day' | 'avg'>>;
}

const MoodMetricOverlayCard: React.FC<MoodMetricOverlayCardProps> = ({
    healthRows,
    dailyMoods,
}) => {
    const colors = useThemeColors();
    const styles = useStyles(colors);
    const [width, setWidth] = useState(0);
    const [selected, setSelected] = useState<OverlayMetricKey | null>(null);

    // Build each metric's overlay once; only metrics with enough paired data get
    // a toggle. `active` is the currently-shown (or first-available) metric.
    const built = useMemo(
        () =>
            OVERLAY_METRICS.map((config) => ({
                config,
                overlay: buildMoodMetricOverlay(healthRows, dailyMoods, config),
            })),
        [healthRows, dailyMoods]
    );

    const available = useMemo(
        () =>
            built.filter(
                (b) =>
                    b.overlay.metricCount >= OVERLAY_MIN_POINTS &&
                    b.overlay.moodCount >= OVERLAY_MIN_POINTS
            ),
        [built]
    );

    const active =
        available.find((b) => b.config.key === selected) ?? available[0] ?? null;

    const onLayout = (e: LayoutChangeEvent) => {
        const w = e.nativeEvent.layout.width;
        if (w > 0 && Math.abs(w - width) > 1) setWidth(w);
    };

    return (
        <Card>
            <InfoBubble text={METHOD_NOTE} />

            <View style={styles.headerRow}>
                <View style={[styles.iconCircle, { backgroundColor: colors.accentLight }]}>
                    <Ionicons name="analytics-outline" size={20} color={colors.accent} />
                </View>
                <Text style={styles.title}>Mood over time</Text>
            </View>

            {active == null ? (
                <Text style={styles.body}>
                    Keep logging — a few more days with both a mood entry and health
                    data and I'll plot your mood against sleep, resting heart rate and
                    more, day by day.
                </Text>
            ) : (
                <>
                    <Text style={styles.subtitle}>
                        Your mood plotted against your{' '}
                        <Text style={styles.subtitleEmphasis}>
                            {active.config.label.toLowerCase()}
                        </Text>
                        , day by day.
                    </Text>

                    {/* Metric toggle — only metrics with enough data appear. */}
                    <View style={styles.toggleRow}>
                        {available.map((b) => {
                            const isActive = b.config.key === active.config.key;
                            return (
                                <Pressable
                                    key={b.config.key}
                                    onPress={() => setSelected(b.config.key)}
                                    accessibilityRole="button"
                                    accessibilityState={{ selected: isActive }}
                                    testID={`overlay-toggle-${b.config.key}`}
                                    style={[
                                        styles.pill,
                                        {
                                            backgroundColor: isActive
                                                ? colors.accentLight
                                                : colors.secondaryBackground,
                                            borderColor: isActive
                                                ? colors.accent
                                                : colors.border,
                                        },
                                    ]}
                                >
                                    <Text
                                        style={[
                                            styles.pillText,
                                            {
                                                color: isActive
                                                    ? colors.accent
                                                    : colors.textSecondary,
                                                fontWeight: isActive ? '700' : '600',
                                            },
                                        ]}
                                    >
                                        {b.config.label}
                                    </Text>
                                </Pressable>
                            );
                        })}
                    </View>

                    {/* Legend */}
                    <View style={styles.legendRow}>
                        <View style={styles.legendItem}>
                            <View
                                style={[styles.swatch, { backgroundColor: colors.accent }]}
                            />
                            <Text style={styles.legendText}>Mood</Text>
                        </View>
                        <View style={styles.legendItem}>
                            <View
                                style={[
                                    styles.swatch,
                                    { backgroundColor: colors.text, opacity: METRIC_LINE_OPACITY },
                                ]}
                            />
                            <Text style={styles.legendText}>
                                {active.config.label} ({active.config.unit})
                            </Text>
                        </View>
                    </View>

                    <OverlayPlot
                        overlay={active.overlay}
                        config={active.config}
                        width={width}
                        onLayout={onLayout}
                        colors={colors}
                        styles={styles}
                    />
                </>
            )}
        </Card>
    );
};

type OverlayPlotProps = {
    overlay: MoodMetricOverlay;
    config: OverlayMetricConfig;
    width: number;
    onLayout: (e: LayoutChangeEvent) => void;
    colors: ThemeColors;
    styles: ReturnType<typeof useStyles>;
};

/** The dual-series SVG plot + twin-axis corner labels + sparse date labels. */
const OverlayPlot: React.FC<OverlayPlotProps> = ({
    overlay,
    config,
    width,
    onLayout,
    colors,
    styles,
}) => {
    const dims: ChartDims = useMemo(
        () => ({
            width: width || 1,
            height: HEIGHT,
            padX: PAD_X,
            padTop: PAD_TOP,
            padBottom: PAD_BOTTOM,
        }),
        [width]
    );

    const moodValues = useMemo(
        () => overlay.days.map((d) => d.mood),
        [overlay]
    );
    const metricValues = useMemo(
        () => overlay.days.map((d) => d.metric),
        [overlay]
    );

    // Metric domain from its own present range; pad a flat series so a constant
    // metric still draws a visible mid-line rather than clinging to an edge.
    const metricDomain: ValueDomain = useMemo(() => {
        const min = overlay.metricMin ?? 0;
        const max = overlay.metricMax ?? min + 1;
        return min === max ? { min: min - 1, max: max + 1 } : { min, max };
    }, [overlay]);

    const moodGeo = useMemo(
        () => buildChartGeometry(moodValues, dims, MOOD_DOMAIN),
        [moodValues, dims]
    );
    const metricGeo = useMemo(
        () => buildChartGeometry(metricValues, dims, metricDomain),
        [metricValues, dims, metricDomain]
    );

    const metricColor = colors.text;

    // Sparse x labels: first, middle, last day (avoid a 30-label pile-up).
    const labelIdxs = useMemo(() => {
        const n = overlay.days.length;
        if (n === 0) return [] as number[];
        if (n <= 2) return overlay.days.map((_, i) => i);
        return [0, Math.floor((n - 1) / 2), n - 1];
    }, [overlay]);

    return (
        <View style={styles.plotWrap} onLayout={onLayout} testID="mood-metric-overlay-chart">
            <View style={{ height: HEIGHT }}>
                {width > 0 && (
                    <Svg width="100%" height={HEIGHT}>
                        {/* Metric series (back): dashed gaps, solid line, small dots. */}
                        {metricGeo.gapPaths.map((d, i) => (
                            <Path
                                key={`m-gap-${i}`}
                                d={d}
                                stroke={metricColor}
                                strokeWidth={1.5}
                                strokeOpacity={METRIC_LINE_OPACITY * 0.6}
                                strokeDasharray={GAP_DASH}
                                strokeLinecap="round"
                                fill="none"
                            />
                        ))}
                        {metricGeo.linePath ? (
                            <Path
                                d={metricGeo.linePath}
                                stroke={metricColor}
                                strokeWidth={2}
                                strokeOpacity={METRIC_LINE_OPACITY}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                fill="none"
                            />
                        ) : null}
                        {metricGeo.realPoints.map((p) => (
                            <Circle
                                key={`m-dot-${p.index}`}
                                cx={p.x}
                                cy={p.y}
                                r={METRIC_DOT_R}
                                fill={metricColor}
                                fillOpacity={METRIC_LINE_OPACITY}
                            />
                        ))}

                        {/* Mood series (front): dashed gaps, accent line, ramp dots. */}
                        {moodGeo.gapPaths.map((d, i) => (
                            <Path
                                key={`mood-gap-${i}`}
                                d={d}
                                stroke={colors.accent}
                                strokeWidth={2}
                                strokeOpacity={0.45}
                                strokeDasharray={GAP_DASH}
                                strokeLinecap="round"
                                fill="none"
                            />
                        ))}
                        {moodGeo.linePath ? (
                            <Path
                                d={moodGeo.linePath}
                                stroke={colors.accent}
                                strokeWidth={2.5}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                fill="none"
                            />
                        ) : null}
                        {moodGeo.realPoints.map((p) => (
                            <Circle
                                key={`mood-dot-${p.index}`}
                                cx={p.x}
                                cy={p.y}
                                r={MOOD_DOT_R}
                                fill={moodColor(p.value, colors.accent, colors.overlays.tag)}
                                stroke={colors.cardBackground}
                                strokeWidth={1.5}
                            />
                        ))}
                    </Svg>
                )}

                {/* Twin-axis corner labels: mood 0..10 (left, accent), metric
                    min/max (right, metric color). Absolutely positioned so they
                    sit at the plot corners regardless of measured width. */}
                {width > 0 && (
                    <>
                        <Text style={[styles.axisLeft, styles.axisTop, { color: colors.accent }]}>
                            10
                        </Text>
                        <Text style={[styles.axisLeft, styles.axisBottom, { color: colors.accent }]}>
                            0
                        </Text>
                        {overlay.metricMax != null && (
                            <Text
                                style={[styles.axisRight, styles.axisTop, { color: colors.textSecondary }]}
                            >
                                {formatMetric(overlay.metricMax, config.unit)}
                            </Text>
                        )}
                        {overlay.metricMin != null && (
                            <Text
                                style={[styles.axisRight, styles.axisBottom, { color: colors.textSecondary }]}
                            >
                                {formatMetric(overlay.metricMin, config.unit)}
                            </Text>
                        )}
                    </>
                )}
            </View>

            {/* Sparse date labels aligned to their slot x. */}
            <View style={styles.labelRow}>
                {width > 0 &&
                    labelIdxs.map((idx) => {
                        const x = indexToX(idx, overlay.days.length, dims);
                        const align =
                            idx === 0
                                ? 'left'
                                : idx === overlay.days.length - 1
                                    ? 'right'
                                    : 'center';
                        return (
                            <Text
                                key={`x-${idx}`}
                                numberOfLines={1}
                                style={[
                                    styles.dateLabel,
                                    align === 'left'
                                        ? { left: x, textAlign: 'left' }
                                        : align === 'right'
                                            ? { left: x - LABEL_SLOT_W, width: LABEL_SLOT_W, textAlign: 'right' }
                                            : { left: x - LABEL_SLOT_W / 2, width: LABEL_SLOT_W, textAlign: 'center' },
                                ]}
                            >
                                {formatDayLabel(overlay.days[idx].date)}
                            </Text>
                        );
                    })}
            </View>
        </View>
    );
};

const useStyles = (colors: ThemeColors) =>
    useMemo(
        () =>
            StyleSheet.create({
                headerRow: {
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    marginBottom: 8,
                    paddingRight: 36, // room for the absolute InfoBubble
                },
                iconCircle: {
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    justifyContent: 'center',
                    alignItems: 'center',
                },
                title: {
                    fontSize: 16,
                    fontWeight: '700',
                    color: colors.text,
                    flex: 1,
                },
                subtitle: {
                    fontSize: 14,
                    lineHeight: 20,
                    color: colors.textSecondary,
                    marginBottom: 12,
                },
                subtitleEmphasis: {
                    color: colors.text,
                    fontWeight: '700',
                },
                toggleRow: {
                    flexDirection: 'row',
                    flexWrap: 'wrap',
                    gap: 8,
                    marginBottom: 14,
                },
                pill: {
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderRadius: 16,
                    borderWidth: 1,
                },
                pillText: {
                    fontSize: 13,
                },
                legendRow: {
                    flexDirection: 'row',
                    gap: 18,
                    marginBottom: 8,
                },
                legendItem: {
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                },
                swatch: {
                    width: 14,
                    height: 3,
                    borderRadius: 2,
                },
                legendText: {
                    fontSize: 12,
                    color: colors.textSecondary,
                    fontWeight: '600',
                },
                plotWrap: {
                    alignSelf: 'stretch',
                },
                body: {
                    fontSize: 15,
                    lineHeight: 22,
                    color: colors.textSecondary,
                },
                axisLeft: {
                    position: 'absolute',
                    left: 0,
                    fontSize: 10,
                    fontWeight: '700',
                },
                axisRight: {
                    position: 'absolute',
                    right: 0,
                    fontSize: 10,
                    fontWeight: '700',
                    textAlign: 'right',
                },
                axisTop: {
                    top: 2,
                },
                axisBottom: {
                    bottom: 2,
                },
                labelRow: {
                    height: 16,
                    marginTop: 2,
                },
                dateLabel: {
                    position: 'absolute',
                    fontSize: 10,
                    color: colors.textSecondary,
                },
            }),
        [colors]
    );

export default MoodMetricOverlayCard;
