import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { Card } from '../Card';
import { MoodEntry } from '../types';
import { ThemeColors } from '@/styles/global';
import { moodColor } from './moodColor';
import { ActivityRow } from './ActivityRow';
import { EntryPhotos } from './EntryPhotos';

type EntryCardProps = {
    entry: MoodEntry;
    onEdit: () => void;
    onDelete: (id: number) => void;
    colors: ThemeColors;
};

/** "9:05 AM" style — strip seconds off the locale time. */
const formatTime = (iso: string): string => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
};

const useStyles = (colors: ThemeColors) =>
    useMemo(
        () =>
            StyleSheet.create({
                card: {
                    padding: 0, // padding handled by `body`; the bar overlays the left edge
                    marginBottom: 12,
                },
                // Absolutely positioned at the card's left edge so it spans the
                // FULL card height regardless of Card's internal child wrapper
                // (Card wraps children in its own View, so a flexDirection:'row'
                // on the card style never reaches these children — an in-flow bar
                // collapsed to an invisible top sliver). Card has overflow:'hidden'
                // + borderRadius:24, so the bar's corners are clipped to the card's
                // rounded shape automatically.
                accentBar: {
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: 4,
                },
                body: {
                    padding: 16,
                    paddingLeft: 20, // 16 + the 4px accent bar so text clears it
                },
                headerRow: {
                    flexDirection: 'row',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                },
                moodBlock: {
                    flexDirection: 'row',
                    alignItems: 'baseline',
                },
                moodNumber: {
                    color: colors.text,
                    fontSize: 28,
                    fontWeight: '700',
                    letterSpacing: -0.5,
                },
                moodOutOf: {
                    color: colors.textSecondary,
                    fontSize: 14,
                    fontWeight: '500',
                    marginLeft: 2,
                },
                headerRight: {
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                },
                time: {
                    color: colors.textSecondary,
                    fontSize: 13,
                    marginRight: 6,
                },
                iconButton: {
                    padding: 8,
                    alignItems: 'center',
                    justifyContent: 'center',
                },
                notes: {
                    color: colors.text,
                    fontSize: 15,
                    lineHeight: 22,
                    marginTop: 12,
                },
            }),
        [colors]
    );

/**
 * A single clean timeline entry. One card surface; the mood is conveyed by a
 * left accent bar (tinted via the canonical heatmap scale) plus a prominent
 * number, NOT label prose. Quiet ghost icon-buttons for edit/delete; a compact
 * wrapping activity row; plain notes; and photos that hero when there's one.
 */
export const EntryCard: React.FC<EntryCardProps> = ({ entry, onEdit, onDelete, colors }) => {
    const styles = useStyles(colors);
    const accent = moodColor(entry.mood, colors.accent, colors.overlays.tag);
    const time = formatTime(entry.date);

    return (
        <Card style={styles.card} variant="flat">
            <View style={[styles.accentBar, { backgroundColor: accent }]} />
            <View style={styles.body}>
                <View style={styles.headerRow}>
                    <View style={styles.moodBlock}>
                        <Text style={styles.moodNumber}>{entry.mood}</Text>
                        <Text style={styles.moodOutOf}>/10</Text>
                    </View>
                    <View style={styles.headerRight}>
                        {time ? <Text style={styles.time}>{time}</Text> : null}
                        <Pressable
                            style={styles.iconButton}
                            onPress={onEdit}
                            accessibilityRole="button"
                            accessibilityLabel="Edit entry"
                            hitSlop={10}
                        >
                            <Feather name="edit-2" color={colors.textSecondary} size={18} />
                        </Pressable>
                        <Pressable
                            style={styles.iconButton}
                            onPress={() => onDelete(entry.id)}
                            accessibilityRole="button"
                            accessibilityLabel="Delete entry"
                            hitSlop={10}
                        >
                            <Feather name="trash-2" color={colors.textSecondary} size={18} />
                        </Pressable>
                    </View>
                </View>

                <ActivityRow activities={entry.activities} colors={colors} />

                {entry.notes ? (
                    <Text style={styles.notes} numberOfLines={4}>
                        {entry.notes}
                    </Text>
                ) : null}

                {entry.photos && entry.photos.length > 0 && (
                    <EntryPhotos photos={entry.photos} colors={colors} />
                )}
            </View>
        </Card>
    );
};
