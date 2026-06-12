/**
 * Unit tests for the canonical mood -> color helper. This is the SAME scale the
 * heatmap uses (accent at an opacity ramp from 0.2 at mood 0 to 1.0 at mood 10);
 * the Timeline's left accent bar consumes it so there is one palette, not two.
 */
import { moodColor, MOOD_COLOR_MIN_ALPHA, MOOD_COLOR_MAX_ALPHA } from '@/components/timeline/moodColor';

const GREEN = '#4CAF50'; // r=76 g=175 b=80
const RGB = 'rgba(76, 175, 80,';

describe('moodColor — accent opacity ramp', () => {
    it('maps mood 0 to the minimum alpha', () => {
        expect(moodColor(0, GREEN)).toBe(`${RGB} ${MOOD_COLOR_MIN_ALPHA})`);
    });

    it('maps mood 10 to the maximum alpha', () => {
        expect(moodColor(10, GREEN)).toBe(`${RGB} ${MOOD_COLOR_MAX_ALPHA})`);
    });

    it('maps mood 5 to the midpoint alpha (0.6)', () => {
        // 0.2 + 0.5 * 0.8 = 0.6
        expect(moodColor(5, GREEN)).toBe(`${RGB} 0.6)`);
    });

    it('increases alpha monotonically with mood', () => {
        const alphaOf = (s: string) => Number(s.match(/,\s*([\d.]+)\)$/)![1]);
        const a2 = alphaOf(moodColor(2, GREEN));
        const a5 = alphaOf(moodColor(5, GREEN));
        const a8 = alphaOf(moodColor(8, GREEN));
        expect(a2).toBeLessThan(a5);
        expect(a5).toBeLessThan(a8);
    });
});

describe('moodColor — clamping & degenerate input', () => {
    it('clamps mood above 10 to the max alpha', () => {
        expect(moodColor(99, GREEN)).toBe(`${RGB} ${MOOD_COLOR_MAX_ALPHA})`);
    });

    it('clamps mood below 0 to the min alpha', () => {
        expect(moodColor(-5, GREEN)).toBe(`${RGB} ${MOOD_COLOR_MIN_ALPHA})`);
    });

    it('returns the empty color for null / undefined / non-finite mood', () => {
        expect(moodColor(null, GREEN, '#eee')).toBe('#eee');
        expect(moodColor(undefined, GREEN, '#eee')).toBe('#eee');
        expect(moodColor(Number.NaN, GREEN, '#eee')).toBe('#eee');
        expect(moodColor(Infinity, GREEN, '#eee')).toBe('#eee');
    });

    it('defaults the empty color to transparent when none is supplied', () => {
        expect(moodColor(null, GREEN)).toBe('transparent');
    });
});

describe('moodColor — accent parsing', () => {
    it('uses a different theme accent (e.g. cherry pink) in the output', () => {
        // cherry accent #C7527C -> r=199 g=82 b=124
        expect(moodColor(10, '#C7527C')).toBe('rgba(199, 82, 124, 1)');
    });

    it('falls back to the default green RGB for a non-hex (rgba) accent', () => {
        expect(moodColor(10, 'rgba(1,2,3,1)')).toBe(`${RGB} ${MOOD_COLOR_MAX_ALPHA})`);
    });

    it('supports 3-digit shorthand hex accents', () => {
        // #0F0 -> r=0 g=255 b=0
        expect(moodColor(10, '#0F0')).toBe('rgba(0, 255, 0, 1)');
    });
});
