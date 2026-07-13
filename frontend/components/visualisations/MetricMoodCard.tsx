import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Feather from '@expo/vector-icons/Feather';
import { ThemeColors, useThemeColors } from '@/styles/global';
import { Card } from '@/components/Card';
import InfoBubble from '@/components/InfoBubble';
import {
    MIN_PAIRS,
    type MetricMoodCorrelation,
    type MetricMoodResult,
} from './transforms/healthMoodCorrelation';
import { interpretStrength, significanceLabel } from './transforms/correlationStats';

/**
 * Config for one health↔mood card. The two concrete cards (Sleep, Heart rate)
 * are thin wrappers that supply these metric-specific words + formatters; this
 * component owns ALL the state branching (keep-logging / no-clear-link /
 * directional), so the honest framing lives in exactly one place.
 */
export interface MetricMoodCardConfig {
    /** Ionicons glyph (never emoji). */
    icon: keyof typeof Ionicons.glyphMap;
    /** Card title, e.g. "Sleep & mood". */
    title: string;
    /** Noun used in copy, e.g. "sleep" / "heart rate". */
    metricNoun: string;
    /** Adjectives for the two halves, e.g. { lower: 'shorter-sleep', upper: 'longer-sleep' }. */
    halfWords: { lower: string; upper: string };
    /** Format a metric value (sleep minutes / bpm) for display, e.g. 468 -> "7.8h". */
    formatMetric: (value: number) => string;
    /** InfoBubble method note (association-not-cause framing). */
    methodNote: string;
    /** The computed correlation to render. */
    correlation: MetricMoodCorrelation;
}

/**
 * Thin renderer for a health↔mood correlation. Three honest states:
 *   - notEnoughData → "keep logging — X more days" (never a number).
 *   - ok + flat     → "no clear link yet" (an honest finding, not an error; and
 *                      we never surface a high/low split that isn't meaningful).
 *   - ok + directional → a lower-vs-upper mood comparison + a plain-voice
 *                      sentence, explicitly "a pattern in your own data, not
 *                      medical advice".
 */
const MetricMoodCard: React.FC<MetricMoodCardConfig> = ({
    icon,
    title,
    metricNoun,
    halfWords,
    formatMetric,
    methodNote,
    correlation,
}) => {
    const colors = useThemeColors();
    const styles = useStyles(colors);

    return (
        <Card>
            {/* InfoBubble is absolutely positioned (top-right) by the component. */}
            <InfoBubble text={methodNote} />

            <View style={styles.headerRow}>
                <View style={[styles.iconCircle, { backgroundColor: colors.accentLight }]}>
                    <Ionicons name={icon} size={20} color={colors.accent} />
                </View>
                <Text style={styles.title}>{title}</Text>
            </View>

            {correlation.status === 'notEnoughData' ? (
                <KeepLogging
                    remaining={Math.max(MIN_PAIRS - correlation.pairCount, 1)}
                    metricNoun={metricNoun}
                    styles={styles}
                />
            ) : (
                <>
                    {correlation.direction === 'flat' ? (
                        <Text style={styles.body}>
                            Across {correlation.pairCount} days with both, your {metricNoun} and
                            mood don't show a clear link yet — they move fairly independently.
                            That's just as real a finding.
                        </Text>
                    ) : (
                        <Directional
                            result={correlation}
                            metricNoun={metricNoun}
                            halfWords={halfWords}
                            formatMetric={formatMetric}
                            styles={styles}
                            colors={colors}
                        />
                    )}
                    {/* The nerdy numbers — shown for BOTH ok states, never for keep-logging. */}
                    <StatsLine result={correlation} styles={styles} colors={colors} />
                </>
            )}
        </Card>
    );
};

type KeepLoggingProps = {
    remaining: number;
    metricNoun: string;
    styles: ReturnType<typeof useStyles>;
};

const KeepLogging: React.FC<KeepLoggingProps> = ({ remaining, metricNoun, styles }) => (
    <Text style={styles.body}>
        Keep logging — {remaining} more {remaining === 1 ? 'day' : 'days'} with both{' '}
        {metricNoun} and a mood entry and I'll show how your {metricNoun} and mood
        move together.
    </Text>
);

type DirectionalProps = {
    result: MetricMoodResult;
    metricNoun: string;
    halfWords: { lower: string; upper: string };
    formatMetric: (value: number) => string;
    styles: ReturnType<typeof useStyles>;
    colors: ThemeColors;
};

const Directional: React.FC<DirectionalProps> = ({
    result,
    metricNoun,
    halfWords,
    formatMetric,
    styles,
    colors,
}) => {
    const { lower, upper, moodDelta } = result;
    // moodDelta is upper − lower; describe it in plain words rather than a sign.
    const deltaWord = moodDelta >= 0 ? 'higher' : 'lower';
    const deltaValue = Math.abs(moodDelta).toFixed(1);

    return (
        <>
            {/* Two-column comparison — the "clean simple viz" (mirrors Overview). */}
            <View style={styles.compareGrid}>
                <View style={styles.compareCol}>
                    <Text style={styles.compareValue}>{upper.avgMood.toFixed(1)}</Text>
                    <Text style={styles.compareLabel}>
                        {halfWords.upper} days{'\n'}({formatMetric(upper.avgMetric)})
                    </Text>
                </View>
                <View style={styles.compareCol}>
                    <Text style={styles.compareValue}>{lower.avgMood.toFixed(1)}</Text>
                    <Text style={styles.compareLabel}>
                        {halfWords.lower} days{'\n'}({formatMetric(lower.avgMetric)})
                    </Text>
                </View>
            </View>

            <Text style={styles.body}>
                On your <Text style={styles.emphasis}>{halfWords.upper}</Text> days your
                mood averages <Text style={styles.emphasis}>{upper.avgMood.toFixed(1)}</Text>
                {' '}— that's{' '}
                <Text style={[styles.emphasis, { color: colors.accent }]}>
                    {deltaValue} {deltaWord}
                </Text>{' '}
                than on your {halfWords.lower} days ({lower.avgMood.toFixed(1)}). A gentle
                pattern in your own data, not medical advice.
            </Text>
        </>
    );
};

/** Plain-language explainer for the r / p / n numbers (honest, not medical). */
const STATS_EXPLAINER =
    'r is the correlation (−1 to +1: how tightly the two move together). ' +
    "p is the chance you'd see a link this strong if there really were none — " +
    'smaller is stronger. n is the number of days compared. These describe your ' +
    'own data; a small n means treat it lightly.';

/** p to 2 dp, but "< 0.01" / "< 0.001" near zero so we never print "p = 0.00". */
const formatPValue = (p: number): string =>
    p < 0.001 ? '< 0.001' : p < 0.01 ? '< 0.01' : p.toFixed(2);

type StatsLineProps = {
    result: MetricMoodResult;
    styles: ReturnType<typeof useStyles>;
    colors: ThemeColors;
};

/**
 * Compact "nerdy numbers" line under the comparison/explainer text: the actual
 * Pearson r, two-tailed p-value and sample size n, plus a plain-language
 * strength + significance tag and a tappable "?" that explains what they mean.
 * Renders for BOTH ok states — a flat r with its p-value is itself the honest
 * detail. When a series has zero variance (r/pValue null) we show n only, since
 * there's genuinely no correlation to report.
 */
const StatsLine: React.FC<StatsLineProps> = ({ result, styles, colors }) => {
    const [expanded, setExpanded] = useState(false);
    const { r, pValue, pairCount, direction } = result;

    const numbers =
        r != null && pValue != null
            ? `r = ${r.toFixed(2)}  ·  p = ${formatPValue(pValue)}  ·  n = ${pairCount}`
            : `n = ${pairCount} days`;

    const secondary =
        r != null && pValue != null
            ? direction === 'flat'
                ? `${interpretStrength(r)} · ${significanceLabel(pValue)}`
                : `${interpretStrength(r)} ${direction} · ${significanceLabel(pValue)}`
            : 'not enough variation to compute a correlation';

    return (
        <View style={styles.statsBlock} testID="metric-mood-stats">
            <View style={styles.statsRow}>
                <Text style={styles.statsNumbers}>{numbers}</Text>
                <Pressable
                    onPress={() => setExpanded((v) => !v)}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel="What do these numbers mean?"
                    style={({ pressed }) => [styles.statsHelp, pressed && styles.statsHelpPressed]}
                >
                    <Feather
                        name={expanded ? 'x' : 'help-circle'}
                        size={14}
                        color={colors.textSecondary}
                    />
                </Pressable>
            </View>
            <Text style={styles.statsSecondary}>{secondary}</Text>
            {expanded && <Text style={styles.statsExplain}>{STATS_EXPLAINER}</Text>}
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
                    marginBottom: 12,
                    // leave room for the absolutely-positioned InfoBubble
                    paddingRight: 36,
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
                compareGrid: {
                    flexDirection: 'row',
                    marginBottom: 12,
                },
                compareCol: {
                    flex: 1,
                    alignItems: 'center',
                },
                compareValue: {
                    fontSize: 26,
                    fontWeight: '800',
                    color: colors.text,
                    letterSpacing: -0.5,
                },
                compareLabel: {
                    fontSize: 12,
                    color: colors.textSecondary,
                    marginTop: 4,
                    textAlign: 'center',
                    lineHeight: 16,
                },
                body: {
                    fontSize: 15,
                    lineHeight: 22,
                    color: colors.textSecondary,
                },
                emphasis: {
                    color: colors.text,
                    fontWeight: '700',
                },
                // Nerdy stats line — calm, sits UNDER the copy behind a hairline divider.
                statsBlock: {
                    marginTop: 14,
                    paddingTop: 12,
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderTopColor: colors.border,
                },
                statsRow: {
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                },
                statsNumbers: {
                    flexShrink: 1,
                    fontSize: 13,
                    color: colors.textSecondary,
                    letterSpacing: 0.2,
                    // Align the digits so r/p/n columns don't jitter across cards.
                    fontVariant: ['tabular-nums'],
                },
                statsHelp: {
                    paddingVertical: 2,
                    paddingHorizontal: 4,
                    marginLeft: 8,
                },
                statsHelpPressed: {
                    opacity: 0.6,
                },
                statsSecondary: {
                    fontSize: 12,
                    color: colors.textSecondary,
                    marginTop: 3,
                },
                statsExplain: {
                    fontSize: 12,
                    lineHeight: 17,
                    color: colors.textSecondary,
                    marginTop: 8,
                },
            }),
        [colors]
    );

export default MetricMoodCard;
