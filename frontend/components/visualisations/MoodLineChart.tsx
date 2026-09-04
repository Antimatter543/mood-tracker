import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { FadeIn } from 'react-native-reanimated';
import Svg, {
    Circle,
    Defs,
    Line,
    LinearGradient,
    Path,
    Stop,
    Text as SvgText,
} from 'react-native-svg';

import { hapticScrubTick } from '@/lib/haptics';
import { moodColor } from '@/components/timeline/moodColor';
import { useThemeColors } from '@/styles/global';
import {
    buildChartGeometry,
    leftInset,
    type ChartDims,
} from './transforms/chartGeometry';
import {
    buildGridLines,
    buildMoodGradientStops,
    clampTooltipLeft,
    nearestIndex,
    resolveDomain,
    type DomainMode,
} from './transforms/lineChartGeometry';

/**
 * MoodLineChart — the app's own interactive mood line chart.
 *
 * Replaces react-native-chart-kit (unmaintained; its bezier overshoots the data
 * range, its single flat stroke made every mood look the same, and it offers no
 * way to interrogate a point). It is a THIN renderer: every coordinate, domain,
 * gridline, gradient stop and hit-test comes from the pure transforms in
 * `transforms/chartGeometry.ts` + `transforms/lineChartGeometry.ts`.
 *
 * What it answers, in the order the user asked for it:
 *  - "not bright enough / I can't see the differences" -> a full-strength line
 *    painted with a VERTICAL mood gradient (so height reads as colour, not just
 *    position), a matching area fill, and — new on this screen — a DRAWN 0..10
 *    axis with gridlines. `domain="fit"` zooms onto the data's own range for
 *    when whole-scale comparability isn't what you want.
 *  - "hold onto the graph and it should highlight what my mood was" -> a
 *    hold-to-scrub cursor that snaps to REAL points and hands the index back to
 *    the caller, which owns the readout's content.
 *  - "click it for a bigger graph" -> a plain tap fires `onPress`.
 *
 * The Home week chart (MoodWeekChart) stays its own smaller, axis-less card:
 * this one is the analytical instrument, that one is a glance.
 */

export type MoodLinePoint = {
    /** Local day, "YYYY-MM-DD" — passed through to the caller's labels/tooltip. */
    date: string;
    /** Average mood, or null for a day with no entry (drawn as a dashed gap). */
    value: number | null;
};

export type MoodLineChartProps = {
    /** The raw series, OLDEST FIRST. */
    series: readonly MoodLinePoint[];
    /**
     * Optional smoothed overlay (e.g. a moving average), SAME LENGTH as
     * `series`. Drawn dashed on top so the trend reads over the raw signal.
     */
    overlay?: readonly (number | null)[] | null;
    /** Plot height in px (excludes the x-label row). */
    height?: number;
    /** `'fixed'` = always 0..10 (comparable); `'fit'` = zoom to the data. */
    domain?: DomainMode;
    /** Label under slot `index`. Return '' to skip — labels are meant to be sparse. */
    xLabelFor?: (index: number) => string;
    /** Fires with the scrubbed series index, then null when the readout clears. */
    onScrub?: (index: number | null) => void;
    /** Fires on a quick tap (the hold is reserved for scrubbing). */
    onPress?: () => void;
    /**
     * Floating readout content for the scrubbed index. Positioning is this
     * component's job; content is the caller's. Omit it to scrub without a
     * bubble (the expanded view drives a fixed panel from `onScrub` instead).
     */
    tooltip?: (index: number) => React.ReactNode;
    testID?: string;
};

// --- Layout -----------------------------------------------------------------
/** Left gutter: wide enough for a two-character y-axis label ("10"). */
const PAD_LEFT = 26;
/** Right inset: just enough that the last dot + its halo aren't clipped. */
const PAD_RIGHT = 12;
const PAD_TOP = 14;
const PAD_BOTTOM = 12;
const LABEL_ROW_H = 18;
/** Generous slot so a label centres on its point without clipping. */
const X_LABEL_SLOT_W = 56;

// --- Line + dots ------------------------------------------------------------
const LINE_WIDTH = 3;
/** A wider, faint copy of the line under it — reads as a glow, not a second line. */
const GLOW_WIDTH = 8;
const GLOW_OPACITY = 0.18;
/**
 * The canonical mood ramp bottoms out at 0.2 alpha. A fill can live there; a
 * 3px stroke cannot — that faintness IS the "not bright enough" complaint. The
 * ramp's shape is preserved, its floor is raised. See buildMoodGradientStops.
 *
 * 0.85 (was 0.55): at 0.55 the stroke visibly DIMMED as it descended, so a bad
 * week looked like a rendering fault rather than a low mood. The gradient still
 * hints at mood — the dots carry the real colour — but the whole line now stays
 * legible top to bottom, on dark themes and light.
 */
const LINE_MIN_OPACITY = 0.85;
/**
 * The area is a soft underline of the shape, not a block: now that it spans the
 * dashed bridges too (see `areaSpansGaps`) it covers far more of the plot, so
 * its ceiling comes DOWN to keep the line and dots the loudest things on screen.
 */
const AREA_MAX_OPACITY = 0.2;
const AREA_MIN_OPACITY = 0;
const DOT_R = 3.5;
const DOT_RING_W = 1.5;
/** A dash that reads as "bridged, not recorded" (matches MoodWeekChart). */
const GAP_DASH = '4 4';
/**
 * Bridges are secondary to recorded days, but a month with more gaps than
 * entries is mostly bridge — at 0.5 that month read as a broken chart.
 */
const GAP_STROKE_OPACITY = 0.7;
const OVERLAY_DASH = '7 5';
const OVERLAY_WIDTH = 2;
const OVERLAY_OPACITY = 0.6;
const GRID_OPACITY = 0.4;
const GRID_LABEL_SIZE = 10;

// --- Scrub ------------------------------------------------------------------
/**
 * Hold duration before the scrub gesture claims the touch. Also a CONTRACT with
 * the Statistics screen's horizontal page-swipe: because RNGH cancels a
 * non-simultaneous handler that is still in BEGAN when another activates, a
 * still hold lands here and a quick horizontal flick lands on the pager. Do not
 * make this simultaneous with an external gesture without revisiting that.
 */
const SCRUB_ACTIVATE_MS = 220;
/** How long the readout lingers after the finger lifts, so it can be read. */
const TOOLTIP_LINGER_MS = 1200;
const CURSOR_DOT_R = 6;
const CURSOR_HALO_R = 11;
const CURSOR_HALO_OPACITY = 0.22;
const CURSOR_LINE_OPACITY = 0.55;
/** Assumed until the bubble reports its real size via onLayout. */
const TOOLTIP_FALLBACK_W = 170;

const AREA_GRADIENT_ID = 'moodLineArea';
const LINE_GRADIENT_ID = 'moodLineStroke';

export const MoodLineChart: React.FC<MoodLineChartProps> = ({
    series,
    overlay = null,
    height = 240,
    domain = 'fixed',
    xLabelFor,
    onScrub,
    onPress,
    tooltip,
    testID = 'mood-line-chart',
}) => {
    const colors = useThemeColors();
    const [width, setWidth] = useState(0);
    const [scrubIndex, setScrubIndex] = useState<number | null>(null);
    const [tooltipSize, setTooltipSize] = useState({ width: TOOLTIP_FALLBACK_W, height: 0 });

    // The gesture callbacks run on the JS thread (`.runOnJS(true)`), so they can
    // read/write this ref directly and only push a React update when the index
    // actually CHANGES — a setState per pointer sample would re-render the whole
    // chart ~60x a second for no visible difference.
    const scrubIndexRef = useRef<number | null>(null);
    const lingerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const values = useMemo(() => series.map((p) => p.value), [series]);
    const activeDomain = useMemo(() => resolveDomain(values, domain), [values, domain]);

    const dims: ChartDims = useMemo(
        () => ({
            width: width || 1,
            height,
            // padX is the fallback for callers of the shared geometry; this chart
            // draws a y axis, so its left gutter is wider than its right inset.
            padX: PAD_RIGHT,
            padLeft: PAD_LEFT,
            padRight: PAD_RIGHT,
            padTop: PAD_TOP,
            padBottom: PAD_BOTTOM,
        }),
        [width, height]
    );

    const geo = useMemo(
        // `areaSpansGaps`: close the fill under the WHOLE connected polyline,
        // bridges included. Per-run fills (the Home card's default) degenerate
        // into narrow vertical columns on a sparse month — the fill then reads
        // as BARS under the few consecutive days instead of as one trend shape.
        () => buildChartGeometry(values, dims, activeDomain, { areaSpansGaps: true }),
        [values, dims, activeDomain]
    );
    const gridLines = useMemo(
        () => buildGridLines(activeDomain, dims),
        [activeDomain, dims]
    );

    /** x of every REAL point — the only places a scrub cursor may land. */
    const realXs = useMemo(() => geo.realPoints.map((p) => p.x), [geo.realPoints]);

    const lineStops = useMemo(
        () =>
            buildMoodGradientStops(colors.accent, {
                domain: activeDomain,
                minOpacity: LINE_MIN_OPACITY,
            }),
        [colors.accent, activeDomain]
    );
    const areaStops = useMemo(
        () =>
            buildMoodGradientStops(colors.accent, {
                domain: activeDomain,
                minOpacity: AREA_MIN_OPACITY,
                maxOpacity: AREA_MAX_OPACITY,
            }),
        [colors.accent, activeDomain]
    );

    /** Overlay geometry reuses the same dims/domain, so the two lines can't drift. */
    const overlayGeo = useMemo(
        () => (overlay ? buildChartGeometry(overlay as (number | null)[], dims, activeDomain) : null),
        [overlay, dims, activeDomain]
    );

    const clearLinger = useCallback(() => {
        if (lingerTimer.current) {
            clearTimeout(lingerTimer.current);
            lingerTimer.current = null;
        }
    }, []);

    // A pending linger timer that fires after unmount would setState on a dead
    // component; a scrub left mid-gesture by a screen change would leak it.
    useEffect(() => clearLinger, [clearLinger]);

    const applyIndex = useCallback(
        (index: number | null) => {
            if (scrubIndexRef.current === index) return;
            scrubIndexRef.current = index;
            setScrubIndex(index);
            if (index !== null) hapticScrubTick();
            onScrub?.(index);
        },
        [onScrub]
    );

    const handleScrub = useCallback(
        (x: number) => {
            clearLinger();
            const pos = nearestIndex(x, realXs);
            if (pos === null) return;
            applyIndex(geo.realPoints[pos].index);
        },
        [applyIndex, clearLinger, geo.realPoints, realXs]
    );

    const endScrub = useCallback(() => {
        clearLinger();
        // Keep the readout up briefly: lifting the finger to read the number is
        // the natural gesture, and clearing on release makes that impossible.
        lingerTimer.current = setTimeout(() => {
            lingerTimer.current = null;
            applyIndex(null);
        }, TOOLTIP_LINGER_MS);
    }, [applyIndex, clearLinger]);

    const gesture = useMemo(() => {
        /* eslint-disable react-hooks/refs -- `handleScrub`/`endScrub` close over
           `scrubIndexRef`/`lingerTimer`, and the rule cannot tell that RNGH only
           STORES these callbacks here and invokes them from the gesture handler
           (touch time), never during render. The refs exist precisely so a pan
           can dedupe without re-rendering the chart on every pointer sample. */
        const scrub = Gesture.Pan()
            .activateAfterLongPress(SCRUB_ACTIVATE_MS)
            // Callbacks on the JS thread: the readout is React state and the
            // haptic is a JS call, so there is nothing here worth a worklet.
            .runOnJS(true)
            .onStart((e) => handleScrub(e.x))
            .onUpdate((e) => handleScrub(e.x))
            .onFinalize(endScrub);
        /* eslint-enable react-hooks/refs */

        if (!onPress) return scrub;

        const tap = Gesture.Tap()
            .runOnJS(true)
            .onEnd((_e, success) => {
                if (success) onPress();
            });

        // Race, not Simultaneous: a quick tap expands, a hold scrubs, never both.
        return Gesture.Race(scrub, tap);
    }, [endScrub, handleScrub, onPress]);

    const onLayout = useCallback(
        (e: LayoutChangeEvent) => {
            const w = e.nativeEvent.layout.width;
            if (w > 0 && Math.abs(w - width) > 1) setWidth(w);
        },
        [width]
    );

    const onTooltipLayout = useCallback(
        (e: LayoutChangeEvent) => {
            const { width: w, height: h } = e.nativeEvent.layout;
            if (w > 0 && (Math.abs(w - tooltipSize.width) > 1 || Math.abs(h - tooltipSize.height) > 1)) {
                setTooltipSize({ width: w, height: h });
            }
        },
        [tooltipSize]
    );

    const styles = useMemo(
        () =>
            StyleSheet.create({
                // Stretch so the measured width is the card's real content width
                // (a styleless wrapper shrink-wraps — Yoga law, tasks/lessons.md).
                wrap: { alignSelf: 'stretch' },
                svgBox: { width: '100%', height },
                labelRow: { height: LABEL_ROW_H },
                label: {
                    position: 'absolute',
                    fontSize: 11,
                    color: colors.textSecondary,
                    textAlign: 'center',
                },
                tooltip: {
                    position: 'absolute',
                    backgroundColor: colors.cardBackground,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: colors.border,
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    // Lift it off the line it overlaps.
                    shadowColor: colors.elevation.shadowColor,
                    shadowOffset: { width: 0, height: 2 },
                    shadowOpacity: colors.elevation.shadowOpacity,
                    shadowRadius: 8,
                    elevation: colors.elevation.elevation,
                },
            }),
        [colors, height]
    );

    const cursorPoint =
        scrubIndex !== null ? geo.points[scrubIndex] ?? null : null;
    const tooltipNode =
        tooltip && scrubIndex !== null ? tooltip(scrubIndex) : null;

    // Pin the bubble to whichever half of the plot the point ISN'T in, so it
    // never covers the value being read.
    const tooltipTop =
        cursorPoint && cursorPoint.y > height / 2
            ? PAD_TOP
            : Math.max(PAD_TOP, height - tooltipSize.height - PAD_BOTTOM);

    return (
        <View style={styles.wrap} onLayout={onLayout} testID={testID}>
            <GestureDetector gesture={gesture}>
                <View style={styles.svgBox} testID={`${testID}-plot`}>
                    {width > 0 && (
                        <Svg width="100%" height={height}>
                            <Defs>
                                <LinearGradient id={LINE_GRADIENT_ID} x1="0" y1="0" x2="0" y2="1">
                                    {lineStops.map((s) => (
                                        <Stop
                                            key={`ls-${s.offset}`}
                                            offset={s.offset}
                                            stopColor={s.color}
                                            stopOpacity={s.opacity}
                                        />
                                    ))}
                                </LinearGradient>
                                <LinearGradient id={AREA_GRADIENT_ID} x1="0" y1="0" x2="0" y2="1">
                                    {areaStops.map((s) => (
                                        <Stop
                                            key={`as-${s.offset}`}
                                            offset={s.offset}
                                            stopColor={s.color}
                                            stopOpacity={s.opacity}
                                        />
                                    ))}
                                </LinearGradient>
                            </Defs>

                            {/* Axis: gridlines + their values. Statistics is the
                                analytical screen — here the 0..10 scale is DRAWN,
                                unlike the Home card where it stays implied. */}
                            {gridLines.map((g) => (
                                <React.Fragment key={`grid-${g.value}`}>
                                    <Line
                                        testID={`${testID}-grid`}
                                        x1={leftInset(dims)}
                                        y1={g.y}
                                        x2={width - PAD_RIGHT}
                                        y2={g.y}
                                        stroke={colors.border}
                                        strokeOpacity={GRID_OPACITY}
                                        strokeWidth={1}
                                    />
                                    <SvgText
                                        testID={`${testID}-grid-label`}
                                        // Screen readers get the axis values, 
                                        // and it is the stable handle the render
                                        // test reads (SVG text is a TSpan
                                        // grandchild, not a queryable string).
                                        accessibilityLabel={g.label}
                                        x={leftInset(dims) - 6}
                                        y={g.y + GRID_LABEL_SIZE / 3}
                                        fontSize={GRID_LABEL_SIZE}
                                        fill={colors.textSecondary}
                                        textAnchor="end"
                                    >
                                        {g.label}
                                    </SvgText>
                                </React.Fragment>
                            ))}

                            {geo.areaPath ? (
                                <Path
                                    testID={`${testID}-area`}
                                    d={geo.areaPath}
                                    fill={`url(#${AREA_GRADIENT_ID})`}
                                />
                            ) : null}

                            {/* Dashed bridges across days with no entry. Never red:
                                absence must not read as a bad day. */}
                            {geo.gapPaths.map((d, i) => (
                                <Path
                                    key={`gap-${i}`}
                                    testID={`${testID}-gap`}
                                    d={d}
                                    stroke={`url(#${LINE_GRADIENT_ID})`}
                                    strokeWidth={2}
                                    strokeOpacity={GAP_STROKE_OPACITY}
                                    strokeDasharray={GAP_DASH}
                                    strokeLinecap="round"
                                    fill="none"
                                />
                            ))}

                            {geo.linePath ? (
                                <>
                                    {/* Glow first, so the crisp line sits on top of it. */}
                                    <Path
                                        d={geo.linePath}
                                        stroke={`url(#${LINE_GRADIENT_ID})`}
                                        strokeWidth={GLOW_WIDTH}
                                        strokeOpacity={GLOW_OPACITY}
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        fill="none"
                                    />
                                    <Path
                                        testID={`${testID}-line`}
                                        d={geo.linePath}
                                        stroke={`url(#${LINE_GRADIENT_ID})`}
                                        strokeWidth={LINE_WIDTH}
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        fill="none"
                                    />
                                </>
                            ) : null}

                            {/* Smoothed overlay LAST of the lines: the trend should
                                read over the noise, not under it. */}
                            {overlayGeo?.linePath ? (
                                <Path
                                    testID={`${testID}-overlay`}
                                    d={overlayGeo.linePath}
                                    stroke={colors.text}
                                    strokeOpacity={OVERLAY_OPACITY}
                                    strokeWidth={OVERLAY_WIDTH}
                                    strokeDasharray={OVERLAY_DASH}
                                    strokeLinecap="round"
                                    fill="none"
                                />
                            ) : null}

                            {/* Real points only. A day with no entry gets NO dot —
                                the gap is the information. */}
                            {geo.realPoints.map((p) => (
                                <Circle
                                    key={`dot-${p.index}`}
                                    testID={`${testID}-dot`}
                                    cx={p.x}
                                    cy={p.y}
                                    r={DOT_R}
                                    fill={moodColor(p.value, colors.accent, colors.overlays.tag)}
                                    stroke={colors.background}
                                    strokeWidth={DOT_RING_W}
                                />
                            ))}

                            {cursorPoint && !cursorPoint.missing ? (
                                <>
                                    <Line
                                        testID={`${testID}-cursor`}
                                        x1={cursorPoint.x}
                                        y1={PAD_TOP}
                                        x2={cursorPoint.x}
                                        y2={height - PAD_BOTTOM}
                                        stroke={colors.text}
                                        strokeOpacity={CURSOR_LINE_OPACITY}
                                        strokeWidth={1}
                                    />
                                    <Circle
                                        cx={cursorPoint.x}
                                        cy={cursorPoint.y}
                                        r={CURSOR_HALO_R}
                                        fill={colors.accent}
                                        fillOpacity={CURSOR_HALO_OPACITY}
                                    />
                                    <Circle
                                        cx={cursorPoint.x}
                                        cy={cursorPoint.y}
                                        r={CURSOR_DOT_R}
                                        fill={moodColor(
                                            cursorPoint.value,
                                            colors.accent,
                                            colors.overlays.tag
                                        )}
                                        stroke={colors.background}
                                        strokeWidth={2}
                                    />
                                </>
                            ) : null}
                        </Svg>
                    )}

                    {/* Reanimated is attached ONLY to this small leaf. An animated
                        style on a flex:1 container blanks the Statistics screen on
                        Fabric (see components/PageContainer.tsx). There is
                        deliberately no `exiting` animation either: letting
                        reanimated own a view's removal kept the undo snackbar
                        alive past unmount (tasks/lessons.md 2026-09-03). */}
                    {tooltipNode && cursorPoint ? (
                        <Animated.View
                            entering={FadeIn.duration(120)}
                            testID={`${testID}-tooltip`}
                            onLayout={onTooltipLayout}
                            pointerEvents="none"
                            style={[
                                styles.tooltip,
                                {
                                    left: clampTooltipLeft(
                                        cursorPoint.x,
                                        tooltipSize.width,
                                        width
                                    ),
                                    top: tooltipTop,
                                },
                            ]}
                        >
                            {tooltipNode}
                        </Animated.View>
                    ) : null}
                </View>
            </GestureDetector>

            {xLabelFor && (
                <View style={styles.labelRow}>
                    {width > 0 &&
                        geo.points.map((p, i) => {
                            const label = xLabelFor(i);
                            if (!label) return null;
                            return (
                                <Text
                                    key={`lbl-${p.index}`}
                                    style={[
                                        styles.label,
                                        { left: p.x - X_LABEL_SLOT_W / 2, width: X_LABEL_SLOT_W },
                                    ]}
                                    numberOfLines={1}
                                >
                                    {label}
                                </Text>
                            );
                        })}
                </View>
            )}
        </View>
    );
};

export default MoodLineChart;
