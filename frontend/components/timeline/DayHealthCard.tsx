import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { OverlayModal } from '@/components/OverlayModal';
import { ThemeColors } from '@/styles/global';
import { HEALTH_RATING_LABELS, healthRatingColor, dayHealthItems, type DayHealth } from './dayHealth';

type DayHealthCardProps = {
    visible: boolean;
    onClose: () => void;
    title: string;
    health: DayHealth;
    colors: ThemeColors;
};

const useStyles = (colors: ThemeColors) =>
    useMemo(
        () =>
            StyleSheet.create({
                card: {
                    backgroundColor: colors.cardBackground,
                    width: '92%',
                    maxWidth: 480,
                    borderRadius: 16,
                    padding: 20,
                    gap: 16,
                },
                headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
                headerText: { flex: 1 },
                title: { color: colors.text, fontSize: 20, fontWeight: 'bold' },
                subtitle: { color: colors.textSecondary, fontSize: 14, marginTop: 2 },
                closeButton: { padding: 4 },
                item: { flexDirection: 'row', gap: 12 },
                itemBody: { flex: 1, gap: 2 },
                itemTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
                label: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '600' },
                value: { color: colors.text, fontSize: 15, fontWeight: '600' },
                rating: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
                ratingDot: { width: 8, height: 8, borderRadius: 4 },
                ratingText: { color: colors.text, fontSize: 13, fontWeight: '600' },
                note: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
                footnote: { color: colors.textSecondary, fontSize: 12 },
            }),
        [colors]
    );

/** All of a day's health figures, each with what it means. */
export const DayHealthCard: React.FC<DayHealthCardProps> = ({ visible, onClose, title, health, colors }) => {
    const styles = useStyles(colors);
    return (
        <OverlayModal visible={visible} onClose={onClose}>
            <View style={styles.card} testID="day-health-card">
                <View style={styles.headerRow}>
                    <View style={styles.headerText}>
                        <Text style={styles.title} accessibilityRole="header">
                            Health
                        </Text>
                        <Text style={styles.subtitle}>{title}</Text>
                    </View>
                    <Pressable
                        onPress={onClose}
                        style={styles.closeButton}
                        accessibilityRole="button"
                        accessibilityLabel="Close"
                        hitSlop={8}
                    >
                        <Ionicons name="close" size={24} color={colors.textSecondary} />
                    </Pressable>
                </View>
                {dayHealthItems(health).map((item) => (
                    <View key={item.key} style={styles.item} testID={`day-health-item-${item.key}`}>
                        <Ionicons name={item.icon} size={20} color={colors.textSecondary} />
                        <View style={styles.itemBody}>
                            <View style={styles.itemTop}>
                                <Text style={styles.label}>{item.label}</Text>
                                <Text style={styles.value}>{item.value}</Text>
                            </View>
                            {item.rating ? (
                                <View style={styles.rating}>
                                    <View
                                        style={[styles.ratingDot, { backgroundColor: healthRatingColor(item.rating, colors) }]}
                                    />
                                    <Text style={styles.ratingText}>{HEALTH_RATING_LABELS[item.rating]}</Text>
                                </View>
                            ) : null}
                            <Text style={styles.note}>{item.note}</Text>
                        </View>
                    </View>
                ))}
                <Text style={styles.footnote}>A rough guide for adults, not medical advice.</Text>
            </View>
        </OverlayModal>
    );
};
