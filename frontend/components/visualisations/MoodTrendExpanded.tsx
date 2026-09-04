import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { OverlayModal } from '@/components/OverlayModal';
import SegmentedControl, { type SegmentedOption } from '@/components/SegmentedControl';
import { useThemeColors } from '@/styles/global';
import MoodLineChart from './MoodLineChart';
import MoodTrendReadout from './MoodTrendReadout';
import { TrendLegend } from './MoodTrendLegend';
import { type DomainMode } from './transforms/lineChartGeometry';
import { type MoodTrendData } from './useMoodTrendData';

/**
 * The mood trend at full size.
 *
 * Renders through `OverlayModal fullScreen`, never react-native's `<Modal>` —
 * a native modal opens a second window whose touch dispatch is broken on this
 * stack, which would make the whole point of this screen (holding the chart)
 * dead to a real finger. See CLAUDE.md / context/OverlayHost.tsx.
 *
 * Two things this view has that the card does not:
 *  - a SCALE toggle. The card stays 0–10 so cards and periods stay comparable;
 *    "Fit" lives here, where zooming onto the data's own range is the direct
 *    answer to "I don't get to see the differences when it goes 0–10".
 *  - a FIXED readout panel instead of a floating bubble: at this size a bubble
 *    chasing the finger across a 400px-tall plot is harder to read, not easier.
 */

export type MoodTrendExpandedProps = {
    visible: boolean;
    onClose: () => void;
    /** Chart title, e.g. "Quarterly Mood Trend". */
    title: string;
    /** Concrete date range from the timeframe context, e.g. "Jun – Aug 2026". */
    periodLabel: string;
    data: MoodTrendData;
};

const SCALE_OPTIONS: readonly SegmentedOption<DomainMode>[] = [
    { value: 'fixed', label: '0–10' },
    { value: 'fit', label: 'Fit' },
];

/** Chart height as a share of the window, with sane bounds on tiny/huge screens. */
const CHART_HEIGHT_RATIO = 0.5;
const CHART_HEIGHT_MIN = 240;
const CHART_HEIGHT_MAX = 460;
/** Reserved for the readout so the layout doesn't jump when a scrub starts. */
const READOUT_MIN_HEIGHT = 92;

export const MoodTrendExpanded: React.FC<MoodTrendExpandedProps> = ({
    visible,
    onClose,
    title,
    periodLabel,
    data,
}) => {
    const colors = useThemeColors();
    const insets = useSafeAreaInsets();
    const { height: windowHeight } = useWindowDimensions();
    const [scale, setScale] = useState<DomainMode>('fixed');
    // Held across the release linger AND after it, so the panel keeps showing
    // the last thing the user looked at instead of blanking under their thumb.
    const [scrubIndex, setScrubIndex] = useState<number | null>(null);

    const chartHeight = Math.min(
        CHART_HEIGHT_MAX,
        Math.max(CHART_HEIGHT_MIN, Math.round(windowHeight * CHART_HEIGHT_RATIO))
    );

    const onScrub = useCallback((index: number | null) => {
        // Ignore the clearing null: the panel is persistent by design.
        if (index !== null) setScrubIndex(index);
    }, []);

    const xLabelFor = useCallback((index: number) => data.labels[index] ?? '', [data.labels]);

    const styles = useMemo(
        () =>
            StyleSheet.create({
                root: {
                    flex: 1,
                    // OverlayModal's fullScreen wrapper pads the BOTTOM only; the
                    // top inset is the panel's own job (removing chrome removes
                    // the padding it was accidentally providing — lessons.md).
                    paddingTop: insets.top,
                },
                headerRow: {
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                    paddingHorizontal: 16,
                    paddingTop: 8,
                },
                headerText: { flex: 1 },
                title: { color: colors.text, fontSize: 20, fontWeight: '600' },
                period: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
                closeButton: {
                    width: 44,
                    height: 44,
                    borderRadius: 22,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: colors.overlays.tag,
                },
                body: { paddingHorizontal: 16, paddingTop: 12, gap: 12 },
                scaleRow: { alignItems: 'center' },
                scaleHint: {
                    color: colors.textSecondary,
                    fontSize: 12,
                    textAlign: 'center',
                    marginTop: 6,
                },
                readout: {
                    minHeight: READOUT_MIN_HEIGHT,
                    justifyContent: 'center',
                    backgroundColor: colors.secondaryBackground,
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: colors.border,
                    padding: 14,
                },
                hint: { color: colors.textSecondary, fontSize: 14 },
            }),
        [colors, insets.top]
    );

    const point = scrubIndex !== null ? data.series[scrubIndex] : undefined;

    return (
        <OverlayModal visible={visible} onClose={onClose} fullScreen>
            <View style={styles.root} testID="mood-trend-expanded">
                <View style={styles.headerRow}>
                    <View style={styles.headerText}>
                        <Text style={styles.title}>{title}</Text>
                        <Text style={styles.period}>{periodLabel}</Text>
                    </View>
                    <Pressable
                        onPress={onClose}
                        style={styles.closeButton}
                        testID="mood-trend-expanded-close"
                        accessibilityRole="button"
                        accessibilityLabel="Close expanded chart"
                    >
                        <Ionicons name="close" size={22} color={colors.text} />
                    </Pressable>
                </View>

                <ScrollView contentContainerStyle={styles.body}>
                    <MoodLineChart
                        testID="mood-trend-chart-expanded"
                        series={data.series}
                        overlay={data.overlay}
                        height={chartHeight}
                        domain={scale}
                        xLabelFor={xLabelFor}
                        onScrub={onScrub}
                    />

                    <View style={styles.readout}>
                        {point ? (
                            <MoodTrendReadout
                                day={point.date}
                                average={point.value}
                                entry={data.latestEntries.get(point.date) ?? null}
                                variant="panel"
                            />
                        ) : (
                            <Text style={styles.hint}>
                                Press and hold the chart to see any day&apos;s mood and entry.
                            </Text>
                        )}
                    </View>

                    <View style={styles.scaleRow}>
                        <SegmentedControl
                            options={SCALE_OPTIONS}
                            value={scale}
                            onChange={setScale}
                            size="sm"
                            testID="mood-trend-scale"
                        />
                        <Text style={styles.scaleHint}>
                            {scale === 'fixed'
                                ? 'Full 0–10 scale — comparable across periods.'
                                : 'Zoomed to your range — small differences become visible.'}
                        </Text>
                    </View>

                    <TrendLegend maWindow={data.maWindow} />
                </ScrollView>
            </View>
        </OverlayModal>
    );
};

export default MoodTrendExpanded;
