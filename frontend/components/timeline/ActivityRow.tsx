import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Activity } from '../types';
import { ActivityIcon } from '../activityIcon';
import { ThemeColors } from '@/styles/global';

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        marginTop: 12,
        // gap handles the comfortable spacing between activities AND between an
        // icon and its label (RN flex `gap` applies to all flex children).
        rowGap: 8,
        columnGap: 14,
    },
    item: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
    },
    name: {
        fontSize: 13,
    },
});

/**
 * Compact wrapping row of an entry's activities. Returns null when there are
 * none. Muted text + small glyph; comfortable column gaps separate the units
 * (no interpunct needed — the spacing reads cleanly).
 */
export const ActivityRow: React.FC<{
    activities: Activity[];
    colors: ThemeColors;
}> = ({ activities, colors }) => {
    if (!activities || activities.length === 0) return null;
    return (
        <View style={styles.row}>
            {activities.map((activity, index) => (
                <View key={`${activity.id}-${index}`} style={styles.item}>
                    <ActivityIcon
                        iconName={activity.icon_name}
                        iconFamily={activity.icon_family}
                        color={colors.textSecondary}
                    />
                    <Text style={[styles.name, { color: colors.textSecondary }]}>
                        {activity.name}
                    </Text>
                </View>
            ))}
        </View>
    );
};
