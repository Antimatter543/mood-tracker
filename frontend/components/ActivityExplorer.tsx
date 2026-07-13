import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { useSQLiteContext } from 'expo-sqlite';

import { ThemeColors, useThemeColors } from '@/styles/global';
import { useDataRefresh } from '@/hooks/useDataRefresh';
import { Card } from '@/components/Card';
import { ActivityIcon } from '@/components/activityIcon';
import { Activity } from '@/components/types';
import { getActivities } from '@/databases/activities';
import { ACTIVITY_ENTRY_COUNTS } from '@/components/visualisations/queries';
import {
    withEntryCounts,
    filterActivitiesByQuery,
    type ActivityWithCount,
} from '@/components/visualisations/transforms/activityDetail';
import { OverlayModal } from '@/components/OverlayModal';
import { ActivityInsightsDetail } from '@/components/ActivityInsightsDetail';

/**
 * "Explore your activities" — a search box + a tappable, entry-count-sorted list
 * of every activity. Tapping one opens its full-screen insights detail (through
 * the in-tree OverlayModal, never a native <Modal>). Lives on the Statistics
 * screen. Rendered INSIDE the Stats ScrollView, so the list is a plain mapped
 * View (no nested scroll view).
 */
export const ActivityExplorer: React.FC = () => {
    const colors = useThemeColors();
    const db = useSQLiteContext();
    const styles = useMemo(() => makeStyles(colors), [colors]);

    const [items, setItems] = useState<ActivityWithCount<Activity>[]>([]);
    const [query, setQuery] = useState('');
    const [selected, setSelected] = useState<Activity | null>(null);

    const load = useCallback(() => {
        let active = true;
        (async () => {
            try {
                const [activities, countRows] = await Promise.all([
                    getActivities(db),
                    db.getAllAsync<{ activity_id: number; n: number }>(ACTIVITY_ENTRY_COUNTS),
                ]);
                if (active) setItems(withEntryCounts(activities, countRows));
            } catch (e) {
                console.error('Error loading activity explorer:', e);
                if (active) setItems([]);
            }
        })();
        return () => {
            active = false;
        };
    }, [db]);
    useDataRefresh(load, [db]);

    const filtered = useMemo(
        () => filterActivitiesByQuery(items, query),
        [items, query],
    );

    return (
        <Card>
            <Text style={styles.title}>Explore your activities</Text>
            <Text style={styles.subtitle}>
                Open any activity to see its mood pattern, variability, and what you pair it with.
            </Text>

            {items.length === 0 ? (
                <View style={styles.emptyState}>
                    <Feather name="search" size={26} color={colors.textSecondary} />
                    <Text style={styles.emptyText}>
                        No activities yet. Add some while logging a mood and they'll appear here.
                    </Text>
                </View>
            ) : (
                <>
                    <View style={styles.searchBar}>
                        <Feather name="search" size={16} color={colors.textSecondary} />
                        <TextInput
                            style={styles.searchInput}
                            value={query}
                            onChangeText={setQuery}
                            placeholder="Search activities"
                            placeholderTextColor={colors.textSecondary}
                            autoCapitalize="none"
                            autoCorrect={false}
                            returnKeyType="search"
                            accessibilityLabel="Search activities"
                        />
                        {query.length > 0 && (
                            <Pressable
                                onPress={() => setQuery('')}
                                hitSlop={10}
                                accessibilityRole="button"
                                accessibilityLabel="Clear search"
                            >
                                <Feather name="x" size={16} color={colors.textSecondary} />
                            </Pressable>
                        )}
                    </View>

                    {filtered.length === 0 ? (
                        <Text style={styles.noMatch}>
                            No activities match &ldquo;{query.trim()}&rdquo;.
                        </Text>
                    ) : (
                        <View style={styles.list}>
                            {filtered.map((a) => (
                                <Pressable
                                    key={a.id}
                                    onPress={() => setSelected(a)}
                                    style={({ pressed }) => [
                                        styles.row,
                                        pressed && styles.rowPressed,
                                    ]}
                                    accessibilityRole="button"
                                    accessibilityLabel={`Open ${a.name} insights, ${a.entryCount} ${
                                        a.entryCount === 1 ? 'entry' : 'entries'
                                    }`}
                                >
                                    <View
                                        style={[
                                            styles.rowIcon,
                                            { backgroundColor: colors.accentLight },
                                        ]}
                                    >
                                        <ActivityIcon
                                            iconName={a.icon_name}
                                            iconFamily={a.icon_family}
                                            color={colors.accent}
                                            size={18}
                                        />
                                    </View>
                                    <View style={styles.grow}>
                                        <Text style={styles.rowName} numberOfLines={1}>
                                            {a.name}
                                        </Text>
                                        <Text style={styles.rowCount}>
                                            {a.entryCount} {a.entryCount === 1 ? 'entry' : 'entries'}
                                        </Text>
                                    </View>
                                    <Feather
                                        name="chevron-right"
                                        size={18}
                                        color={colors.textSecondary}
                                    />
                                </Pressable>
                            ))}
                        </View>
                    )}
                </>
            )}

            <OverlayModal
                visible={selected !== null}
                onClose={() => setSelected(null)}
                fullScreen
            >
                {selected && (
                    <ActivityInsightsDetail
                        activity={selected}
                        onClose={() => setSelected(null)}
                    />
                )}
            </OverlayModal>
        </Card>
    );
};

const makeStyles = (colors: ThemeColors) =>
    StyleSheet.create({
        title: {
            fontSize: 18,
            fontWeight: '700',
            color: colors.text,
            marginBottom: 4,
        },
        subtitle: {
            fontSize: 13,
            color: colors.textSecondary,
            marginBottom: 14,
            lineHeight: 19,
        },
        searchBar: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            backgroundColor: colors.secondaryBackground,
            borderRadius: 12,
            paddingHorizontal: 12,
            paddingVertical: 10,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: colors.border,
            marginBottom: 4,
        },
        searchInput: {
            flex: 1,
            fontSize: 15,
            color: colors.text,
            padding: 0,
        },
        list: {
            marginTop: 6,
        },
        row: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            paddingVertical: 10,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: colors.overlays.border,
        },
        rowPressed: {
            opacity: 0.6,
        },
        rowIcon: {
            width: 36,
            height: 36,
            borderRadius: 18,
            alignItems: 'center',
            justifyContent: 'center',
        },
        grow: { flex: 1 },
        rowName: {
            fontSize: 15,
            fontWeight: '600',
            color: colors.text,
        },
        rowCount: {
            fontSize: 12.5,
            color: colors.textSecondary,
            marginTop: 1,
        },
        noMatch: {
            fontSize: 14,
            color: colors.textSecondary,
            marginTop: 14,
            textAlign: 'center',
        },
        emptyState: {
            alignItems: 'center',
            gap: 10,
            paddingVertical: 20,
        },
        emptyText: {
            fontSize: 14,
            color: colors.textSecondary,
            textAlign: 'center',
            lineHeight: 20,
        },
    });

export default ActivityExplorer;
