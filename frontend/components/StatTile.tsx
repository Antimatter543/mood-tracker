import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { useThemeColors } from '@/styles/global';

/**
 * One "Overview" stat tile — the shared primitive behind the Stats screen's
 * StatSummaryCard grid and the Home screen's monthly-overview card.
 *
 * Anatomy (the design language Anti endorsed): an OPEN tile, no box-inside-box —
 * a 36px round accent-tinted chip holding a Feather icon, beside a text column
 * of an 18/700 value over a 12/muted label. No background, no border on the tile
 * itself; the chip is the only filled element.
 *
 * Layout safety (per the Yoga shrink-wrap laws in tasks/lessons.md): the value
 * Text is `numberOfLines={1}` inside a `flex:1` column so it truncates rather
 * than pushing the chip; the tile is a plain in-flow block whose width is set by
 * the parent grid (callers pass `style={{ width: '50%' }}` etc.). The tile does
 * NOT size itself — it fills whatever the parent allots.
 */
export type StatTileProps = {
    /** Feather glyph name. */
    icon: React.ComponentProps<typeof Feather>['name'];
    /** The prominent value, e.g. "7.2 / 10". */
    value: string;
    /** The muted caption under the value. */
    label: string;
    /**
     * Accent override for the icon + value (semantic states like "Falling").
     * Defaults to the theme accent for the icon, theme text for the value.
     */
    color?: string;
    /** Icon glyph size. Default 18 (the Overview standard). */
    iconSize?: number;
    /**
     * Max lines for the value. Default 1 — right for short numbers/words. The
     * 2-axis mood-state chip passes 2 so long warm labels like "Climbing
     * through ups & downs" can wrap instead of clipping.
     */
    valueLines?: number;
    /**
     * When true, the value AND label shrink-to-fit their box (no truncation),
     * width-independently. Off by default so the short tiles render crisp at the
     * full type size; the mood-state trend chip turns it on because its label is
     * free text whose width can't be bounded ahead of time.
     */
    shrinkToFit?: boolean;
};

const useStyles = (colors: ReturnType<typeof useThemeColors>) =>
    useMemo(
        () =>
            StyleSheet.create({
                tile: {
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                },
                iconWrap: {
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    backgroundColor: colors.accentLight,
                    justifyContent: 'center',
                    alignItems: 'center',
                },
                textCol: {
                    flex: 1,
                },
                value: {
                    fontSize: 18,
                    fontWeight: '700',
                    color: colors.text,
                },
                label: {
                    fontSize: 12,
                    color: colors.textSecondary,
                    marginTop: 2,
                },
            }),
        [colors]
    );

export const StatTile: React.FC<StatTileProps> = ({
    icon,
    value,
    label,
    color,
    iconSize = 18,
    valueLines = 1,
    shrinkToFit = false,
}) => {
    const colors = useThemeColors();
    const styles = useStyles(colors);

    return (
        <View style={styles.tile}>
            <View style={styles.iconWrap}>
                <Feather name={icon} size={iconSize} color={color ?? colors.accent} />
            </View>
            <View style={styles.textCol}>
                <Text
                    style={[styles.value, color ? { color } : null]}
                    numberOfLines={valueLines}
                    adjustsFontSizeToFit={shrinkToFit}
                    minimumFontScale={shrinkToFit ? 0.65 : undefined}
                >
                    {value}
                </Text>
                <Text
                    style={styles.label}
                    numberOfLines={1}
                    adjustsFontSizeToFit={shrinkToFit}
                    minimumFontScale={shrinkToFit ? 0.7 : undefined}
                >
                    {label}
                </Text>
            </View>
        </View>
    );
};

export default StatTile;
