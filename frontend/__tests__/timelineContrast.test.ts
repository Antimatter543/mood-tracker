/**
 * WCAG contrast of the redesigned Timeline's text, across EVERY theme
 * (dark / light / cherry / midnight / forest), computed from the real tokens.
 *
 * A class-level invariant rather than a per-theme eyeball: the timeline puts
 * text on three new surfaces (the mood node's tinted fill, the card, the opaque
 * day header) and one hardcoded semantic colour (the destructive "Delete"), and
 * a sixth theme added later must clear the same bar or fail here.
 */
import { themeColors, ThemeColors } from '@/styles/global';
import { dangerColor, nodeFill } from '@/components/timeline/timelinePalette';

type RGBA = { r: number; g: number; b: number; a: number };

const parse = (color: string): RGBA => {
    const hex = color.match(/^#([0-9a-f]{6})$/i);
    if (hex) {
        const n = parseInt(hex[1], 16);
        return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
    }
    const rgba = color.match(/^rgba?\(([^)]+)\)$/i);
    if (rgba) {
        const [r, g, b, a = '1'] = rgba[1].split(',').map((s) => s.trim());
        return { r: Number(r), g: Number(g), b: Number(b), a: Number(a) };
    }
    throw new Error(`unparseable colour ${color}`);
};

/** Composite `top` over an opaque `bottom`. */
const over = (top: RGBA, bottom: RGBA): RGBA => ({
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
    a: 1,
});

const luminance = ({ r, g, b }: RGBA): number => {
    const lin = (c: number) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

const contrast = (fg: string, bgOpaque: RGBA): number => {
    const top = over(parse(fg), bgOpaque);
    const [a, b] = [luminance(top), luminance(bgOpaque)].sort((x, y) => y - x);
    return (a + 0.05) / (b + 0.05);
};

/** The node's heaviest fill (mood 10), composited over the page background. */
const nodeSurface = (colors: ThemeColors): RGBA =>
    over(parse(nodeFill(10, colors.accent)), parse(colors.background));

const themes = Object.entries(themeColors) as [string, ThemeColors][];

describe.each(themes)('Timeline text contrast — %s theme', (_name, colors) => {
    const card = over(parse(colors.cardBackground), parse(colors.background));
    const page = parse(colors.background);

    it('mood number on the node fill >= 4.5:1 (at the strongest fill)', () => {
        expect(contrast(colors.text, nodeSurface(colors))).toBeGreaterThanOrEqual(4.5);
    });

    it('"Delete" on the card >= 4.5:1', () => {
        expect(contrast(dangerColor(colors), card)).toBeGreaterThanOrEqual(4.5);
    });

    it('card time + notes, and day-header count, >= 4.5:1', () => {
        expect(contrast(colors.textSecondary, card)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(colors.text, card)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(colors.textSecondary, page)).toBeGreaterThanOrEqual(4.5);
    });
});
