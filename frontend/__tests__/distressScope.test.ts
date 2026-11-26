/**
 * What the distress wipe erases (lib/distressScope.ts): the stored selection
 * must never be read as "erase less" by accident.
 */
import {
    DEFAULT_DISTRESS_SCOPE,
    DISTRESS_CATEGORIES,
    DISTRESS_CATEGORY_COPY,
    erasedCategoryLabels,
    keptSummary,
    OFF_BY_DEFAULT,
    parseDistressScope,
    serializeDistressScope,
} from '@/lib/distressScope';

describe('distress scope', () => {
    it('defaults: everything private is erased, the journal itself is kept', () => {
        for (const c of DISTRESS_CATEGORIES) {
            expect(DEFAULT_DISTRESS_SCOPE[c]).toBe(!OFF_BY_DEFAULT.includes(c));
        }
        expect(OFF_BY_DEFAULT).toEqual(['defaultActivityLinks', 'entries']);
    });

    it('the kept line follows the selection', () => {
        expect(keptSummary(DEFAULT_DISTRESS_SCOPE)).toMatch(/mood score and default activities/);
        expect(keptSummary({ ...DEFAULT_DISTRESS_SCOPE, defaultActivityLinks: true })).not.toMatch(/default activities,/);
        expect(keptSummary({ ...DEFAULT_DISTRESS_SCOPE, entries: true })).toMatch(/fresh install/);
    });

    it('missing, empty or broken storage reads as the default', () => {
        for (const raw of [undefined, null, '', '{}', 'not json', '[]', '42']) {
            expect(parseDistressScope(raw)).toEqual(DEFAULT_DISTRESS_SCOPE);
        }
    });

    it('round-trips a selection and keeps unknown keys out', () => {
        const scope = { ...DEFAULT_DISTRESS_SCOPE, health: false, stars: false };
        const raw = serializeDistressScope(scope);
        expect(parseDistressScope(raw)).toEqual(scope);
        expect(JSON.parse(raw)).not.toHaveProperty('extra');
    });

    it('a non-boolean value for one category falls back to erasing it', () => {
        expect(parseDistressScope('{"notes":"no","health":false}')).toEqual({
            ...DEFAULT_DISTRESS_SCOPE,
            health: false,
        });
    });

    it('every category has settings copy (class-level: no category without a label)', () => {
        for (const c of DISTRESS_CATEGORIES) {
            expect(DISTRESS_CATEGORY_COPY[c].label.length).toBeGreaterThan(0);
            expect(DISTRESS_CATEGORY_COPY[c].detail.length).toBeGreaterThan(0);
        }
    });

    it('lists the erased categories in display order', () => {
        expect(erasedCategoryLabels({ ...DEFAULT_DISTRESS_SCOPE, notes: false })).not.toContain('Notes');
        expect(erasedCategoryLabels(DEFAULT_DISTRESS_SCOPE)).toHaveLength(DISTRESS_CATEGORIES.length - OFF_BY_DEFAULT.length);
    });
});
