/**
 * Activity chip-grid metrics — the height the entry form reserves for each
 * group's `Sortable.Grid`.
 *
 * REGRESSION CONTEXT (Pixel 3 QA, 2026-09-03): the grid reserved ~0dp of layout
 * height until its async measurement pass landed, so every group's chips painted
 * on top of the NEXT group's header. Measured off the capture: all five group
 * headers sat a uniform 72.7dp apart (i.e. grid height ≈ 0.7dp) where one row of
 * chips needs 78dp. The section now reserves the height itself from the item
 * count, which is knowable synchronously — these tests lock that arithmetic.
 */
import {
    ACTIVITY_CHIP_CIRCLE_SIZE,
    ACTIVITY_CHIP_LABEL_BLOCK,
    ACTIVITY_CHIP_LABEL_FILL,
    ACTIVITY_CHIP_LABEL_FONT_SIZE,
    ACTIVITY_CHIP_LABEL_FONT_STEP,
    ACTIVITY_CHIP_LABEL_GAP,
    ACTIVITY_CHIP_LABEL_LINE_HEIGHT,
    ACTIVITY_CHIP_LABEL_LINES,
    ACTIVITY_CHIP_LABEL_MIN_FONT_SCALE,
    ACTIVITY_GRID_COLUMN_GAP,
    ACTIVITY_GRID_COLUMNS,
    ACTIVITY_GRID_HORIZONTAL_INSET,
    ACTIVITY_GRID_ROW_GAP,
    activityChipCellWidth,
    activityChipHeight,
    activityChipLabelLayout,
    activityGridReservedHeight,
    activityGridRowCount,
    estimateTextWidthEm,
    longestWordWidthEm,
} from '@/components/forms/activityGridMetrics';
import { initialActivities } from '@/components/seedData';

describe('row counting', () => {
    it('reserves nothing for a group with no activities', () => {
        expect(activityGridRowCount(0)).toBe(0);
        expect(activityGridReservedHeight(0)).toBe(0);
    });

    it('fills a row before starting the next one', () => {
        for (let n = 1; n <= ACTIVITY_GRID_COLUMNS; n++) {
            expect(activityGridRowCount(n)).toBe(1);
        }
        expect(activityGridRowCount(ACTIVITY_GRID_COLUMNS + 1)).toBe(2);
        expect(activityGridRowCount(ACTIVITY_GRID_COLUMNS * 3)).toBe(3);
        expect(activityGridRowCount(ACTIVITY_GRID_COLUMNS * 3 + 1)).toBe(4);
    });

    it('never returns a negative row count for nonsense input', () => {
        expect(activityGridRowCount(-4)).toBe(0);
        expect(activityGridReservedHeight(-4)).toBe(0);
    });
});

describe('reserved height', () => {
    it('is the chip stack plus the gaps between rows', () => {
        const chip = activityChipHeight();
        expect(chip).toBe(
            ACTIVITY_CHIP_CIRCLE_SIZE +
                ACTIVITY_CHIP_LABEL_GAP +
                ACTIVITY_CHIP_LABEL_LINES * ACTIVITY_CHIP_LABEL_LINE_HEIGHT
        );

        expect(activityGridReservedHeight(1)).toBe(chip);
        expect(activityGridReservedHeight(ACTIVITY_GRID_COLUMNS)).toBe(chip);
        expect(activityGridReservedHeight(ACTIVITY_GRID_COLUMNS + 1)).toBe(
            2 * chip + ACTIVITY_GRID_ROW_GAP
        );
        expect(activityGridReservedHeight(ACTIVITY_GRID_COLUMNS * 2 + 3)).toBe(
            3 * chip + 2 * ACTIVITY_GRID_ROW_GAP
        );
    });

    /**
     * CLASS-LEVEL INVARIANT, not a spot check: whatever the row-packing maths
     * does, adding an activity can never make a group's reserved space SMALLER —
     * that is the shape of the bug (content growing past reserved space) and it
     * has to be impossible for every count, not just the ones we thought of.
     */
    it('never shrinks as activities are added (0..60 chips)', () => {
        let previous = -1;
        for (let n = 0; n <= 60; n++) {
            const height = activityGridReservedHeight(n);
            expect(height).toBeGreaterThanOrEqual(previous);
            previous = height;
        }
    });

    /**
     * The other half of the same invariant: the reservation must cover the space
     * the chips actually occupy. Re-derived here from the raw constants rather
     * than by calling the helper, so a change to the helper that silently
     * under-reserves fails instead of agreeing with itself.
     */
    it('covers the space the chips actually stack into (0..60 chips)', () => {
        const chipStack =
            ACTIVITY_CHIP_CIRCLE_SIZE +
            ACTIVITY_CHIP_LABEL_GAP +
            ACTIVITY_CHIP_LABEL_BLOCK;

        for (let n = 0; n <= 60; n++) {
            const rows = Math.ceil(Math.max(0, n) / ACTIVITY_GRID_COLUMNS);
            const needed =
                rows === 0 ? 0 : rows * chipStack + (rows - 1) * ACTIVITY_GRID_ROW_GAP;
            expect(activityGridReservedHeight(n)).toBeGreaterThanOrEqual(needed);
        }
    });
});

describe('accessibility font scale', () => {
    it('reserves more room when the OS font is scaled up', () => {
        expect(activityGridReservedHeight(7, 2)).toBeGreaterThan(
            activityGridReservedHeight(7, 1)
        );
        // The scale applies to the label box only — the icon circle is a fixed dp box.
        expect(activityChipHeight(2)).toBe(
            ACTIVITY_CHIP_CIRCLE_SIZE +
                ACTIVITY_CHIP_LABEL_GAP +
                ACTIVITY_CHIP_LABEL_BLOCK * 2
        );
    });

    it('does not reserve LESS when the OS font is scaled down', () => {
        // The label's two-line floor is a dp minHeight, which the OS font scale
        // does not shrink — so a sub-1 scale must not shrink the reservation
        // below the rendered box either.
        expect(activityGridReservedHeight(7, 0.85)).toBe(
            activityGridReservedHeight(7, 1)
        );
    });
});

/**
 * LABEL SIZING (Pixel 3 QA, 2026-09-04, store capture `10-entry-form.png`).
 *
 * "Unmotivated" rendered as "Unmotivate / d" and "Overwhelmed" as
 * "Overwhelm / ed": `numberOfLines={2}` lets Android split a word that cannot
 * fit one line, and a user-created activity name can be any length at all.
 * The fix shrinks the label instead, deterministically, from an estimate of
 * its width, so no async measurement is involved (the same reason the grid
 * reserves its height above).
 *
 * These tests are the CLASS-level guard: no shipped activity name, at any
 * supported font scale, may need more than one line for a single word.
 */

/** Pixel 3, portrait: 1080px / 2.75 density. The device the bug was found on. */
const PIXEL_3_WIDTH = 392.7;
const CELL = activityChipCellWidth(PIXEL_3_WIDTH);
const BASE = ACTIVITY_CHIP_LABEL_FONT_SIZE;

/** Rendered width of the label's widest word, in dp, at a given OS font scale. */
const widestWordDp = (name: string, fontScale = 1) => {
    const { fontSize } = activityChipLabelLayout(name, CELL, fontScale);
    return longestWordWidthEm(name) * fontSize * Math.max(1, fontScale);
};

describe('chip cell width', () => {
    it('divides the window into five columns minus the gaps and the insets', () => {
        expect(activityChipCellWidth(PIXEL_3_WIDTH)).toBeCloseTo(
            (PIXEL_3_WIDTH -
                2 * ACTIVITY_GRID_HORIZONTAL_INSET -
                (ACTIVITY_GRID_COLUMNS - 1) * ACTIVITY_GRID_COLUMN_GAP) /
                ACTIVITY_GRID_COLUMNS,
            5
        );
        // Anchor: measured off the QA capture, the chips sit on a 67.2dp pitch
        // with an 8dp gap, i.e. a ~59dp cell. If this drifts far, the estimator's
        // calibration below is being read against a different layout.
        expect(activityChipCellWidth(PIXEL_3_WIDTH)).toBeGreaterThan(55);
        expect(activityChipCellWidth(PIXEL_3_WIDTH)).toBeLessThan(63);
    });

    it('never returns a negative width on an absurdly narrow window', () => {
        expect(activityChipCellWidth(0)).toBe(0);
        expect(activityChipCellWidth(40)).toBe(0);
    });
});

describe('the width estimator', () => {
    it('agrees with what the device actually rendered', () => {
        // Measured off `10-entry-form.png` (label fontSize 11): "Frustrated"
        // occupied ~4.6em and fitted; "Unmotivated" needed ~5.7em and did not.
        // The estimate must err WIDE (shrink a label that would just have fitted
        // rather than shred one that doesn't), but stay within ~10% or it starts
        // shrinking labels the device renders perfectly well.
        for (const [name, measuredEm] of [
            ['Frustrated', 4.6],
            ['Unmotivated', 5.72],
        ] as const) {
            const estimate = estimateTextWidthEm(name);
            expect(estimate).toBeGreaterThanOrEqual(measuredEm);
            expect(estimate).toBeLessThan(measuredEm * 1.1);
        }
        // Wide glyphs cost more than narrow ones, which is the whole point of
        // estimating per character instead of counting them.
        expect(estimateTextWidthEm('mmmm')).toBeGreaterThan(estimateTextWidthEm('llll'));
    });

    it('measures the widest WORD, not the whole string', () => {
        expect(longestWordWidthEm('Good Sleep')).toBe(estimateTextWidthEm('Sleep'));
        expect(longestWordWidthEm('  Social   event  ')).toBe(estimateTextWidthEm('Social'));
        expect(longestWordWidthEm('')).toBe(0);
        expect(longestWordWidthEm('   ')).toBe(0);
    });
});

describe('a chip label never breaks inside a word', () => {
    it('leaves a label that already fits completely alone', () => {
        for (const name of ['Happy', 'Frustrated', 'Confident', 'Good Sleep', 'Social event']) {
            expect(activityChipLabelLayout(name, CELL)).toEqual({
                fontSize: BASE,
                numberOfLines: ACTIVITY_CHIP_LABEL_LINES,
            });
        }
    });

    it('shrinks exactly the two labels that shredded on the device', () => {
        for (const name of ['Unmotivated', 'Overwhelmed']) {
            const layout = activityChipLabelLayout(name, CELL);
            expect(layout.fontSize).toBeLessThan(BASE);
            expect(layout.numberOfLines).toBe(ACTIVITY_CHIP_LABEL_LINES);
            expect(widestWordDp(name)).toBeLessThanOrEqual(CELL);
        }
    });

    it('keeps every SHIPPED activity name on one line per word, at every font scale', () => {
        for (const fontScale of [1, 1.15, 1.3, 1.5, 2]) {
            for (const { name } of initialActivities) {
                const layout = activityChipLabelLayout(name, CELL, fontScale);
                if (layout.numberOfLines === 1) {
                    // Truncation is the last resort and no seeded name may need it.
                    throw new Error(`"${name}" truncates at font scale ${fontScale}`);
                }
                expect(widestWordDp(name, fontScale)).toBeLessThanOrEqual(CELL);
            }
        }
    });

    it('honours a user-created name of any length', () => {
        const names = [
            'Physiotherapy',
            'Grandparents',
            'Procrastinating',
            'Journaling before bed',
            'Antidisestablishmentarianism',
        ];
        for (const name of names) {
            const layout = activityChipLabelLayout(name, CELL);
            if (layout.numberOfLines === ACTIVITY_CHIP_LABEL_LINES) {
                expect(widestWordDp(name)).toBeLessThanOrEqual(CELL);
            } else {
                // The escape hatch: one line, ellipsized by React Native's
                // default `tail` mode. Only reachable at the legibility floor.
                expect(layout.numberOfLines).toBe(1);
                expect(layout.fontSize).toBe(BASE * ACTIVITY_CHIP_LABEL_MIN_FONT_SCALE);
            }
        }
        // The one word that cannot be made to fit is the one that truncates.
        expect(activityChipLabelLayout('Antidisestablishmentarianism', CELL).numberOfLines).toBe(1);
    });
});

describe('shrinking never disturbs the grid', () => {
    it('stays between the legibility floor and the base size', () => {
        const names = [...initialActivities.map((a) => a.name), 'x'.repeat(40), ''];
        for (const fontScale of [1, 1.3, 2]) {
            for (const name of names) {
                const { fontSize } = activityChipLabelLayout(name, CELL, fontScale);
                const rendered = fontSize * Math.max(1, fontScale);
                expect(fontSize).toBeLessThanOrEqual(BASE);
                expect(rendered).toBeGreaterThanOrEqual(
                    BASE * ACTIVITY_CHIP_LABEL_MIN_FONT_SCALE - 1e-9
                );
            }
        }
    });

    it('never asks for more than the two lines the row reserves', () => {
        for (const name of [...initialActivities.map((a) => a.name), 'y'.repeat(40)]) {
            expect(
                activityChipLabelLayout(name, CELL).numberOfLines
            ).toBeLessThanOrEqual(ACTIVITY_CHIP_LABEL_LINES);
        }
    });

    it('quantises shrunk sizes so neighbouring chips agree more often', () => {
        const shrunk = activityChipLabelLayout('Unmotivated', CELL).fontSize;
        expect(shrunk % ACTIVITY_CHIP_LABEL_FONT_STEP).toBeCloseTo(0, 9);
    });

    it('leaves a label alone when the cell width is not yet known', () => {
        expect(activityChipLabelLayout('Overwhelmed', 0)).toEqual({
            fontSize: BASE,
            numberOfLines: ACTIVITY_CHIP_LABEL_LINES,
        });
    });

    it('keeps a safety margin rather than filling the cell edge to edge', () => {
        expect(ACTIVITY_CHIP_LABEL_FILL).toBeLessThan(1);
        expect(ACTIVITY_CHIP_LABEL_FILL).toBeGreaterThan(0.85);
    });

    it('shrinks further as the OS font scale grows, never the other way', () => {
        const sizes = [1, 1.3, 1.6, 2].map(
            (scale) => activityChipLabelLayout('Overwhelmed', CELL, scale).fontSize
        );
        for (let i = 1; i < sizes.length; i++) {
            expect(sizes[i]).toBeLessThanOrEqual(sizes[i - 1]);
        }
        // A scale BELOW 1 must not be used to inflate the label past its base.
        expect(activityChipLabelLayout('Happy', CELL, 0.85).fontSize).toBe(BASE);
    });
});
