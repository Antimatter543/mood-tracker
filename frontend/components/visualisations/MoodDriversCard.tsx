import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ThemeColors, useThemeColors } from '@/styles/global';
import { Card } from '@/components/Card';
import InfoBubble from '@/components/InfoBubble';
import type {
    MoodDriver,
    MoodDriversData,
    StabilityAnchor,
} from './transforms/moodDrivers';

/** Max patterns surfaced per section. */
const MAX_PER_SECTION = 3;

const METHOD_NOTE =
    'Patterns from your own entries — associations, not causes. We look for ' +
    'low-day rebounds and ordinary-day anchors, and suppress normal cool-downs ' +
    'after unusually good days.';

type MoodDriversCardProps = {
    data: MoodDriversData;
};

/**
 * Thin renderer for the state-conditioned, forward-looking drivers
 * (`buildMoodDrivers`). Two honest mini-sections:
 *   - Low-day rebound helpers.
 *   - Ordinary-day stability anchors that reduce real dip risk.
 *
 * Everything is gated upstream (meaningful-only, sample-size gated); this
 * component only formats and frames it. When there's no signal yet it shows a
 * gentle "keep logging" state rather than a misleading number.
 */
const MoodDriversCard: React.FC<MoodDriversCardProps> = ({ data }) => {
    const colors = useThemeColors();
    const styles = useStyles(colors);

    const recovery = data.recoveryDrivers.slice(0, MAX_PER_SECTION);
    const anchors = data.stabilityAnchors.slice(0, MAX_PER_SECTION);
    const hasAny = recovery.length > 0 || anchors.length > 0;

    return (
        <Card>
            {/* InfoBubble is absolutely positioned (top-right) by the component. */}
            <InfoBubble text={METHOD_NOTE} />

            <View style={styles.headerRow}>
                <View style={[styles.iconCircle, { backgroundColor: colors.accentLight }]}>
                    <Ionicons name="pulse-outline" size={20} color={colors.accent} />
                </View>
                <Text style={styles.title}>What helps you steady</Text>
            </View>

            {!hasAny ? (
                <Text style={styles.body}>
                    Keep logging through a few low and ordinary stretches and we'll
                    surface what helps you bounce back, and what helps steady days
                    stay steady.
                </Text>
            ) : (
                <>
                    {recovery.length > 0 && (
                        <View style={styles.section}>
                            <Text style={styles.sectionTitle}>
                                Low days that rebound better
                            </Text>
                            {recovery.map((d) => (
                                <RecoveryLine
                                    key={`rec-${d.activity_name}`}
                                    driver={d}
                                    styles={styles}
                                    colors={colors}
                                />
                            ))}
                        </View>
                    )}

                    {anchors.length > 0 && (
                        <View style={styles.section}>
                            <Text style={styles.sectionTitle}>
                                Ordinary days that stay steadier
                            </Text>
                            {anchors.map((d) => (
                                <AnchorLine
                                    key={`anc-${d.activity_name}`}
                                    anchor={d}
                                    styles={styles}
                                    colors={colors}
                                />
                            ))}
                        </View>
                    )}
                </>
            )}
        </Card>
    );
};

const signed = (n: number): string => `${n >= 0 ? '+' : ''}${n.toFixed(1)}`;
const percent = (n: number): string => `${Math.round(n * 100)}%`;

const activityLabel = (name: string): string =>
    name === 'Event' ? 'Social event' : name;

type RecoveryLineProps = {
    driver: MoodDriver;
    styles: ReturnType<typeof useStyles>;
    colors: ThemeColors;
};

const RecoveryLine: React.FC<RecoveryLineProps> = ({ driver, styles, colors }) => {
    const label = activityLabel(driver.activity_name);
    return (
        <Text style={styles.body}>
            After a low day, entries tagged{' '}
            <Text style={styles.emphasis}>{label}</Text>
            {' '}are followed by a{' '}
            <Text style={[styles.emphasis, { color: colors.accent }]}>
                {signed(driver.effect)}
            </Text>
            {' '}better lift on average ({signed(driver.withMean)} vs{' '}
            {signed(driver.withoutMean)} without).
        </Text>
    );
};

type AnchorLineProps = {
    anchor: StabilityAnchor;
    styles: ReturnType<typeof useStyles>;
    colors: ThemeColors;
};

const AnchorLine: React.FC<AnchorLineProps> = ({ anchor, styles, colors }) => {
    const label = activityLabel(anchor.activity_name);
    return (
        <Text style={styles.body}>
            On ordinary days tagged <Text style={styles.emphasis}>{label}</Text>,
            {' '}the next logged day becomes a real dip{' '}
            <Text style={[styles.emphasis, { color: colors.accent }]}>
                {percent(anchor.withDipRate)}
            </Text>
            {' '}of the time vs {percent(anchor.withoutDipRate)} without it.
        </Text>
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
                section: {
                    marginTop: 4,
                    marginBottom: 12,
                },
                sectionTitle: {
                    fontSize: 14,
                    fontWeight: '700',
                    color: colors.text,
                    marginBottom: 6,
                },
                body: {
                    fontSize: 15,
                    lineHeight: 22,
                    color: colors.textSecondary,
                    marginBottom: 6,
                },
                emphasis: {
                    color: colors.text,
                    fontWeight: '700',
                },
            }),
        [colors]
    );

export default MoodDriversCard;
