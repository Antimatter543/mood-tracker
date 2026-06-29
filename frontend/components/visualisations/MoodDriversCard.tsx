import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ThemeColors, useThemeColors } from '@/styles/global';
import { Card } from '@/components/Card';
import InfoBubble from '@/components/InfoBubble';
import type {
    MoodDriver,
    MoodDriversData,
} from './transforms/moodDrivers';

/** Material red 300 — semantic "drains you" signal, not a brand color. */
const DRAIN_COLOR = '#e57373';

/** Max patterns surfaced per section. */
const MAX_PER_SECTION = 3;

const METHOD_NOTE =
    'Patterns from your own entries — associations, not causes. We compare what ' +
    'tends to happen the day AFTER, and only show patterns with enough data.';

type MoodDriversCardProps = {
    data: MoodDriversData;
};

/**
 * Thin renderer for the state-conditioned, forward-looking drivers
 * (`buildMoodDrivers`). Two honest mini-sections:
 *   - When you're low, what tends to be followed by a lift (recovery drivers).
 *   - When you're steady, what tends to come before a dip (destabilizers).
 *
 * Everything is gated upstream (meaningful-only, sample-size gated); this
 * component only formats and frames it. When there's no signal yet it shows a
 * gentle "keep logging" state rather than a misleading number.
 */
const MoodDriversCard: React.FC<MoodDriversCardProps> = ({ data }) => {
    const colors = useThemeColors();
    const styles = useStyles(colors);

    const recovery = data.recoveryDrivers.slice(0, MAX_PER_SECTION);
    const destab = data.destabilizers.slice(0, MAX_PER_SECTION);
    const hasAny = recovery.length > 0 || destab.length > 0;

    return (
        <Card>
            {/* InfoBubble is absolutely positioned (top-right) by the component. */}
            <InfoBubble text={METHOD_NOTE} />

            <View style={styles.headerRow}>
                <View style={[styles.iconCircle, { backgroundColor: colors.accentLight }]}>
                    <Ionicons name="pulse-outline" size={20} color={colors.accent} />
                </View>
                <Text style={styles.title}>What moves you</Text>
            </View>

            {!hasAny ? (
                <Text style={styles.body}>
                    Keep logging through a few low and steady stretches and we'll
                    surface what tends to move you — what helps you bounce back,
                    and what tends to come before a dip.
                </Text>
            ) : (
                <>
                    {recovery.length > 0 && (
                        <View style={styles.section}>
                            <Text style={styles.sectionTitle}>
                                When you're low, these tend to help you bounce back
                            </Text>
                            {recovery.map((d) => (
                                <DriverLine
                                    key={`rec-${d.activity_name}`}
                                    driver={d}
                                    kind="recovery"
                                    styles={styles}
                                    colors={colors}
                                />
                            ))}
                        </View>
                    )}

                    {destab.length > 0 && (
                        <View style={styles.section}>
                            <Text style={styles.sectionTitle}>
                                When you're steady, these tend to come before a dip
                            </Text>
                            {destab.map((d) => (
                                <DriverLine
                                    key={`dst-${d.activity_name}`}
                                    driver={d}
                                    kind="destabilizer"
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

type DriverLineProps = {
    driver: MoodDriver;
    kind: 'recovery' | 'destabilizer';
    styles: ReturnType<typeof useStyles>;
    colors: ThemeColors;
};

const DriverLine: React.FC<DriverLineProps> = ({ driver, kind, styles, colors }) => {
    const effectColor = kind === 'recovery' ? colors.accent : DRAIN_COLOR;
    return (
        <Text style={styles.body}>
            {kind === 'recovery' ? 'After a low day, logging ' : 'When steady, logging '}
            <Text style={styles.emphasis}>{driver.activity_name}</Text>
            {kind === 'recovery'
                ? ' is followed by a '
                : ' tends to be followed by a '}
            <Text style={[styles.emphasis, { color: effectColor }]}>
                {signed(driver.effect)}
            </Text>
            {kind === 'recovery' ? ' lift on average' : ' shift on average'} (vs{' '}
            {signed(driver.withoutMean)} without).
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
