// iconRegistry.ts
//
// THE icon data + family registry for the app — the catalog the picker offers,
// the family->component map every renderer uses, and the icon types.
//
// Extracted out of IconPicker.tsx so this data has ZERO UI dependencies. The
// picker (IconPicker.tsx) pulls in OverlayModal -> react-native-reanimated,
// which initialises the native worklets runtime at import (unavailable under
// jest). Lightweight consumers — `activityIcon.tsx` (the shared glyph
// renderer), `ActivityRow`, `ActivityReorder`, and the `iconCatalog` invariant
// test — only need the family map + catalog, NOT the modal, so importing from
// here keeps them free of the reanimated import (no per-test reanimated shim).
// IconPicker re-exports everything here for backwards-compatible call sites.

import * as Feather from '@expo/vector-icons/Feather';
import * as MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
// FontAwesome6 must resolve to the REAL FontAwesome6 module — it was previously
// (mis)pointed at MaterialCommunityIcons, so the seeded "Okay Sleep" activity
// (icon_family:'FontAwesome6', icon_name:'bed', persisted by migration V2) and
// any user-picked FA6 icon rendered a fallback glyph. `bed` is a valid FA6 name.
import * as FontAwesome6 from '@expo/vector-icons/FontAwesome6';

// Define the icon category structure
export type IconInfo = {
    name: string;
    family: IconFamilyType;
};

export type IconCategory = {
    name: string;
    icons: IconInfo[];
};

// Organize icons by category. Exported so __tests__/iconCatalog.test.ts can
// assert every entry resolves to a real glyph (permanent invalid-icon guard).
export const ICON_CATEGORIES: IconCategory[] = [
    {
        name: "Emotions & Mental State",
        icons: [
            // Basic emotions
            { name: 'smile', family: 'Feather' },
            { name: 'frown', family: 'Feather' },
            { name: 'meh', family: 'Feather' },
            { name: 'heart', family: 'Feather' },
            { name: 'emoticon-happy-outline', family: 'MaterialCommunityIcons' },
            { name: 'emoticon-sad-outline', family: 'MaterialCommunityIcons' },
            { name: 'emoticon-angry-outline', family: 'MaterialCommunityIcons' },
            { name: 'emoticon-cry-outline', family: 'MaterialCommunityIcons' },
            { name: 'emoticon-confused-outline', family: 'MaterialCommunityIcons' },
            { name: 'emoticon-excited-outline', family: 'MaterialCommunityIcons' },
            { name: 'emoticon-neutral-outline', family: 'MaterialCommunityIcons' },
            { name: 'emoticon-sick-outline', family: 'MaterialCommunityIcons' },
            { name: 'emoji-emotions', family: 'MaterialIcons' },

            // Mental state
            { name: 'brain', family: 'MaterialCommunityIcons' },
            { name: 'head-snowflake', family: 'MaterialCommunityIcons' },
            { name: 'head-sync', family: 'MaterialCommunityIcons' },
            { name: 'thought-bubble-outline', family: 'MaterialCommunityIcons' },
            { name: 'meditation', family: 'MaterialCommunityIcons' },
            { name: 'heart-broken-outline', family: 'MaterialCommunityIcons' },

            // Energy/Motivation
            { name: 'zap', family: 'Feather' },
            { name: 'refresh-cw', family: 'Feather' },
            { name: 'shield', family: 'Feather' },
            { name: 'lightning-bolt', family: 'MaterialCommunityIcons' },
            { name: 'alert-circle', family: 'Feather' },
            { name: 'star', family: 'Feather' },
            { name: 'shopping-outline', family: 'MaterialCommunityIcons' },
        ]
    },
    {
        name: "Physical Activities",
        icons: [
            { name: 'activity', family: 'Feather' },
            { name: 'run', family: 'MaterialCommunityIcons' },
            { name: 'bicycle', family: 'MaterialCommunityIcons' },
            { name: 'swim', family: 'MaterialCommunityIcons' },
            { name: 'weight-lifter', family: 'MaterialCommunityIcons' },
            { name: 'yoga', family: 'MaterialCommunityIcons' },
            { name: 'basketball', family: 'MaterialCommunityIcons' },
            { name: 'soccer', family: 'MaterialCommunityIcons' },
            { name: 'tennis', family: 'MaterialCommunityIcons' },
            { name: 'fitness-center', family: 'MaterialIcons' },
            { name: 'accessibility', family: 'MaterialIcons' },
        ]
    },
    {
        name: "Leisure & Entertainment",
        icons: [
            { name: 'gamepad-variant', family: 'MaterialCommunityIcons' },
            { name: 'music', family: 'Feather' },
            { name: 'music-note', family: 'MaterialCommunityIcons' },
            { name: 'guitar-acoustic', family: 'MaterialCommunityIcons' },
            { name: 'piano', family: 'MaterialCommunityIcons' },
            { name: 'book', family: 'Feather' },
            { name: 'book-open-outline', family: 'MaterialCommunityIcons' },
            { name: 'book-open-page-variant', family: 'MaterialCommunityIcons' },
            { name: 'movie-open-outline', family: 'MaterialCommunityIcons' },
            { name: 'palette-outline', family: 'MaterialCommunityIcons' },
            { name: 'brush', family: 'MaterialIcons' },
            { name: 'camera', family: 'Feather' },
            { name: 'camera-outline', family: 'MaterialCommunityIcons' },
            { name: 'image', family: 'Feather' },
            { name: 'casino', family: 'MaterialIcons' },
        ]
    },
    {
        name: "Social & Relationships",
        icons: [
            { name: 'users', family: 'Feather' },
            { name: 'user', family: 'Feather' },
            { name: 'account-group-outline', family: 'MaterialCommunityIcons' },
            { name: 'account-heart-outline', family: 'MaterialCommunityIcons' },
            { name: 'account-multiple', family: 'MaterialCommunityIcons' },
            { name: 'account-circle', family: 'MaterialIcons' },
            { name: 'chat-outline', family: 'MaterialCommunityIcons' },
            { name: 'message-text-outline', family: 'MaterialCommunityIcons' },
            { name: 'human-greeting-variant', family: 'MaterialCommunityIcons' },
            { name: 'handshake', family: 'MaterialCommunityIcons' },
            { name: 'party-popper', family: 'MaterialCommunityIcons' },
            { name: 'mail', family: 'Feather' },
            { name: 'phone', family: 'MaterialCommunityIcons' },
            { name: 'child-care', family: 'MaterialIcons' },
        ]
    },
    {
        name: "Health & Wellness",
        icons: [
            { name: 'sleep', family: 'MaterialCommunityIcons' },
            { name: 'sleep-off', family: 'MaterialCommunityIcons' },
            { name: 'power-sleep', family: 'MaterialCommunityIcons' },
            { name: 'fruit-watermelon', family: 'MaterialCommunityIcons' },
            { name: 'hamburger', family: 'MaterialCommunityIcons' },
            { name: 'fastfood', family: 'MaterialIcons' },
            { name: 'coffee', family: 'Feather' },
            { name: 'eye', family: 'Feather' },
            { name: 'thermometer', family: 'Feather' },
        ]
    },
    {
        name: "Work & Productivity",
        icons: [
            { name: 'briefcase', family: 'Feather' },
            { name: 'calendar', family: 'Feather' },
            { name: 'bookmark', family: 'Feather' },
            { name: 'award', family: 'Feather' },
            { name: 'code', family: 'Feather' },
            { name: 'computer', family: 'MaterialIcons' },
            { name: 'alarm', family: 'MaterialIcons' },
            { name: 'lightbulb-outline', family: 'MaterialIcons' },
        ]
    },
    {
        name: "Places & Travel",
        icons: [
            { name: 'home', family: 'Feather' },
            { name: 'home-heart', family: 'MaterialCommunityIcons' },
            { name: 'map', family: 'Feather' },
            { name: 'flight', family: 'MaterialIcons' },
            { name: 'airport-shuttle', family: 'MaterialIcons' },
            { name: 'beach-access', family: 'MaterialIcons' },
            { name: 'deck', family: 'MaterialIcons' },
        ]
    },
    {
        name: "Nature & Environment",
        icons: [
            { name: 'cloud', family: 'Feather' },
            { name: 'sun', family: 'Feather' },
            { name: 'tree', family: 'MaterialCommunityIcons' },
            { name: 'weather-lightning-rainy', family: 'MaterialCommunityIcons' },
            { name: 'umbrella', family: 'Feather' },
            { name: 'eco', family: 'MaterialIcons' },
        ]
    },

];

// The family -> vector-component map. `Emoji` has no component (renders raw
// emoji text). Used by every glyph renderer (activityIcon, ActivityRow,
// ActivityReorder, IconPicker, ActivityEditModal).
export const ICON_FAMILIES = {
    Feather: { component: Feather },
    MaterialCommunityIcons: { component: MaterialCommunityIcons },
    MaterialIcons: { component: MaterialIcons },
    FontAwesome6: { component: FontAwesome6 },
    Emoji: { component: null }

};

export type IconFamilyType = keyof typeof ICON_FAMILIES;
