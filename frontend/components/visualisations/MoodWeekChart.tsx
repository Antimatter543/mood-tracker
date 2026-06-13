import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, LayoutChangeEvent } from 'react-native';
import Svg, { Path, Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { useThemeColors } from '@/styles/global';
import { moodColor } from '@/components/timeline/moodColor';
import {
    buildChartGeometry,
    type ChartDims,
} from './transforms/chartGeometry';

/**
 * The custom, systematic Home mood chart — replaces react-native-chart-kit's
 * LineChart (cramped y-axis, bezier overshoot, clipped dots, dated look).
 *
 * Design (per the brief):
 *  - width is MEASURED via onLayout (like ActivityCorrelationChart), not
 *    guessed from SCREEN_WIDTH - padding, so it's theme/orientation robust and
 *    dots are never clipped at the bounds.
 *  - straight-segment line (no bezier overshoot), subtle accent area fill under
 *    it (gradient fading to transparent), NO axis grid clutter.
 *  - REAL points = solid dots colored by the canonical moodColor ramp (mood
 *    color is consistent app-wide). MISSING days are NOT dotted (absence reads
 *    as "no data", never as a red "error" day) and the line is DASHED across an
 *    interior gap.
 *  - day-name labels (Mon..Sun) sit under each slot, centered on its x.
 *  - the 0..10 mood scale is implied, not drawn.
 *
 * All path math is in the pure, unit-tested `chartGeometry` transform; this
 * component is a thin renderer. The empty-week placeholder is the CALLER's job
 * (WeeklyChartCard) — this component assumes it's only mounted with >=1 real
 * point, but degrades gracefully (renders just labels) if handed all-missing.
 */
export type MoodWeekChartProps = {
    /** Per-day mood averages, oldest first; null = no entry that day. */
    data: (number | null)[];
    /** Day-name labels aligned to each slot (e.g. ["Mon",...,"Sun"]). */
    labels: string[];
    /** Plot height in px. Default 130 (the brief's ~120-140 range). */
    height?: number;
};

const PAD_X = 14; // horizontal inset so end dots + labels aren't clipped
const PAD_TOP = 14;
const PAD_BOTTOM = 10; // small — day labels live in their own row below the SVG
const DOT_R = 4;
const LABEL_ROW_H = 18;
const GRADIENT_ID = 'moodWeekArea';

export const MoodWeekChart: React.FC<MoodWeekChartProps> = ({
    data,
    labels,
    height = 130,
}) => {
    const colors = useThemeColors();
    const [width, setWidth] = useState(0);

    const styles = useMemo(
        () =>
            StyleSheet.create({
                // Stretch so the measured width is the card's real content width
                // (a styleless wrapper would shrink-wrap — Yoga law, lessons.md).
                wrap: {
                    alignSelf: 'stretch',
                },
                svgBox: {
                    width: '100%',
                    height,
                },
                labelRow: {
                    height: LABEL_ROW_H,
                    // labels are absolutely positioned, centered on each slot x.
                },
                label: {
                    position: 'absolute',
                    fontSize: 11,
                    color: colors.textSecondary,
                    textAlign: 'center',
                },
            }),
        [colors, height]
    );

    const onLayout = (e: LayoutChangeEvent) => {
        const w = e.nativeEvent.layout.width;
        if (w > 0 && Math.abs(w - width) > 1) setWidth(w);
    };

    // Memoize dims so `geo` doesn't recompute every render (a fresh object
    // literal each render would defeat the geometry useMemo).
    const dims: ChartDims = useMemo(
        () => ({
            width: width || 1,
            height,
            padX: PAD_X,
            padTop: PAD_TOP,
            padBottom: PAD_BOTTOM,
        }),
        [width, height]
    );

    const geo = useMemo(() => buildChartGeometry(data, dims), [data, dims]);

    // Dot colors come from the canonical mood ramp so the chart matches the
    // timeline/heatmap. The accent drives the line + area gradient.
    const accent = colors.accent;
    // A dash that reads as "bridged, not recorded".
    const GAP_DASH = '4 4';

    // Half-width of a label slot for centering each label on its point.x. Use a
    // generous slot so 3-letter day names center without clipping.
    const LABEL_SLOT_W = 40;

    return (
        <View style={styles.wrap} onLayout={onLayout} testID="mood-week-chart">{/* testID drives the onLayout measurement in render tests */}
            <View style={styles.svgBox}>
                {width > 0 && (
                    <Svg width="100%" height={height}>
                        <Defs>
                            <LinearGradient id={GRADIENT_ID} x1="0" y1="0" x2="0" y2="1">
                                <Stop offset="0" stopColor={accent} stopOpacity={0.22} />
                                <Stop offset="1" stopColor={accent} stopOpacity={0} />
                            </LinearGradient>
                        </Defs>

                        {/* Subtle area fill under the solid line. */}
                        {geo.areaPath ? (
                            <Path d={geo.areaPath} fill={`url(#${GRADIENT_ID})`} />
                        ) : null}

                        {/* Dashed bridges across interior gaps (drawn under the
                            solid line so solid segments stay crisp on top). */}
                        {geo.gapPaths.map((d, i) => (
                            <Path
                                key={`gap-${i}`}
                                d={d}
                                stroke={accent}
                                strokeWidth={2}
                                strokeOpacity={0.45}
                                strokeDasharray={GAP_DASH}
                                strokeLinecap="round"
                                fill="none"
                            />
                        ))}

                        {/* The solid line over consecutive real points. */}
                        {geo.linePath ? (
                            <Path
                                d={geo.linePath}
                                stroke={accent}
                                strokeWidth={2.5}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                fill="none"
                            />
                        ) : null}

                        {/* Real data dots, colored by the mood ramp. A white-ish
                            inner halo (card bg) keeps the dot legible over the
                            line. Missing days are intentionally undotted. */}
                        {geo.realPoints.map((p) => (
                            <Circle
                                key={`dot-${p.index}`}
                                cx={p.x}
                                cy={p.y}
                                r={DOT_R}
                                fill={moodColor(p.value, accent, colors.overlays.tag)}
                                stroke={colors.cardBackground}
                                strokeWidth={1.5}
                            />
                        ))}
                    </Svg>
                )}
            </View>

            {/* Day labels, centered on each slot's x. */}
            <View style={styles.labelRow}>
                {width > 0 &&
                    geo.points.map((p, i) => (
                        <Text
                            key={`lbl-${p.index}`}
                            style={[
                                styles.label,
                                {
                                    left: p.x - LABEL_SLOT_W / 2,
                                    width: LABEL_SLOT_W,
                                },
                            ]}
                            numberOfLines={1}
                        >
                            {labels[i] ?? ''}
                        </Text>
                    ))}
            </View>
        </View>
    );
};

export default MoodWeekChart;
