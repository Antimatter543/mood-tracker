import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { Activity } from '../types';
import { ICON_FAMILIES, IconFamilyType } from '../IconPicker';
import { ThemeColors } from '@/styles/global';

/**
 * One activity rendered as a compact [icon + name] chip-less unit. Mirrors the
 * canonical render path used across the forms (ActivityReorder /
 * ActivitySelector): Emoji family -> the name as Text; otherwise the family's
 * vector component, with a `circle` fallback for an unknown/missing family. No
 * border, no pill — the icon + muted label carry it.
 */
const ActivityIconGlyph: React.FC<{
    activity: Activity;
    color: string;
    size?: number;
}> = ({ activity, color, size = 14 }) => {
    if (activity.icon_family === 'Emoji') {
        return (
            <Text style={{ fontSize: size, lineHeight: size + 2 }}>
                {activity.icon_name}
            </Text>
        );
    }
    const IconComponent = ICON_FAMILIES[activity.icon_family as IconFamilyType]?.component;
    if (!IconComponent) {
        return <Feather name="circle" size={size} color={color} />;
    }
    return <IconComponent.default name={activity.icon_name as any} size={size} color={color} />;
};

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
                    <ActivityIconGlyph activity={activity} color={colors.textSecondary} />
                    <Text style={[styles.name, { color: colors.textSecondary }]}>
                        {activity.name}
                    </Text>
                </View>
            ))}
        </View>
    );
};
