/**
 * Regression guard for the icon catalog (Task 3). On device, invalid catalog
 * names spammed warnings like:
 *   "refresh" is not a valid icon name for family "feather"
 *   "brain-freeze" is not a valid icon name for family "material-community"
 * and rendered a fallback "?" glyph. This test asserts that EVERY catalog entry
 * and EVERY seeded-activity icon resolves to a real glyph in its family's
 * glyphmap, and that every referenced family exists in ICON_FAMILIES — so an
 * invalid icon can never silently ship again.
 *
 * The glyphmaps are the authoritative source the @expo/vector-icons components
 * validate against at runtime.
 */
// The catalog + family map live in the UI-free `iconRegistry` (no OverlayModal /
// reanimated import), so this test reads them directly — no reanimated shim
// needed. (Importing them via `@/components/IconPicker` would re-pull the picker
// UI -> OverlayModal -> reanimated, which throws at import under jest.)
import { ICON_CATEGORIES, ICON_FAMILIES, type IconFamilyType } from '@/components/iconRegistry';
import { initialActivities } from '@/components/seedData';

import FeatherGlyphs from '@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Feather.json';
import MaterialCommunityGlyphs from '@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/MaterialCommunityIcons.json';
import MaterialGlyphs from '@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/MaterialIcons.json';
import FontAwesome6Glyphs from '@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/FontAwesome6Free.json';

// Map each renderable family to the glyphmap the @expo/vector-icons component
// uses to validate names. `Emoji` is excluded — it renders raw emoji strings,
// not named glyphs (component is null).
const GLYPHMAPS: Record<string, Record<string, number>> = {
    Feather: FeatherGlyphs as Record<string, number>,
    MaterialCommunityIcons: MaterialCommunityGlyphs as Record<string, number>,
    MaterialIcons: MaterialGlyphs as Record<string, number>,
    FontAwesome6: FontAwesome6Glyphs as Record<string, number>,
};

const isValidGlyph = (family: string, name: string): boolean => {
    const map = GLYPHMAPS[family];
    return !!map && Object.prototype.hasOwnProperty.call(map, name);
};

describe('icon catalog integrity', () => {
    it('every ICON_CATEGORIES entry references a family that exists in ICON_FAMILIES', () => {
        const families = new Set(Object.keys(ICON_FAMILIES));
        const bad: string[] = [];
        for (const category of ICON_CATEGORIES) {
            for (const icon of category.icons) {
                if (!families.has(icon.family)) {
                    bad.push(`${category.name}: "${icon.name}" -> unknown family "${icon.family}"`);
                }
            }
        }
        expect(bad).toEqual([]);
    });

    it('every ICON_CATEGORIES entry name exists in its family glyphmap', () => {
        const bad: string[] = [];
        for (const category of ICON_CATEGORIES) {
            for (const icon of category.icons) {
                // Emoji entries (if any) are raw strings, not named glyphs.
                if (icon.family === ('Emoji' as IconFamilyType)) continue;
                if (!isValidGlyph(icon.family, icon.name)) {
                    bad.push(`[${category.name}] "${icon.name}" is not a valid "${icon.family}" glyph`);
                }
            }
        }
        // Listing every offender makes a failure self-documenting.
        expect(bad).toEqual([]);
    });

    it('the FontAwesome6 family resolves to the real FA6 glyphmap (not MaterialCommunityIcons)', () => {
        // Guards against the line-8 import regression: "bed" is FA6-only and the
        // seeded "Okay Sleep" activity uses it.
        expect(isValidGlyph('FontAwesome6', 'bed')).toBe(true);
        // A name that exists ONLY in MaterialCommunityIcons must NOT validate as
        // FA6 — proving the family isn't aliased back to MCI.
        expect(isValidGlyph('FontAwesome6', 'emoticon-happy-outline')).toBe(false);
    });

    it('every seeded activity icon is a valid glyph in a known family', () => {
        const bad: string[] = [];
        for (const a of initialActivities) {
            const family = a.icon_family ?? 'Feather';
            const name = a.icon_name ?? 'circle';
            if (!GLYPHMAPS[family]) {
                bad.push(`seed "${a.name}": unknown family "${family}"`);
                continue;
            }
            if (!isValidGlyph(family, name)) {
                bad.push(`seed "${a.name}": "${name}" is not a valid "${family}" glyph`);
            }
        }
        expect(bad).toEqual([]);
    });
});
