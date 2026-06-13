import React from 'react';
import { Text } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { ICON_FAMILIES, IconFamilyType } from './iconRegistry';

/**
 * THE single activity-glyph renderer for the whole app.
 *
 * Extracted from timeline/ActivityRow's private `ActivityIconGlyph` so the
 * Timeline, the Home "recent activities" card, and the forms all map
 * `(icon_family, icon_name)` to a vector glyph the SAME way — no second mapping.
 *
 * Mapping rules (the canonical render path used across forms):
 *   - `Emoji` family  -> the stored emoji as plain Text (icon_name IS the emoji),
 *   - a known vector family -> that family's component,
 *   - unknown/missing family -> a Feather `circle` fallback (never a "?" glyph).
 *
 * Takes the two icon fields directly (NOT a full Activity) so callers with only
 * `{ icon_name, icon_family }` rows — e.g. Home's top-activities query — can use
 * it without constructing a full Activity object.
 */
export type ActivityIconProps = {
    iconName: string;
    iconFamily: string;
    color: string;
    size?: number;
};

export const ActivityIcon: React.FC<ActivityIconProps> = ({
    iconName,
    iconFamily,
    color,
    size = 14,
}) => {
    if (iconFamily === 'Emoji') {
        return (
            <Text style={{ fontSize: size, lineHeight: size + 2 }}>{iconName}</Text>
        );
    }
    const IconComponent = ICON_FAMILIES[iconFamily as IconFamilyType]?.component;
    if (!IconComponent) {
        return <Feather name="circle" size={size} color={color} />;
    }
    // Icon names are strongly typed per family, but a stored row carries a plain
    // string for a heterogeneous catalog — the `any` cast mirrors IconPicker's.
    return <IconComponent.default name={iconName as any} size={size} color={color} />;
};

export default ActivityIcon;
